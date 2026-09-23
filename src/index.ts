import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_PATH, type JevConfig } from "./config.ts";
import { clearAaKey, resolveAaKey, resolveKey, saveAaKey } from "./auth.ts";
import { makeRunner } from "./core.ts";
import { registerJevTools } from "./tools.ts";
import { registerTypeSafeProvider } from "./provider.ts";
import {
  SKILL_DIR,
  checkSkill,
  readSkillState,
  syncSkill,
  type SkillState,
  type SkillSyncResult,
} from "./skill.ts";

/** 后台 skill 同步的最近结果：面板与 /jev-skill 都读它，别每次重跑网络 */
let skillSnapshot: SkillSyncResult | null = null;

const short = (commit: string): string =>
  commit ? commit.slice(0, 7) : "未知版本";

/** /jev-skill 的详细面板 */
function renderSkill(
  state: SkillState | null,
  snap: SkillSyncResult | null,
): string {
  return [
    "TypeSafe 官方 skill",
    `  目录:   ${SKILL_DIR}`,
    state
      ? `  已装:   ${Object.keys(state.files).length} 个文件 · commit ${state.commit || "未知"} · 装于 ${state.installedAt}`
      : "  已装:   ✗ 未安装",
    `  本次:   ${snap ? skillLine(snap) : "尚未同步"}`,
    "  手动:   /jev-skill check（查更新）· /jev-skill update（强制同步，覆盖本地改动）",
  ].join("\n");
}

function renderPanel(
  cfg: JevConfig,
  key: string | null,
  source: string,
): string {
  const keyLine =
    source === "missing" || !key
      ? "✗ 未配置 —— 运行 pi login 选 TypeSafe，或设 TYPESAFE_API_KEY"
      : `✓ ${source}（${key.slice(0, 6)}…${key.slice(-4)}）`;
  return [
    "Jev (TypeSafe System One) 状态",
    `  key:    ${keyLine}`,
    `  model:  ${cfg.model}   timeout: ${cfg.timeoutMs}ms   并发: ${cfg.maxConcurrent}`,
    `  低置信: choice<${cfg.lowConfidence.choice}  score<${cfg.lowConfidence.score}  noul±${cfg.lowConfidence.noulMargin}`,
    `  skill:  ${skillLine()}`,
    `  配置文件: ${CONFIG_PATH}（缺失=全默认；改后重启会话生效）`,
  ].join("\n");
}

/** 面板里的一行 skill 状态（07 号票）：细节留给 /jev-skill */
function skillLine(r: SkillSyncResult | null = skillSnapshot): string {
  if (!r) return "检查中…（后台同步官方 skill）";
  switch (r.status) {
    case "installed":
      return `✓ 已安装 ${short(r.commit)}`;
    case "updated":
      return `✓ 已更新 ${short(r.from)} → ${short(r.commit)}`;
    case "up-to-date":
      return `✓ 已是最新 ${short(r.commit)}`;
    case "local-edits":
      return `⚠ 本地有改动，跳过自动更新（${r.files.join("、")}）`;
    case "error":
      return `✗ 同步失败：${r.message}`;
  }
}

/** 会话启动时的被动提示：只在真发生事情时打扰 */
function skillNotice(
  r: SkillSyncResult,
): { text: string; level: "info" | "warning" } | null {
  switch (r.status) {
    case "installed":
      return {
        text: `TypeSafe skill 已安装到 ${SKILL_DIR}（${short(r.commit)}）`,
        level: "info",
      };
    case "updated":
      return {
        text: `TypeSafe skill 已更新 ${short(r.from)} → ${short(r.commit)}`,
        level: "info",
      };
    case "local-edits":
      return {
        text: `TypeSafe skill 上游有更新，但本地被改过（${r.files.join("、")}）——已跳过自动更新，/jev-skill update 可强制覆盖`,
        level: "warning",
      };
    case "error":
      // 装好的情况下同步失败多半是没网，静默；从没装上就得说一声
      return r.installed
        ? null
        : {
            text: `TypeSafe skill 未安装且同步失败：${r.message}`,
            level: "warning",
          };
    default:
      return null; // up-to-date 不打扰
  }
}


/**
 * 02 号票：/jev aa 子命令——AA key 管理（写入/清除）。
 * set 有 UI 时走交互输入，clear 有 UI 时先确认；非 TUI 模式退化为内联参数直行，
 * 避免在无人可答的 print/rpc 模式弹框卡死。缺失指引由 resolveAaKey 统一给出。
 */
async function handleAaCommand(
  verb: string | undefined,
  inline: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (verb === "clear") {
    if (ctx.hasUI) {
      const yes = await ctx.ui.confirm(
        "清除 AA key",
        "确认从 auth.json 删除 AA API key？",
      );
      if (!yes) {
        ctx.ui.notify("已取消清除", "info");
        return;
      }
    }
    const removed = await clearAaKey();
    ctx.ui.notify(
      removed ? "AA key 已从 auth.json 清除" : "auth.json 里本来就没有 AA key",
      "info",
    );
    return;
  }
  if (verb === "set") {
    let input = inline.trim();
    if (!input && ctx.hasUI) {
      const asked = await ctx.ui.input(
        "AA API key",
        "免费 key 注册：artificialanalysis.ai",
      );
      if (asked === undefined) {
        ctx.ui.notify("已取消写入", "info");
        return;
      }
      input = asked.trim();
    }
    if (!input) {
      ctx.ui.notify(
        "未提供 AA key：非交互模式请用 /jev aa set <key>，或设环境变量 AA_API_KEY",
        "warning",
      );
      return;
    }
    try {
      await saveAaKey(input);
      ctx.ui.notify("AA key 已存入 auth.json", "info");
    } catch (e) {
      ctx.ui.notify(
        `写入失败：${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
    }
    return;
  }
  if (verb) {
    ctx.ui.notify(
      "用法：/jev aa 看状态 · /jev aa set [key] 写入 · /jev aa clear 清除",
      "warning",
    );
    return;
  }
  const aa = await resolveAaKey();
  ctx.ui.notify(
    aa.key
      ? `AA key: ✓ ${aa.source}（${aa.key.slice(0, 6)}…${aa.key.slice(-4)}）`
      : (aa.guidance ?? "AA API key 未设置"),
    aa.key ? "info" : "warning",
  );
}

/**
 * Pi-Jev 扩展入口。
 * 已挂：/login Typesafe provider · jev tool（混型批量判断）· /jev 面板
 *      · 官方 skill 自动安装/更新 + /jev-skill。
 */
export default async function jev(pi: ExtensionAPI): Promise<void> {
  registerTypeSafeProvider(pi); // async 工厂：registerProvider 在启动期 flush

  // ponytail: 配置与 client 在扩展加载时定一次（原型规则：改配置重启会话生效），
  // 这样并发闸跨 tool 调用共享，不会被每次调用重建
  const cfg = await loadConfig();
  const run = await makeRunner(cfg, resolveKey);
  registerJevTools(pi, run);

  // 07 号票：skill 同步走网络，绝不 await 进启动路径；结果留到 session_start 里提示
  const skillSync = syncSkill();

  pi.on("session_start", (_event, ctx) => {
    void skillSync.then((r) => {
      skillSnapshot = r;
      const notice = skillNotice(r);
      if (notice) ctx.ui.notify(notice.text, notice.level);
    });
  });

  pi.registerCommand("jev-skill", {
    description: "TypeSafe 官方 skill：状态 / check 查更新 / update 强制同步",
    handler: async (args, ctx) => {
      const sub = args.trim().toLowerCase();
      if (sub === "update") {
        const r = await syncSkill({ force: true });
        skillSnapshot = r;
        ctx.ui.notify(skillLine(r), r.status === "error" ? "error" : "info");
        return;
      }
      if (sub === "check") {
        const c = await checkSkill();
        const text =
          c.status === "update-available"
            ? `上游有新版本（本地 commit ${short(c.commit)}）——/jev-skill update 同步`
            : c.status === "up-to-date"
              ? `已是最新（commit ${short(c.commit)}）`
              : `查不了：${c.detail ?? "未知原因"}`;
        ctx.ui.notify(
          text,
          c.status === "update-available" ? "info" : "warning",
        );
        return;
      }
      if (sub) {
        ctx.ui.notify("用法：/jev-skill [check|update]", "warning");
        return;
      }
      const state = await readSkillState();
      ctx.ui.notify(
        renderSkill(state, skillSnapshot),
        state ? "info" : "warning",
      );
    },
  });

  pi.registerCommand("jev", {
    description: "Jev (TypeSafe System One) 状态面板；/jev aa 管理 AA key（02 号票）",
    handler: async (args, ctx) => {
      // 02 号票：aa 子命令拦截在先；其它参数仍按老规则只看面板
      const [sub, verb, ...rest] = args.trim().split(/\s+/);
      if (sub === "aa") {
        await handleAaCommand(verb, rest.join(" "), ctx);
        return;
      }
      if (args.trim())
        ctx.ui.notify(
          "/jev 只看状态。要让 Jev 判断，直接让 agent 调 jev 工具（问题自带 type）。",
          "info",
        );
      const { key, source } = await resolveKey();
      ctx.ui.notify(
        renderPanel(cfg, key, source),
        source === "missing" ? "warning" : "info",
      );
    },
  });
}

// 票 03（Jev × Pi-Staffs 融合路由）：公开 runner 工厂与凭据/配置解析，供宿主侧路由层跨包取判断。
export { makeRunner } from "./core.ts";
export { loadConfig } from "./config.ts";
export { resolveKey, resolveAaKey, AA_ENV_KEY } from "./auth.ts";
