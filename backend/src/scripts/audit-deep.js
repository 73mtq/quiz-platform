/**
 * 深度审计：检查 DB 里多选题的 answer 字段是否正确
 * 1. 对每个课程，对比 stem 找 DB 多余的题和源文件有但 DB 没有的题
 * 2. 重点：DB 里"多选题"的 answer 数组长度分布
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\习思想\\习思题库";
const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];

const norm = s => s.replace(/\.txt$/, "");

function parseTxtFile(content) {
  const questions = [];
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
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
    if (!stemBody) continue;

    const typeStr = typeStart !== -1 ? lines[typeStart].replace(/^类型[:：]/, "").trim().toLowerCase() : "single";
    const answerEnd = typeStart !== -1 ? typeStart : lines.length;
    const answerText = lines.slice(answerStart + 1, answerEnd).join(" ").trim();
    const isJudgement = typeStr.includes("judgement") || typeStr.includes("judge");

    const idMatch = stemLine.match(/^题目\s+\d+\s*\(ID:\s*(\d+)\):/);
    const id = idMatch ? idMatch[1] : null;

    questions.push({ id, type: typeStr, isJudgement, stem: stemBody, answerText });
  }
  return questions;
}

// 读 DB
const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);
const dbCourses = {};
for (const c of db.courses) dbCourses[c.name] = c.questions;

console.log("=".repeat(80));
console.log("1. DB 各课程的 answer 长度分布（关键！多选题 = length > 1）");
console.log("=".repeat(80));
for (const cname of Object.keys(dbCourses).sort()) {
  const qs = dbCourses[cname];
  const dist = {};
  let typeDist = { choice: 0, "fill-blank": 0 };
  for (const q of qs) {
    const len = (q.answer || []).length;
    dist[len] = (dist[len] || 0) + 1;
    typeDist[q.type] = (typeDist[q.type] || 0) + 1;
  }
  const distStr = Object.keys(dist).sort((a, b) => +a - +b).map(k => `L${k}:${dist[k]}`).join(" ");
  console.log(`  ${cname.padEnd(12)}  total=${qs.length.toString().padStart(4)}  ${distStr}  type=${JSON.stringify(typeDist)}`);
}

console.log("\n" + "=".repeat(80));
console.log("2. 源文件 ID 跟 DB 题匹配情况");
console.log("=".repeat(80));
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const cname = norm(fname);
  const srcQs = parseTxtFile(fs.readFileSync(fp, "utf8"));
  const dbQs = dbCourses[cname] || [];
  const dbStems = new Set(dbQs.map(q => q.stem));
  const dbStemsById = new Map();
  for (const q of dbQs) {
    if (q.id) {
      const m = String(q.id).match(/\d+/);
      if (m) dbStemsById.set(m[0], q);
    }
  }
  // ID 匹配
  const srcIds = new Set(srcQs.filter(q => q.id).map(q => q.id));
  let idMatched = 0, idMissing = 0;
  const missingById = [];
  for (const sq of srcQs) {
    if (!sq.id) continue;
    if (dbStemsById.has(sq.id)) idMatched++;
    else { idMissing++; if (missingById.length < 3) missingById.push(sq); }
  }
  // stem 匹配（ID 失败时备用）
  let stemMissing = 0;
  const missingByStem = [];
  for (const sq of srcQs) {
    if (!dbStems.has(sq.stem)) {
      stemMissing++;
      if (missingByStem.length < 3) missingByStem.push(sq);
    }
  }
  // DB 里不在源文件的（多出来的）
  const srcStemSet = new Set(srcQs.map(q => q.stem));
  const extraInDb = dbQs.filter(q => !srcStemSet.has(q.stem));
  const extraType = { choice: 0, "fill-blank": 0 };
  for (const q of extraInDb) extraType[q.type] = (extraType[q.type] || 0) + 1;
  const extraAnswerLen = {};
  for (const q of extraInDb) {
    const l = (q.answer || []).length;
    extraAnswerLen[l] = (extraAnswerLen[l] || 0) + 1;
  }

  console.log(`\n  📄 ${fname}  →  课程 "${cname}"`);
  console.log(`     源=${srcQs.length}  DB=${dbQs.length}  ID匹配=${idMatched}  ID缺失=${idMissing}  stem缺失=${stemMissing}  DB多余=${extraInDb.length}`);
  if (extraInDb.length > 0) {
    console.log(`     DB多余题类型: ${JSON.stringify(extraType)}, answer长度: ${JSON.stringify(extraAnswerLen)}`);
  }
  if (stemMissing > 0 && stemMissing < 20) {
    for (const m of missingByStem) {
      const isMulti = m.isJudgement ? "判断" : (m.type.includes("multiple") ? "多选" : "单选");
      console.log(`     ❌ 缺(ID=${m.id}, ${isMulti}): ${m.stem.slice(0, 60)}...`);
    }
  } else if (stemMissing >= 20) {
    console.log(`     ❌ 缺 stem ${stemMissing} 道（仅展示前 3）`);
    for (const m of missingByStem.slice(0, 3)) {
      const isMulti = m.isJudgement ? "判断" : (m.type.includes("multiple") ? "多选" : "单选");
      console.log(`        - (ID=${m.id}, ${isMulti}): ${m.stem.slice(0, 60)}...`);
    }
  }
}
