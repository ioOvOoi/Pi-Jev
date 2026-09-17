import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SKILL_DIR,
  SKILL_STATE_PATH,
  checkSkill,
  readSkillState,
  syncSkill,
} from "../src/skill.js";

/** 07 号票的真网络证据脚本：安装 / 无变化 / 检查更新 三态各跑一次 */
const tmp = await mkdtemp(join(tmpdir(), "jev-skill-probe-"));
const iso = {
  dir: join(tmp, "skills", "typesafe-ai"),
  statePath: join(tmp, "state.json"),
};

console.log("1) 隔离目录首次同步:", JSON.stringify(await syncSkill(iso)));
console.log(
  "2) 隔离目录再同步(应 up-to-date):",
  JSON.stringify(await syncSkill(iso)),
);
console.log("   隔离目录文件:", await readdir(iso.dir));
await rm(tmp, { recursive: true, force: true });

console.log("3) 真装全局:", JSON.stringify(await syncSkill()));
console.log("4) 复跑:", JSON.stringify(await syncSkill()));
console.log("5) checkSkill:", JSON.stringify(await checkSkill()));
console.log("   SKILL_DIR:", SKILL_DIR);
console.log(
  "   state:",
  SKILL_STATE_PATH,
  JSON.stringify(await readSkillState()),
);
console.log("   已装文件:", await readdir(SKILL_DIR));
console.log("   SKILL.md 前 6 行:");
console.log(
  (await readFile(join(SKILL_DIR, "SKILL.md"), "utf8"))
    .split("\n")
    .slice(0, 6)
    .join("\n"),
);
