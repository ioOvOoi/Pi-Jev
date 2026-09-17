import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createProvider } from "@earendil-works/pi-ai";
// 0.85.1 根导出没有 openAICompletionsApi，只有 lazy 子路径导出（pi 文档示例针对更新版本）
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

/** TypeSafe 平台 API 根（02 号票：单端点 POST /v1/systemone） */
export const TYPESAFE_BASE_URL = "https://api.typesafe.ai/v1";
export const TYPESAFE_PROVIDER_ID = "typesafe";

/**
 * 把 TypeSafe 注册为 /login 原生 provider（01 号票结论）。
 * Jev 不是聊天模型（models 空）：注册只为让 /login 收录 TypeSafe，
 * 走 pi 原生交互收 key 并落 auth.json（{[id]:{type:"api_key",key}}）。
 */
export function registerTypeSafeProvider(pi: ExtensionAPI): void {
    pi.registerProvider(
        createProvider({
            id: TYPESAFE_PROVIDER_ID,
            name: "TypeSafe (Jev)",
            baseUrl: TYPESAFE_BASE_URL,
            auth: {
                apiKey: {
                    name: "TypeSafe API key",
                    async login(interaction) {
                        return {
                            type: "api_key",
                            key: await interaction.prompt({
                                type: "secret",
                                message:
                                    "TypeSafe API key（console.typesafe.ai → API keys）",
                            }),
                        };
                    },
                    async resolve({ credential }) {
                        // 只有存了 key 才算命中本 provider，否则交给 pi 的后续凭证链（env 等）
                        return credential?.key
                            ? {
                                  auth: { apiKey: credential.key },
                                  source: "auth.json",
                              }
                            : undefined;
                    },
                },
            },
            models: [],
            // Jev 非聊天模型（models 空），此 api 仅为满足 createProvider 契约
            api: openAICompletionsApi(),
        }),
    );
}
