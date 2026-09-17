import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_PATH, type JevConfig } from "./config.js";
import { resolveKey } from "./auth.js";
import { makeRunner, type JevToolResult } from "./core.js";
import { registerJevTools } from "./tools.js";
import { registerTypeSafeProvider } from "./provider.js";

/** /jev <文本> 的罐头试一枪问题（04 号票 Q3：只为验证 key 与链路） */
const SMOKE_QUESTION = {
  smoke: { question: "这段文本是否描述了需要立即处理的问题？" },
};

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
    `  配置文件: ${CONFIG_PATH}（缺失=全默认；改后重启会话生效）`,
    "  试一枪: /jev <任意文本>（罐头 Noul 问题，只验证 key 与链路）",
  ].join("\n");
}

/**
 * Pi-Jev 扩展入口。
 * 已挂：/login Typesafe provider · 三 tool（jev_noul/choice/score）· /jev 面板 + 试一枪。
 * 待挂：t5 registerAuthorizer（Noul 把关）。
 */
export default async function jev(pi: ExtensionAPI): Promise<void> {
  registerTypeSafeProvider(pi); // async 工厂：registerProvider 在启动期 flush

  // ponytail: 配置与 client 在扩展加载时定一次（原型规则：改配置重启会话生效），
  // 这样并发闸跨 tool 调用共享，不会被每次调用重建
  const cfg = await loadConfig();
  const run = await makeRunner(cfg, resolveKey);
  registerJevTools(pi, run);

  pi.registerCommand("jev", {
    description: "Jev (TypeSafe System One) 状态面板；/jev <文本> 试一枪",
    handler: async (args, ctx) => {
      const { key, source } = await resolveKey();
      if (!args.trim()) {
        ctx.ui.notify(
          renderPanel(cfg, key, source),
          source === "missing" ? "warning" : "info",
        );
        return;
      }
      const result: JevToolResult = await run("noul", {
        state: args,
        questions: SMOKE_QUESTION,
      });
      ctx.ui.notify(
        JSON.stringify(result, null, 2),
        "error" in result ? "error" : "info",
      );
    },
  });
}
