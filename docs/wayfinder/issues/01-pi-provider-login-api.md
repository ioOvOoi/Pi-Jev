# 01-pi-provider-login-api

Type: research
Status: closed

## Question

pi 扩展能否把「TypeSafe」注册成 /login 里可选的 provider（key 落 provider-keys.json）？调查：① 已装扩展 pi-ollama-cloud 如何注册 provider（源码在 C:/Users/Administrator/.pi/agent/npm/node_modules/）；② pi 官方扩展/provider API（C:/Users/Administrator/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/ 的 README 与 docs/）。产出：可行路径（API 名/类型/最小代码形状）或不可行结论 + 替代方案（/jev login 自有命令直写 provider-keys.json）。研究文件：research/pi-provider-login.md

## Answer

可行：pi.registerProvider(id, config)（docs/custom-provider.md）即可让 TypeSafe 出现在 /login；要自定义取 key 交互，用 createProvider({auth:{apiKey:{login(interaction) → {type:"api_key", key}}}})。

关键更正：登录取得的 key 由 pi 存入 ~/.pi/agent/auth.json（{[providerId]:{type:"api_key",key}}；FileAuthStorageBackend，dist/core/auth-storage.js:17,284；getAuthJsonPath config.js:436-438），**不是 provider-keys.json**——后者是第三方 zai 管理工具的旁路文件（pi dist 与全部已装扩展 0 处引用），写它不产生任何鉴权效果。pi 凭证链：runtime 覆盖 → apiKey:"$ENV" 配置 → auth.json。

参照实现：pi-ollama-cloud/index.ts = pi.registerProvider("ollama-cloud", {name, baseUrl, apiKey:"$OLLAMA_API_KEY", api:"openai-completions", models, refreshModels})；key 读取走 ctx.modelRegistry.getApiKeyForProvider(provider)（auth.json 链）+ env 回退（utils.ts getCloudApiKey）。

→ 06 号票按原生路径实现；/jev login 仅作为兼容第三方工具的可选旁路。详情：research/pi-provider-login.md
