import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_PATH, type JevConfig } from "./config.js";
import { resolveKey } from "./auth.js";
import { makeRunner, type JevToolResult } from "./core.js";
import { registerJevTools } from "./tools.js";
import { registerTypeSafeProvider } from "./provider.js";
import { registerNoulAuthorizer, renderNoulLine } from "./permission.js";
import {
  SKILL_DIR,
  checkSkill,
  readSkillState,
  syncSkill,
  type SkillState,
  type SkillSyncResult,
} from "./skill.js";

/** /jev <命题>：用户输入本身即待判命题；state 用固定占位（validateArgs 要求非空） */
const PROBE_STATE = "（pi 会话直接输入，无额外上下文）";
const buildProbeQuestions = (text: string) => ({
  probe: { question: text },
});

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
  noulLine: string,
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
    `  把关:   ${noulLine}`,
    `  配置文件: ${CONFIG_PATH}（缺失=全默认；改后重启会话生效）`,
    "  试一枪: /jev <命题>（返回该命题为真的校准概率）",
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
 * Pi-Jev 扩展入口。
 * 已挂：/login Typesafe provider · 三 tool（jev_noul/choice/score）· /jev 面板 + 试一枪
 *      · 官方 skill 自动安装/更新 + /jev-skill · Noul 把关（Authorizer Chain，09 号票）。
 */
export default async function jev(pi: ExtensionAPI): Promise<void> {
  registerTypeSafeProvider(pi); // async 工厂：registerProvider 在启动期 flush

  // ponytail: 配置与 client 在扩展加载时定一次（原型规则：改配置重启会话生效），
  // 这样并发闸跨 tool 调用共享，不会被每次调用重建
  const cfg = await loadConfig();
  const run = await makeRunner(cfg, resolveKey);
  registerJevTools(pi, run);

  // 09 号票：Noul 把关。注册 ≠ 生效——用户还得在权限系统 config.json 里点名链名；
  // 服务端没装或没激活时只提示，不影响插件其余功能
  let notify:
    | ((text: string, level: "info" | "warning" | "error") => void)
    | null = null;
  const noul = registerNoulAuthorizer(pi, {
    cfg,
    run,
    enabled: cfg.permission.enabled,
    debugPath: process.env.PI_JEV_PERM_LOG,
    onMissing: (detail) =>
      notify?.(
        `Jev Noul 把关未挂上：${detail}（装 @gotgenes/pi-permission-system 后重启会话）`,
        "warning",
      ),
  });

  // 07 号票：skill 同步走网络，绝不 await 进启动路径；结果留到 session_start 里提示
  const skillSync = syncSkill();

  pi.on("session_start", (_event, ctx) => {
    notify = (text, level) => ctx.ui.notify(text, level);
    ctx.ui.notify(
      "Jev 已挂载 —— /jev 状态面板 · /jev <命题> 试一枪 · /jev-skill 管理官方 skill",
      "info",
    );
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
    description: "Jev (TypeSafe System One) 状态面板；/jev <命题> 判真假",
    handler: async (args, ctx) => {
      const { key, source } = await resolveKey();
      if (!args.trim()) {
        ctx.ui.notify(
          renderPanel(cfg, key, source, renderNoulLine(noul.status())),
          source === "missing" ? "warning" : "info",
        );
        return;
      }
      const t0 = Date.now();
      const result: JevToolResult = await run("noul", {
        state: PROBE_STATE,
        questions: buildProbeQuestions(args),
      });
      const ms = Date.now() - t0;
      if ("error" in result) {
        const hint = result.error.hint ? `（${result.error.hint}）` : "";
        ctx.ui.notify(
          `Jev 试一枪失败 —— ${result.error.code}: ${result.error.message}${hint}`,
          "error",
        );
        return;
      }
      const a = Object.values(result.answers)[0] as
        | { noul?: number; _lowConfidence?: boolean }
        | undefined;
      const pct =
        a && typeof a.noul === "number"
          ? `${Math.round(a.noul * 100)}%`
          : "未知";
      const low = a?._lowConfidence ? " · 低置信" : "";
      const quote = args.length > 20 ? `${args.slice(0, 20)}…` : args;
      ctx.ui.notify(
        `Jev 试一枪：${pct} —— 「${quote}」为真的概率${low}\nkey：${source} · 输入 ${result.usage.input_tokens} / 输出 ${result.usage.output_tokens} token · ${ms}ms`,
        "info",
      );
    },
  });
}
