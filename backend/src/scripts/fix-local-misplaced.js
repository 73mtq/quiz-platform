/**
 * 清理本地 data/quiz-data.json 第四章课程里多余的 409 道毛概题
 *
 * 背景：第四章 549 道 = 140 习思路题 + 409 毛概题被错放。
 *       Render 端没有"第四章"课程，毛概题在 Render"毛概"课里已有完整 412 道。
 *       本地冗余 409 道不影响 Render（data/quiz-data.json 在 .gitignore 里）。
 *       这个脚本纯粹是本地数据卫生清理。
 *
 * 安全：默认 dry-run。实际执行需要 --confirm（不只 --dry-run）。
 *       执行前自动备份 quiz-data.json 到 data/backups/。
 *
 * 用法：
 *   node backend/src/scripts/fix-local-misplaced.js            # dry-run
 *   node backend/src/scripts/fix-local-misplaced.js --confirm  # 实际删除
 */
import fs from "node:fs";
import path from "node:path";

const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const BACKUP_DIR = "D:\\claude_code\\auto_test\\quiz-platform\\data\\backups";
const MAOGAI_SOURCES = ["导论题库.md","第八章题库.md","第二章题库.md","第六章题库.md","第七章题库.md","第三章题库.md","第四章题库.md","第五章题库.md","第一章题库.md"];

const CONFIRM = process.argv.includes("--confirm");
const DRY_RUN = !CONFIRM;

function parseMdFile(content) {
  const stems = new Set();
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    let stem = null;
    const mA = line.match(/^\*\*\d+\.\s*\[(单选题|多选题|判断题)\]\s*(.+?)\*\*\s*[✅❌]?$/);
    if (mA) stem = mA[2].trim();
    if (!stem) {
      const mB = line.match(/^\*\*\d+\.\*\*\s*(.+)$/);
      if (mB) stem = mB[1].trim();
    }
    if (!stem) {
      const mC = line.match(/^#{2,3}\s*\d+\.\s*\[[✓✗]\]\s*(.+)$/);
      if (mC) stem = mC[1].trim();
    }
    if (stem) stems.add(stem);
    i++;
  }
  return stems;
}

console.log("=".repeat(80));
console.log(`本地 DB 第四章冗余清理  ${DRY_RUN ? "【DRY RUN】" : "【实际执行】"}`);
console.log("=".repeat(80));

// 读 DB
const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);
const d4 = db.courses.find(c => c.name === "第四章");
if (!d4) { console.error("DB 找不到第四章"); process.exit(1); }
console.log(`当前第四章: ${d4.questions.length} 题`);

// 建毛概 stem 索引
const maogaiStems = new Set();
for (const fname of MAOGAI_SOURCES) {
  const fp = path.join("D:\\桌面\\毛概\\毛概", fname);
  if (!fs.existsSync(fp)) continue;
  for (const s of parseMdFile(fs.readFileSync(fp, "utf8"))) maogaiStems.add(s);
}
console.log(`毛概 .md 源文件 stem: ${maogaiStems.size}`);

// 分类
const toRemove = [];  // 毛概题，要删
const toKeep = [];    // 真正的第四章题（习思想）
for (const q of d4.questions) {
  if (maogaiStems.has(q.stem)) toRemove.push(q);
  else toKeep.push(q);
}
console.log(`\n要删除（毛概题）: ${toRemove.length} 道`);
console.log(`要保留（真第四章习思路题）: ${toKeep.length} 道`);

if (toRemove.length) {
  console.log("\n前 5 个要删除的题：");
  for (const q of toRemove.slice(0, 5)) {
    console.log(`  [L${(q.answer || []).length}] ${q.stem.slice(0, 50)}...`);
  }
}

if (DRY_RUN) {
  console.log("\n" + "=".repeat(80));
  console.log("DRY RUN：没改任何东西。实际执行请加 --confirm");
  console.log("=".repeat(80));
  process.exit(0);
}

// 实际执行：先备份
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `quiz-data.${ts}.json`);
fs.copyFileSync(DB_PATH, backupPath);
console.log(`\n✓ 备份到: ${backupPath}`);

// 替换第四章题目
d4.questions = toKeep;
const newContent = JSON.stringify(db, null, 2) + "\n";
fs.writeFileSync(DB_PATH, newContent, "utf8");
console.log(`✓ 写回 DB`);
console.log(`✓ 第四章: 549 → ${d4.questions.length} 道（删了 ${toRemove.length} 道）`);
console.log(`✓ 新文件大小: ${fs.statSync(DB_PATH).size} bytes`);

console.log("\n" + "=".repeat(80));
console.log("完成！");
console.log("  - 本地第四章 549 → 140 题（剩下真正的习思路题）");
console.log("  - Render 端完全不受影响（data/*.json 在 .gitignore）");
console.log("  - 备份在 " + backupPath);
console.log("  - 如果要回滚：cp 备份文件回 quiz-data.json");
console.log("=".repeat(80));
