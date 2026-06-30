/**
 * 审计第四章课程里 549 道题的去向
 * 1. 读本地 data/quiz-data.json 第四章所有题
 * 2. 读 17 个习思想源文件 + 9 个毛概 .md 源文件
 * 3. 找哪些题 stem 在所有源文件都找不到（孤儿题）
 * 4. 输出清单
 */
import fs from "node:fs";
import path from "node:path";

const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const XX_SI_DIR = "D:\\桌面\\习思想\\习思题库";
const XX_SI_FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];
const MAOGAI_DIR = "D:\\桌面\\毛概\\毛概";
const MAOGAI_FILES = ["导论题库.md","第八章题库.md","第二章题库.md","第六章题库.md","第七章题库.md","第三章题库.md","第四章题库.md","第五章题库.md","第一章题库.md"];

// 复制 parseTxtFile / parseMdQuestions 的核心
function parseTxtFile(content) {
  const out = [];
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim());
    const stemStart = lines.findIndex(l => /^题目\s+\d+/.test(l));
    const optionsStart = lines.findIndex(l => /^选项[:：]$/i.test(l));
    const answerStart = lines.findIndex(l => /^答案[:：]$/i.test(l));
    const typeStart = lines.findIndex(l => /^类型[:：]/i.test(l));
    if (stemStart === -1 || optionsStart === -1 || answerStart === -1) continue;
    const stemLine = lines[stemStart];
    const colonIdx = stemLine.indexOf("):");
    const stemFromHeader = colonIdx !== -1 ? stemLine.slice(colonIdx + 2).trim() : "";
    const stemBody = stemFromHeader || lines.slice(stemStart + 1, optionsStart).join(" ").trim();
    if (stemBody) out.push({ stem: stemBody });
  }
  return out;
}

function parseMdFile(content) {
  const out = [];
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
    if (stem) out.push({ stem });
    i++;
  }
  return out;
}

// 1. 读 DB 第四章
const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);
const d4 = db.courses.find(c => c.name === "第四章");
if (!d4) { console.error("DB 找不到第四章"); process.exit(1); }
console.log(`DB 第四章: ${d4.questions.length} 题`);

// 2. 建所有源文件 stem 索引
const allStems = new Map();  // stem → { srcFile, courseType }
for (const fname of XX_SI_FILES) {
  const fp = path.join(XX_SI_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const qs = parseTxtFile(fs.readFileSync(fp, "utf8"));
  for (const q of qs) {
    if (!allStems.has(q.stem)) allStems.set(q.stem, { srcFile: fname, type: "习思想" });
  }
}
for (const fname of MAOGAI_FILES) {
  const fp = path.join(MAOGAI_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const qs = parseMdFile(fs.readFileSync(fp, "utf8"));
  for (const q of qs) {
    if (!allStems.has(q.stem)) allStems.set(q.stem, { srcFile: fname, type: "毛概" });
  }
}
console.log(`所有源文件唯一 stem: ${allStems.size}`);

// 3. 对每道第四章题分类
const traced = [];      // 能找到源
const orphans = [];     // 找不到源
for (const q of d4.questions) {
  const src = allStems.get(q.stem);
  if (src) traced.push({ id: q.id, stem: q.stem.slice(0, 60), srcFile: src.srcFile, srcType: src.type });
  else orphans.push({ id: q.id, stem: q.stem.slice(0, 60), answerLen: (q.answer || []).length });
}

console.log(`\n第四章 ${d4.questions.length} 题分类：`);
console.log(`  ✓ 能追溯到源文件: ${traced.length}`);
console.log(`  ❌ 孤儿题（无源）: ${orphans.length}`);

// 按追溯到的源文件分类
const bySrc = {};
for (const t of traced) {
  const k = `${t.srcType}/${t.srcFile}`;
  bySrc[k] = (bySrc[k] || 0) + 1;
}
console.log("\n追溯到源文件分布：");
for (const [k, n] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(30)}: ${n} 道`);
}

// 4. 孤儿题分析
console.log("\n" + "=".repeat(80));
console.log(`孤儿题（${orphans.length} 道，找不到任何源文件）`);
console.log("=".repeat(80));

// 按 answer 长度分类
const orphanByAnsLen = {};
for (const o of orphans) {
  orphanByAnsLen[o.answerLen] = (orphanByAnsLen[o.answerLen] || 0) + 1;
}
console.log("\n孤儿题 answer 长度分布：");
for (const [k, n] of Object.entries(orphanByAnsLen).sort((a, b) => +a[0] - +b[0])) {
  console.log(`  L${k}: ${n} 道`);
}

// 抽样孤儿题
console.log("\n前 20 个孤儿题：");
for (const o of orphans.slice(0, 20)) {
  console.log(`  [id=${o.id}] L${o.answerLen} ${o.stem}...`);
}

// 按"可能匹配到"分组（stem 前 30 字前缀是否在源里）
console.log("\n尝试按 stem 前 20 字做模糊匹配（前缀命中）...");
const stemsByPrefix = new Map();
for (const [stem, info] of allStems) {
  const prefix = stem.slice(0, 20);
  if (!stemsByPrefix.has(prefix)) stemsByPrefix.set(prefix, []);
  stemsByPrefix.get(prefix).push({ stem, ...info });
}
let prefixHit = 0;
for (const o of orphans) {
  const prefix = o.stem.slice(0, 20);
  if (stemsByPrefix.has(prefix)) prefixHit++;
}
console.log(`  按 stem 前 20 字模糊匹配，孤儿题有 ${prefixHit}/${orphans.length} 道可能跟源里的某道题相关`);
