# 06-login-key

Type: task
Status: open
Blocked by: 01, 05

## Question

（前提已被 01 号研究修正）TypeSafe 的 key 走 pi 原生路径：扩展用 pi.registerProvider + createProvider({auth:{apiKey:{login}}}) 注册成 /login 原生 provider，key 由 pi 存入 ~/.pi/agent/auth.json（{[providerId]:{type:"api_key",key}}）。待决策：① 是否还做 /jev login 命令把 key 同步写 provider-keys.json（仅为兼容第三方 zai 管理工具的旁路记录，pi 鉴权不读它）；② 若做，两处 key 不一致时以谁为准。
