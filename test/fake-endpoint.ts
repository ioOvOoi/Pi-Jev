import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

export interface FakeEndpoint {
  url: string;
  close(): Promise<void>;
  /** 服务端观测到的最大并发数（验并发闸）；getter，读的是实时值 */
  readonly maxConcurrent: number;
  /** 收到的请求体（逐条） */
  bodies: any[];
}

/** 假 TypeSafe 端点：POST /v1/systemone，按问题 type 造答案，附带鉴权/路径记录 */
export async function startFakeTypeSafe(
  opts: { delayMs?: number; status?: number; body?: unknown } = {},
): Promise<FakeEndpoint> {
  const state = { maxConcurrent: 0, bodies: [] as any[], inflight: 0 };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      state.inflight++;
      state.maxConcurrent = Math.max(state.maxConcurrent, state.inflight);
      const body = raw ? JSON.parse(raw) : {};
      state.bodies.push({
        url: req.url,
        auth: req.headers.authorization,
        body,
      });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      state.inflight--;
      if (opts.status) {
        res.writeHead(opts.status, { "content-type": "application/json" });
        res.end(JSON.stringify(opts.body ?? { message: "forced" }));
        return;
      }
      const answers: Record<string, unknown> = {};
      for (const [id, q] of Object.entries<any>(body.questions ?? {})) {
        answers[id] =
          q.type === "noul"
            ? { type: "noul", noul: 0.5 } // 故意贴 0.5：验 _lowConfidence
            : q.type === "choice"
              ? {
                  type: "choice",
                  choice: Object.keys(q.criteria)[0],
                  confidence: 0.4,
                  probabilities: Object.fromEntries(
                    Object.keys(q.criteria).map((k: string) => [
                      k,
                      1 / Object.keys(q.criteria).length,
                    ]),
                  ),
                }
              : {
                  type: "score",
                  score: 1.5,
                  confidence: 0.9,
                  legend: q.criteria,
                  probabilities: Object.fromEntries(
                    q.criteria.map((_: unknown, i: number) => [
                      i,
                      1 / q.criteria.length,
                    ]),
                  ),
                };
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          model: body.model ?? "jev-latest",
          answers,
          usage: { input_tokens: 7, output_tokens: 3 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${addr.port}`,
    get maxConcurrent() {
      return state.maxConcurrent;
    },
    bodies: state.bodies,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
