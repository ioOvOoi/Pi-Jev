import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SKILL_DIR,
  SKILL_STATE_PATH,
  checkSkill,
  readSkillState,
  syncSkill,
  type SkillCheckResult,
  type SkillSyncResult,
} from "../src/skill.js";

/** 07 号票的真网络证据脚本：安装 / 无变化 / 检查更新 三态各跑一次；人类可读输出 */
const short = (c: string) => c.slice(0, 7);

const describeSync = (r: SkillSyncResult): string => {
  switch (r.status) {
    case "installed":
      return `已安装（${r.files.length} 个文件，commit ${short(r.commit)}）`;
    case "updated":
      return `远端有更新，已同步到 ${short(r.commit)}（${r.files.length} 个文件）`;
    case "up-to-date":
      return `已是最新（commit ${short(r.commit)}）`;
    case "local-edits":
      return `检测到本地改动，拒绝覆盖：${r.files.join("、")}`;
    case "error":
      return `出错：${r.message}${r.installed ? "（本地保留旧版）" : "（未安装）"}`;
  }
};

const describeCheck = (r: SkillCheckResult): string => {
  if (r.status === "up-to-date") return "已是最新";
  if (r.status === "update-available")
    return "远端有新版本（跑一次同步即可更新）";
  return "无法判断（网络或权限问题）";
};

const tmp = await mkdtemp(join(tmpdir(), "jev-skill-probe-"));
const iso = {
  dir: join(tmp, "skills", "typesafe-ai"),
  statePath: join(tmp, "state.json"),
};

console.log("== 隔离目录（临时目录，不碰全局） ==");
console.log(`1) 首次同步 → ${describeSync(await syncSkill(iso))}`);
console.log(`2) 再同步   → ${describeSync(await syncSkill(iso))}`);
console.log(`   文件：${(await readdir(iso.dir)).join("、")}`);
await rm(tmp, { recursive: true, force: true });

console.log("\n== 全局安装（真实 ~/.pi/agent/skills/typesafe-ai） ==");
const bad = 0;
const s3 = await syncSkill();
console.log(`3) 真装全局 → ${describeSync(s3)}`);
console.log(`4) 复跑     → ${describeSync(await syncSkill())}`);
const chk = await checkSkill();
console.log(`5) 检查更新 → ${describeCheck(chk)}`);
console.log(`   SKILL_DIR：${SKILL_DIR}`);
const st = await readSkillState();
console.log(
  `   state：${SKILL_STATE_PATH}${st ? `（commit ${short(st.commit)}，装于 ${st.installedAt}）` : "（无）"}`,
);
console.log(`   已装文件：${(await readdir(SKILL_DIR)).join("、")}`);
console.log("   SKILL.md 前 6 行：");
console.log(
  (await readFile(join(SKILL_DIR, "SKILL.md"), "utf8"))
    .split("\n")
    .slice(0, 6)
    .join("\n"),
);
if (s3.status === "error" || chk.status === "unknown") process.exit(1);
