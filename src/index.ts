import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { resolveKey } from "./auth.js";
import { registerTypeSafeProvider } from "./provider.js";

/**
 * Pi-Jev 扩展入口。
 * 已挂：/login Typesafe provider（t2）· /jev 状态面板。
 * 待挂：t3 三 tool 真实现 · t5 registerAuthorizer。
 */
export default async function jev(pi: ExtensionAPI): Promise<void> {
  registerTypeSafeProvider(pi); // async 工厂：registerProvider 在启动期 flush

  pi.registerCommand("jev", {
    description: "Jev (TypeSafe System One) 状态面板；/jev <文本> 试一枪",
    handler: async (args, ctx) => {
      const cfg = await loadConfig();
      const { key, source } = await resolveKey();
      const keyLine =
        source === "missing"
          ? "✗ 未配置 —— 运行 pi login 选 TypeSafe，或设 TYPESAFE_API_KEY"
          : `✓ ${source}（${key!.slice(0, 6)}…${key!.slice(-4)}）`;
      if (!args.trim()) {
        ctx.ui.notify(
          [
            "Jev (TypeSafe System One) 状态",
            `  key:    ${keyLine}`,
            `  model:  ${cfg.model}   timeout: ${cfg.timeoutMs}ms   并发: ${cfg.maxConcurrent}`,
            `  低置信: choice<${cfg.lowConfidence.choice}  score<${cfg.lowConfidence.score}  noul±${cfg.lowConfidence.noulMargin}`,
            `  配置文件: ${CONFIG_PATH}（缺失=全默认）`,
            "  试一枪: /jev <任意文本>",
          ].join("\n"),
          source === "missing" ? "warning" : "info",
        );
        return;
      }
      ctx.ui.notify("试一枪：真端点待 08 号票接入", "info");
    },
  });
}
