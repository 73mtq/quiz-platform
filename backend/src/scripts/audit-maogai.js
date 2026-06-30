/**
 * 审计毛概 .md 题库 vs Render 上"毛概"课程的差异
 * 用法：node backend/src/scripts/audit-maogai.js
 *
 * 复制自 import-md-files.js parseMdQuestions（保持上游同步需手动更新）
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\毛概\\毛概";
const FILES = ["导论题库.md","第八章题库.md","第二章题库.md","第六章题库.md","第七章题库.md","第三章题库.md","第四章题库.md","第五章题库.md","第一章题库.md"];
const RENDER_URL = "https://quiz-platform-fbxp.onrender.com";

// ========== 复制自 import-md-files.js ==========
function parseMdQuestions(text) {
  const questions = [];
  const lines = text.split("\n");
  let currentSectionType = "single";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const sectionMatch = line.match(/^#+\s*[一二三四五六七八九十]+[.、]\s*(单选题|多选题|判断题)/);
    if (sectionMatch) {
      const t = sectionMatch[1];
      currentSectionType = t === "单选题" ? "single" : t === "多选题" ? "multi" : "judgement";
      i++;
      continue;
    }
    let stem = null;
    let explicitType = null;
    const mA = line.match(/^\*\*\d+\.\s*\[(单选题|多选题|判断题)\]\s*(.+?)\*\*\s*[✅❌]?$/);
    if (mA) {
      stem = mA[2].trim();
      explicitType = mA[1] === "单选题" ? "single" : mA[1] === "多选题" ? "multi" : "judgement";
    }
    if (!stem) {
      const mB = line.match(/^\*\*\d+\.\*\*\s*(.+)$/);
      if (mB) stem = mB[1].trim();
    }
    if (!stem) {
      const mC = line.match(/^#{2,3}\s*\d+\.\s*\[[✓✗]\]\s*(.+)$/);
      if (mC) stem = mC[1].trim();
    }
    if (!stem) { i++; continue; }
    const options = [];
    let answerRaw = "";
    let explanation = "";
    i++;
    while (i < lines.length) {
      const l = lines[i].trim();
      if (l === "---" || l.match(/^\*\*\d+\.\s*(\[|.*\*\*)/) || l.match(/^#{2,3}\s*\d+\./) || l.match(/^#+\s*[一二三四五六七八九十]+[.、]/)) break;
      const optMatch = l.match(/^- ([A-Z])\.\s*(.+)$/);
      if (optMatch) { options.push({ key: optMatch[1], text: optMatch[2].trim() }); i++; continue; }
      const ansA = l.match(/^>\s*\*?\*?正确答案[：:]\s*(.+?)\*?\*?\s*$/);
      if (ansA) { answerRaw = ansA[1].trim(); i++; continue; }
      const ansB = l.match(/^>\s*\*?\*?答案[：:]\s*(.+?)\*?\*?\s*$/);
      if (ansB) { answerRaw = ansB[1].trim(); i++; continue; }
      const ansC = l.match(/\*?\*?正确答案[：:]\*?\*?\s*([A-Z对错]+)/);
      if (ansC) { answerRaw = ansC[1].trim(); i++; continue; }
      const explMatch = l.match(/(?:>|^)\s*答案解析[：:]\s*(.+)$/);
      if (explMatch) { explanation = explMatch[1].trim(); i++; continue; }
      if (l.match(/\*?\*?我的答案[：:]/)) { i++; continue; }
      i++;
    }
    if (!options.length || !answerRaw) continue;
    const type = explicitType || currentSectionType;
    let answer;
    if (type === "judgement") {
      const normalized = answerRaw.replace(/[Aa]$/, "对").replace(/[Bb]$/, "错");
      answer = [normalized === "对" || normalized === "正确" ? "对" : "错"];
      options.length = 0;
      options.push({ key: "对", text: "对" }, { key: "错", text: "错" });
    } else if (type === "multi") {
      answer = answerRaw.replace(/[、,\s]/g, "").split("").filter((c) => /[A-Z]/.test(c));
    } else {
      const letter = answerRaw.replace(/[、,\s]/g, "").charAt(0).toUpperCase();
      answer = [letter];
    }
    questions.push({ stem, type, options, answer, explanation: explanation || null });
  }
  return questions;
}
// ========== end copy ==========

console.log("=".repeat(80));
console.log("Step 1: 解析毛概 .md 题库");
console.log("=".repeat(80));
const stemIndex = new Map();  // stem → { srcFile, parsedQuestion }
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) { console.log(`  ⚠️ 缺: ${fname}`); continue; }
  const content = fs.readFileSync(fp, "utf8");
  const qs = parseMdQuestions(content);
  let dup = 0;
  for (const q of qs) {
    if (stemIndex.has(q.stem)) dup++;
    else stemIndex.set(q.stem, { ...q, srcFile: fname });
  }
  const byType = { single: 0, multi: 0, judgement: 0 };
  for (const q of qs) byType[q.type] = (byType[q.type] || 0) + 1;
  console.log(`  ${fname.padEnd(20)}: ${qs.length} 题  (单${byType.single} 多${byType.multi} 判${byType.judgement})  撞库${dup}`);
}
console.log(`\n总: 唯一 stem ${stemIndex.size}`);

console.log("\n" + "=".repeat(80));
console.log("Step 2: 拉 Render state");
console.log("=".repeat(80));
const res = await fetch(`${RENDER_URL}/api/state`);
const data = await res.json();
const maogai = data.courses.find(c => c.name === "毛概");
if (!maogai) { console.error('Render 上找不到"毛概"课程'); process.exit(1); }
console.log(`Render 毛概: ${maogai.questions.length} 题`);

console.log("\n" + "=".repeat(80));
console.log("Step 3: 对比 stem");
console.log("=".repeat(80));
let matched = 0, renderOnly = 0, multiInSrc = 0, needFix = 0;
const fixes = [];
for (const q of maogai.questions) {
  const srcQ = stemIndex.get(q.stem);
  if (!srcQ) { renderOnly++; continue; }
  matched++;
  const remoteAnsLen = (q.answer || []).length;
  const srcAnsLen = (srcQ.answer || []).length;
  if (srcAnsLen > 1) multiInSrc++;
  if (srcAnsLen > 1 && remoteAnsLen === 1) {
    needFix++;
    fixes.push({
      questionId: q.id,
      courseName: "毛概",
      oldAnswer: [...(q.answer || [])],
      newAnswer: srcQ.answer,
      stem: q.stem.slice(0, 50),
      srcFile: srcQ.srcFile
    });
  }
}
console.log(`  Render 毛题能 stem 匹配本地: ${matched}`);
console.log(`  Render 独有（本地无）: ${renderOnly}`);
console.log(`  源是 multi: ${multiInSrc}`);
console.log(`  需要修复（Render单选+本地多选）: ${needFix}`);

if (fixes.length > 0) {
  console.log("\n修复样本（前 10）：");
  for (const f of fixes.slice(0, 10)) {
    console.log(`  [${f.courseName}] ${JSON.stringify(f.oldAnswer)} → ${JSON.stringify(f.newAnswer)} | ${f.stem}...`);
  }
  const perSrc = {};
  for (const f of fixes) perSrc[f.srcFile] = (perSrc[f.srcFile] || 0) + 1;
  console.log("\n按源文件统计：");
  for (const [f, n] of Object.entries(perSrc).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${f.padEnd(20)}: ${n} 道`);
  }
}
