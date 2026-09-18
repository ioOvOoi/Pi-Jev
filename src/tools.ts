import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { JevToolArgs, JevToolResult } from "./core.js";

/** Jev 不生成文本、不做对话：state 由调用方显式给出（04 号票 Q2） */
const STATE = Type.Unknown({
  description:
    "要评估的内容：文本 / JSON 对象 / 数组。由调用方显式给出，插件不会自动采集会话上下文",
});

/** 每问自带 type → 一个 tool 就能混型批量（API 一次请求并行答全部问题） */
const QUESTION = Type.Object({
  type: Type.Union(
    [Type.Literal("noul"), Type.Literal("choice"), Type.Literal("score")],
    {
      description:
        "问题类型：noul=是否判断 / choice=选项选一 / score=有序档位打分",
    },
  ),
  question: Type.String({
    description: "问题文本：把判断含义写完整（判据、对比、排除），一问一判断",
  }),
  trueMeans: Type.Optional(
    Type.String({ description: "noul：「是」代表什么（可选）" }),
  ),
  falseMeans: Type.Optional(
    Type.String({ description: "noul：「否」代表什么（可选）" }),
  ),
  options: Type.Optional(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()]), {
      description:
        "choice：选项 → 描述（null 表示不描述），至少 2 个；返回所选选项 + 全概率分布 + confidence",
    }),
  ),
  levels: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 2,
      description:
        "score：有序档位描述（从低到高），至少 2 档；返回概率加权分 + 各档概率 + confidence",
    }),
  ),
});

export type JevRunner = (args: JevToolArgs) => Promise<JevToolResult>;

/** 注册单个 jev tool；runner 由 index.ts 组装（config + key 解析 + 并发闸都在那里） */
export function registerJevTools(pi: ExtensionAPI, run: JevRunner): void {
  pi.registerTool({
    name: "jev",
    label: "Jev（System One 校准判断）",
    description:
      "用 TypeSafe Jev（System One）做校准概率判断：不生成文本、不做对话。传入 state（待评估材料）与 questions（每问自带 type：noul 是否判断 / choice 选项选一 / score 有序打分），一次请求并行回答全部问题。返回 { answers: { [id]: 按 type 给 noul 或 {choice,probabilities,confidence} 或 {score,legend,probabilities,confidence}，附 _lowConfidence? } }, usage, _keySource }；失败返回 { error: { code, message, hint? } }，永不 throw。",
    promptSnippet:
      "jev: 校准概率判断（noul 是否 / choice 选一 / score 打分），批量混型，一次请求",
    promptGuidelines: [
      "Use jev when you need a calibrated probability or structured selection instead of your own guess: yes/no → type noul; labelled options → type choice (options ≥ 2); ordered rubric → type score (levels ≥ 2).",
      "state 必须由你显式给出（待判断的原文/对象）；把用户的问题优化成规范 question（判据写全、一问一判断），不要照抄口语。",
      "返回 _lowConfidence: true 表示模型自己没底（choice/score 看 confidence，noul 看概率贴近 0.5）——当弱信号处理，必要时转问用户。",
    ],
    parameters: Type.Object({
      state: STATE,
      questions: Type.Record(
        Type.String({ description: "问题 id；答案按同一 id 返回" }),
        QUESTION,
        {
          description:
            "以 id 为键的问题表（至少一条；同一 state 下一次请求并行回答全部问题，可混型）",
        },
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await run(params as JevToolArgs);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        details: result,
        isError: "error" in result,
      };
    },
  });
}
