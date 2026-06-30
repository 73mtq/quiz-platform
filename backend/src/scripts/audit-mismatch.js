/**
 * 终极审计：找出"源文件多选题被 DB 当作单选题"的具体题目
 * 1. 用 stem 匹配源文件每道题
 * 2. 对每道匹配上的题，对比源类型 vs DB answer 长度
 * 3. 列出所有"应该多选但 DB 是单选"的题
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\习思想\\习思题库";
const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];

const norm = s => s.replace(/\.txt$/, "");

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
    if (!stemBody) continue;

    const typeStr = typeStart !== -1 ? lines[typeStart].replace(/^类型[:：]/, "").trim().toLowerCase() : "single";
    const answerEnd = typeStart !== -1 ? typeStart : lines.length;
    const answerText = lines.slice(answerStart + 1, answerEnd).join(" ").trim();
    const idMatch = stemLine.match(/^题目\s+\d+\s*\(ID:\s*(\d+)\):/);

    out.push({
      id: idMatch ? idMatch[1] : null,
      srcType: typeStr,
      isMulti: typeStr.includes("multiple"),
      stem: stemBody,
      rawAnswer: answerText
    });
  }
  return out;
}

const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);
const dbCourses = {};
for (const c of db.courses) dbCourses[c.name] = c.questions;

console.log("=".repeat(80));
console.log("【重点】源文件多选题被 DB 错认为单选/缺题清单");
console.log("=".repeat(80));

let totalMismatch = 0;
let totalMissing = 0;
let totalMatched = 0;
const allMismatches = [];

for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const cname = norm(fname);
  const srcQs = parseTxtFile(fs.readFileSync(fp, "utf8"));
  const dbQs = dbCourses[cname] || [];
  const dbByStem = new Map();
  for (const q of dbQs) dbByStem.set(q.stem, q);

  let fileMismatch = 0, fileMissing = 0, fileMatch = 0;
  const fileIssues = [];
  for (const sq of srcQs) {
    if (sq.isMulti) {
      // 只关注多选题
      const dbQ = dbByStem.get(sq.stem);
      if (!dbQ) {
        fileMissing++;
        fileIssues.push({ kind: "缺失", id: sq.id, srcType: sq.srcType, dbAnswerLen: null, stem: sq.stem.slice(0, 50), answer: sq.rawAnswer.slice(0, 60) });
      } else if ((dbQ.answer || []).length < 2) {
        fileMismatch++;
        fileIssues.push({ kind: "错识别", id: sq.id, srcType: sq.srcType, dbAnswerLen: dbQ.answer.length, dbAnswer: dbQ.answer, stem: sq.stem.slice(0, 50), answer: sq.rawAnswer.slice(0, 60) });
      } else {
        fileMatch++;
      }
    }
  }
  if (fileMismatch > 0 || fileMissing > 0) {
    console.log(`\n📄 ${fname} (课程"${cname}"): 源多选=${srcQs.filter(q=>q.isMulti).length}  匹配OK=${fileMatch}  错识别=${fileMismatch}  缺失=${fileMissing}`);
    for (const it of fileIssues) {
      const tag = it.kind === "缺失" ? "❌缺失" : "⚠️错识别";
      console.log(`   ${tag} [ID=${it.id}] DB.answer长度=${it.dbAnswerLen} | 源答案: ${it.answer} | 题干: ${it.stem}...`);
    }
  } else if (srcQs.filter(q => q.isMulti).length > 0) {
    console.log(`\n📄 ${fname} (课程"${cname}"): 源多选=${srcQs.filter(q=>q.isMulti).length}  ✓ 全部识别正确`);
  }
  totalMismatch += fileMismatch;
  totalMissing += fileMissing;
  totalMatched += fileMatch;
}

console.log("\n" + "=".repeat(80));
console.log("【总览】");
console.log("=".repeat(80));
console.log(`✓ 正确识别的多选题：${totalMatched}`);
console.log(`⚠️ 被错认为单选/填空的多选题：${totalMismatch}`);
console.log(`❌ 根本没导入的多选题：${totalMissing}`);

// 第四章的"来路不明"题
console.log("\n" + "=".repeat(80));
console.log("【第四章.txt 异常分析】源文件 143 题，DB 549 题");
console.log("=".repeat(80));
const d4 = dbCourses["第四章"] || [];
const daolunSrc = parseTxtFile(fs.readFileSync(path.join(SOURCE_DIR, "导论.txt"), "utf8"));
const daolunStems = new Set(daolunSrc.map(q => q.stem));

let otherFileQuestions = 0;
const d4Samples = [];
for (const q of d4) {
  if (!daolunStems.has(q.stem)) {
    otherFileQuestions++;
    if (d4Samples.length < 5) d4Samples.push(q);
  }
}
console.log(`第四章 DB 里 549 道题中：${otherFileQuestions} 道 stem 不在导论源文件（但可能在别的源文件）`);

// 看 第四章 DB 里到底是什么题
const d4StemHashes = new Set();
for (const q of d4) d4StemHashes.add(q.stem.slice(0, 30));

// 查所有其他源文件
const allSrcStems = new Map();
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const sqs = parseTxtFile(fs.readFileSync(fp, "utf8"));
  for (const q of sqs) {
    const k = q.stem.slice(0, 30);
    if (!allSrcStems.has(k)) allSrcStems.set(k, fname);
  }
}
let inSrc = 0, notInSrc = 0;
const notInSrcSamples = [];
for (const q of d4) {
  if (allSrcStems.has(q.stem.slice(0, 30))) inSrc++;
  else { notInSrc++; if (notInSrcSamples.length < 5) notInSrcSamples.push(q); }
}
console.log(`第四章 DB 题能在某个源文件找到：${inSrc}`);
console.log(`第四章 DB 题**完全找不到**源（可能是历史遗留/手动添加）：${notInSrc}`);
if (notInSrcSamples.length) {
  console.log(`找不到源的题样例：`);
  for (const q of notInSrcSamples) {
    console.log(`   - L${(q.answer||[]).length} ${q.stem.slice(0, 60)}...`);
  }
}
