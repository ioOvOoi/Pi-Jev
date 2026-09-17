# CONTEXT — Pi-Jev 词汇表

> 仅术语与语义，不含实现细节。实现决策见 docs/wayfinder/。

## Jev

TypeSafe 的旗舰 System One 模型。输入 state 与类型化问题，返回结构化判断与概率；不生成文本、不做对话。

## System One

一类为「快而校准的结构化决策」训练的模型类别：像 LLM 一样读自然语言，但返回类型化判断与概率而非生成文本。概率对结果校准。

## State

一次请求中被评估的内容：string / object / array。由调用方显式传入，Pi-Jev 不自动采集会话上下文。

## Question（noul / choice / score）

对同一 state 的三种类型化问题：

- **noul**：是否题，返回 yes 概率（0-1）。
- **choice**：从给定选项集中选一，返回所选选项 + 全概率分布 + confidence。
- **score**：沿有序档位打分，返回概率加权分（可落在档位之间）+ 各档概率 + confidence。

一次请求可混用多问；同一批问题共享同一 state、互相独立。

## Probability vs Confidence

- **probability**：各选项/档位上的概率分布成员。
- **confidence**：Choice/Score 答案自带的标量（0-1），是分布「形状」的统计量——集中则高、平坦则低。**Noul 答案没有 confidence**。

## 低置信标记（_lowConfidence）

Pi-Jev 工具返回体上的布尔提示：choice/score = confidence 低于阈值；noul = 概率落在 0.5±noulMargin 区间（离 0.5 太近即「拿不准」）。仅是提示，不改变答案本身。

## Pi-Jev

本插件：把 Jev 接进 pi 的扩展。凭证永远来自 TYPESAFE_API_KEY 环境变量或 pi auth.json，不进配置文件。
