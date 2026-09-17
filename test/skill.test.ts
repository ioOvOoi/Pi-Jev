import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  parseTarGz,
  pickSkillFiles,
  readSkillState,
  syncSkill,
  type SkillState,
} from "../src/skill.js";

// ---------------------------------------------------------------------------
// 造一个真 tar（长路径走 pax 扩展头）+ gzip：不引第三方依赖，也不依赖本机 tar
// ---------------------------------------------------------------------------

const enc = new TextEncoder();
const pad512 = (b: Uint8Array, into: Uint8Array[]): void => {
  into.push(b);
  const rest = (512 - (b.length % 512)) % 512;
  if (rest) into.push(new Uint8Array(rest));
};

const tarHeader = (name: string, size: number, type: string): Uint8Array => {
  const h = new Uint8Array(512);
  const put = (off: number, str: string) => h.set(enc.encode(str), off);
  put(0, name.slice(0, 100));
  put(100, "0000644\0");
  put(108, "0000000\0");
  put(116, "0000000\0");
  put(124, `${size.toString(8).padStart(11, "0")}\0`);
  put(136, "00000000000\0");
  put(148, "        "); // 校验和先填空格
  put(156, type);
  put(257, "ustar\0");
  put(263, "00");
  let sum = 0;
  for (const b of h) sum += b;
  put(148, `${sum.toString(8).padStart(6, "0")}\0 `);
  return h;
};

const makeTar = (
  files: Record<string, string>,
  dirs: string[] = [],
): Uint8Array => {
  const out: Uint8Array[] = [];
  for (const d of dirs) out.push(tarHeader(d, 0, "5"));
  for (const [name, body] of Object.entries(files)) {
    const data = enc.encode(body);
    if (name.length > 100) {
      // pax 记录：长度字段含自身位数，迭代到自洽
      const payload = ` path=${name}\n`;
      let len = payload.length + 1;
      while (`${len}`.length + payload.length !== len)
        len = `${len}`.length + payload.length;
      const rec = enc.encode(`${len}${payload}`);
      out.push(tarHeader(`pax-${name.length}`, rec.length, "x"));
      pad512(rec, out);
    }
    out.push(tarHeader(name, data.length, "0"));
    pad512(data, out);
  }
  out.push(new Uint8Array(1024)); // 两个全零块 = 归档结束
  const total = out.reduce((n, b) => n + b.length, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const b of out) {
    tar.set(b, off);
    off += b.length;
  }
  return tar;
};

const archive = (files: Record<string, string>): Uint8Array =>
  gzipSync(makeTar(files, ["skills-main/", "skills-main/skills/"]));

// ---------------------------------------------------------------------------
// 假 fetch：按调用方式作答，把真实网络行为（304 / ETag）建模出来
// ---------------------------------------------------------------------------

interface Fake {
  body: Uint8Array;
  etag: string;
  calls: string[];
  commit: string;
}

const fakeFetch = (f: Fake): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    f.calls.push(`${method} ${url.includes("/commits/") ? "atom" : "tarball"}`);
    if (url.includes("/commits/"))
      return new Response(
        `<feed><id>tag:github.com,2008:Grit::Commit/${f.commit}</id></feed>`,
        { status: 200 },
      );
    if (method === "HEAD") {
      const inm = (init?.headers as Record<string, string> | undefined)?.[
        "If-None-Match"
      ];
      if (inm && inm === f.etag) return new Response(null, { status: 304 });
      return new Response(null, { status: 200, headers: { etag: f.etag } });
    }
    // 显式给 ArrayBuffer：Node 24 的类型不认 Uint8Array<ArrayBufferLike> 当 BodyInit
    const body = f.body.buffer.slice(
      f.body.byteOffset,
      f.body.byteOffset + f.body.byteLength,
    ) as ArrayBuffer;
    return new Response(body, { status: 200, headers: { etag: f.etag } });
  }) as typeof fetch;

const skillFile = (marker: string) =>
  `---\nname: typesafe-ai\ndescription: TypeSafe API skill ${marker}\n---\n\n# TypeSafe\n${marker}\n`;

const sandbox = async (t: {
  after: (fn: () => Promise<void> | void) => void;
}) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-jev-skill-"));
  const statePath = join(dir, "state.json");
  const skillDir = join(dir, "skills", "typesafe-ai");
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, statePath, skillDir };
};

// ---------------------------------------------------------------------------

/** 造一条 >100 字符的相对路径，逼 pax 头出场 */
const longRel = `notes/${"x".repeat(120)}.md`;

test("tar 解析：目录项跳过、pax 长路径生效、子树剥离正确", () => {
  const long = `skills-main/skills/typesafe-ai/${longRel}`;
  const tar = parseTarGz(
    gzipSync(
      makeTar(
        {
          "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
          [long]: "deep",
          "skills-main/README.md": "上游其它文件",
        },
        ["skills-main/", "skills-main/skills/"],
      ),
    ),
  );
  assert.equal(
    new TextDecoder().decode(tar.get(long)!),
    "deep",
    "pax 长路径必须解析出来",
  );
  const picked = pickSkillFiles(tar);
  assert.deepEqual([...picked.keys()].sort(), ["SKILL.md", longRel]);
  assert.match(new TextDecoder().decode(picked.get("SKILL.md")!), /v1/);
});

test("首次同步 = installed：文件落盘 + 清单写入 + 版本号来自 atom", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({
      "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
      "skills-main/skills/typesafe-ai/LICENSE": "MIT",
      "skills-main/README.md": "不该被装上",
    }),
    etag: `"etag-1"`,
    calls: [],
    commit: "a".repeat(40),
  };
  const r = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
  });
  assert.equal(r.status, "installed");
  assert.match(
    await readFile(join(skillDir, "SKILL.md"), "utf8"),
    /description: TypeSafe API skill v1/,
  );
  assert.equal(await readFile(join(skillDir, "LICENSE"), "utf8"), "MIT");
  await assert.rejects(() => readFile(join(skillDir, "README.md"), "utf8"));
  const state = (await readSkillState(statePath)) as SkillState;
  assert.equal(state.commit, "a".repeat(40));
  assert.deepEqual(Object.keys(state.files).sort(), ["LICENSE", "SKILL.md"]);
});

test("上游未动 = up-to-date：只发 HEAD，不下载", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({
      "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
    }),
    etag: `"etag-1"`,
    calls: [],
    commit: "b".repeat(40),
  };
  await syncSkill({ dir: skillDir, statePath, fetchImpl: fakeFetch(f) });
  f.calls.length = 0;
  const r = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
  });
  assert.equal(r.status, "up-to-date");
  assert.deepEqual(f.calls, ["HEAD tarball"], "304 路径不该再下载 tarball");
});

test("上游内容变 = updated：文件与清单一起更新", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({
      "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
    }),
    etag: `"etag-1"`,
    calls: [],
    commit: "c".repeat(40),
  };
  await syncSkill({ dir: skillDir, statePath, fetchImpl: fakeFetch(f) });
  f.body = archive({
    "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v2"),
  });
  f.etag = `"etag-2"`;
  f.commit = "d".repeat(40);
  const r = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
  });
  assert.equal(r.status, "updated");
  assert.match(await readFile(join(skillDir, "SKILL.md"), "utf8"), /v2/);
  const state = (await readSkillState(statePath)) as SkillState;
  assert.equal(state.commit, "d".repeat(40));
  assert.equal(state.etag, `"etag-2"`);
});

test("本地改过 = local-edits（不覆盖）；force 才覆盖", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({
      "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
    }),
    etag: `"etag-1"`,
    calls: [],
    commit: "e".repeat(40),
  };
  await syncSkill({ dir: skillDir, statePath, fetchImpl: fakeFetch(f) });
  await writeFile(join(skillDir, "SKILL.md"), "我的手工改动");
  f.body = archive({
    "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v2"),
  });
  f.etag = `"etag-2"`;
  const r = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
  });
  assert.equal(r.status, "local-edits");
  assert.deepEqual(r.status === "local-edits" ? r.files : [], ["SKILL.md"]);
  assert.equal(
    await readFile(join(skillDir, "SKILL.md"), "utf8"),
    "我的手工改动",
    "自动路径必须保住本地改动",
  );
  const forced = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
    force: true,
  });
  assert.equal(forced.status, "updated");
  assert.match(await readFile(join(skillDir, "SKILL.md"), "utf8"), /v2/);
});

test("上游缺 SKILL.md = error（布局变了要吵，不许静默装个残的）", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({ "skills-main/skills/typesafe-ai/LICENSE": "MIT" }),
    etag: `"etag-1"`,
    calls: [],
    commit: "f".repeat(40),
  };
  const r = await syncSkill({
    dir: skillDir,
    statePath,
    fetchImpl: fakeFetch(f),
  });
  assert.equal(r.status, "error");
  assert.equal(r.status === "error" && r.installed, false);
  await assert.rejects(() => readFile(join(skillDir, "SKILL.md"), "utf8"));
});

test("上游删掉的文件会被清掉，用户自己加的文件保留", async (t) => {
  const { statePath, skillDir } = await sandbox(t);
  const f: Fake = {
    body: archive({
      "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v1"),
      "skills-main/skills/typesafe-ai/old.md": "旧文件",
    }),
    etag: `"etag-1"`,
    calls: [],
    commit: "1".repeat(40),
  };
  await syncSkill({ dir: skillDir, statePath, fetchImpl: fakeFetch(f) });
  await writeFile(join(skillDir, "mine.md"), "我加的");
  f.body = archive({
    "skills-main/skills/typesafe-ai/SKILL.md": skillFile("v2"),
  });
  f.etag = `"etag-2"`;
  await syncSkill({ dir: skillDir, statePath, fetchImpl: fakeFetch(f) });
  await assert.rejects(() => readFile(join(skillDir, "old.md"), "utf8"));
  assert.equal(await readFile(join(skillDir, "mine.md"), "utf8"), "我加的");
});
