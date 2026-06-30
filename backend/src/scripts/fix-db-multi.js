/**
 * 修复 DB 里的"短答案多选题被错识别"问题（v2：每门课用对应源文件局部索引）
 *
 * 用法：
 *   node backend/src/scripts/fix-db-multi.js --dry-run
 *   node backend/src/scripts/fix-db-multi.js
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\习思想\\习思题库";
const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const BACKUP_DIR = "D:\\claude_code\\auto_test\\quiz-platform\\data\\backups";
const FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];

const norm = s => s.replace(/\.txt$/, "");
const DRY_RUN = process.argv.includes("--dry-run");

function parseQuestionBlock(block) {
  const lines = block.split("\n").map(l => l.trim());
  const stemStart = lines.findIndex(l => /^题目\s+\d+/.test(l));
  const optionsStart = lines.findIndex(l => /^选项[:：]$/i.test(l));
  const answerStart = lines.findIndex(l => /^答案[:：]$/i.test(l));
  const typeStart = lines.findIndex(l => /^类型[:：]/i.test(l));
  if (stemStart === -1 || optionsStart === -1 || answerStart === -1) return null;

  const stemLine = lines[stemStart];
  const colonIdx = stemLine.indexOf("):");
  const stemFromHeader = colonIdx !== -1 ? stemLine.slice(colonIdx + 2).trim() : "";
  const stemBody = stemFromHeader || lines.slice(stemStart + 1, optionsStart).join(" ").trim();
  if (!stemBody) return null;

  const optionLines = lines.slice(optionsStart + 1, answerStart).filter(l => l);
  if (!optionLines.length) return null;

  const options = optionLines.map((text, i) => ({
    key: String.fromCharCode(65 + i),
    text: text.trim()
  }));

  const answerEnd = typeStart !== -1 ? typeStart : lines.length;
  const answerText = lines.slice(answerStart + 1, answerEnd).join(" ").trim();
  if (!answerText) return null;

  const typeStr = typeStart !== -1 ? lines[typeStart].replace(/^类型[:：]/, "").trim().toLowerCase() : "single";
  const isJudgement = typeStr.includes("judgement") || typeStr.includes("judge");
  let type = "choice";
  let answer = [];

  if (isJudgement) {
    const answerNorm = answerText.trim();
    if (answerNorm === "正确") answer = ["对"];
    else if (answerNorm === "错误") answer = ["错"];
    else {
      const matched = options.find(opt => opt.text.trim() === answerNorm);
      if (matched) answer = [matched.key];
    }
    if (options.length === 2) {
      options[0] = { key: "对", text: options[0].text };
      options[1] = { key: "错", text: options[1].text };
    }
  } else {
    const isLetterAnswer = /^[A-Z\s；;、###]+$/i.test(answerText);
    if (isLetterAnswer) {
      answer = (answerText.match(/[A-Z]/gi) || []).map(s => s.toUpperCase());
    } else {
      const answerTexts = answerText.split(/[；;、###]/).map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const ansText of answerTexts) {
        const matched = options.find(opt => opt.text.trim().toLowerCase() === ansText);
        if (matched) answer.push(matched.key);
        else {
          const fuzzy = options.find(opt =>
            opt.text.trim().toLowerCase().includes(ansText) ||
            ansText.includes(opt.text.trim().toLowerCase())
          );
          if (fuzzy) answer.push(fuzzy.key);
        }
      }
    }
    if (!answer.length) {
      const letterMatch = answerText.match(/[A-Z]/i);
      if (letterMatch) answer = [letterMatch[0].toUpperCase()];
    }
  }
  return { type, stem: stemBody, options, answer, srcType: typeStr, isMulti: typeStr.includes("multiple") };
}

// Step 1: 每个源文件单独建 stem → parsedQuestion[] 索引
console.log("=".repeat(80));
console.log("Step 1: 每个源文件单独建 stem 索引（避免跨文件撞库）");
console.log("=".repeat(80));

const fileStemIndex = new Map();
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const idx = new Map();
  const blocks = fs.readFileSync(fp, "utf8").split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    try {
      const q = parseQuestionBlock(block);
      if (q) {
        if (!idx.has(q.stem)) idx.set(q.stem, []);
        idx.get(q.stem).push(q);
      }
    } catch (e) { /* ignore */ }
  }
  fileStemIndex.set(fname, idx);
}
let totalDupStems = 0;
for (const [fname, idx] of fileStemIndex) {
  let dup = 0;
  for (const [, arr] of idx) if (arr.length > 1) dup++;
  if (dup > 0) {
    console.log(`  ⚠️ ${fname}: ${dup} 个 stem 在本文件内重复`);
    totalDupStems += dup;
  }
}
console.log(`源文件内 stem 撞库总数：${totalDupStems}`);

// Step 2: 读 DB
console.log("\n" + "=".repeat(80));
console.log("Step 2: 扫描 DB，找需要修复的题");
console.log("=".repeat(80));

const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);

const fixes = [];
const skipped = [];

for (const course of db.courses) {
  const srcFile = FILES.find(f => norm(f) === course.name);
  if (!srcFile || !fileStemIndex.has(srcFile)) continue;
  const idx = fileStemIndex.get(srcFile);
  for (let i = 0; i < course.questions.length; i++) {
    const q = course.questions[i];
    const dbAnswerLen = (q.answer || []).length;
    if (dbAnswerLen > 1) continue;

    const srcList = idx.get(q.stem);
    if (!srcList || srcList.length === 0) continue;
    if (srcList.length > 1) {
      skipped.push({ course: course.name, stem: q.stem.slice(0, 50), reason: `源 ${srcFile} 内 stem 重复 ${srcList.length} 次` });
      continue;
    }
    const srcQ = srcList[0];
    // 关键：只修源文件里标 multiple 的题。源标 single 的即使 answer.length > 1
    // 也很可能是 parser bug（中文答案含"、"被错误 split），不能信任。
    if (!srcQ.isMulti) continue;
    if (srcQ.answer.length <= 1) continue;

    const dbSet = new Set((q.answer || []).map(s => String(s).toUpperCase()));
    const srcSet = new Set(srcQ.answer.map(s => String(s).toUpperCase()));
    let allIn = true;
    for (const x of dbSet) if (!srcSet.has(x)) { allIn = false; break; }
    if (!allIn) {
      skipped.push({ course: course.name, stem: q.stem.slice(0, 50), reason: `DB.answer=${JSON.stringify(q.answer)} 不在 src.answer=${JSON.stringify(srcQ.answer)} 集合内` });
      continue;
    }

    fixes.push({
      courseName: course.name,
      questionIndex: i,
      oldAnswer: [...(q.answer || [])],
      newAnswer: srcQ.answer,
      stem: q.stem.slice(0, 50),
      srcFile
    });
  }
}

console.log(`找到 ${fixes.length} 道题需要修复 answer 字段`);
console.log(`跳过 ${skipped.length} 道（撞库或无法匹配）`);

if (fixes.length > 0) {
  console.log("\n前 10 个修复样本：");
  for (const f of fixes.slice(0, 10)) {
    console.log(`  [${f.courseName}] ${JSON.stringify(f.oldAnswer)} → ${JSON.stringify(f.newAnswer)} | ${f.stem}...`);
  }
}

if (skipped.length > 0) {
  console.log("\n跳过的题：");
  for (const s of skipped) {
    console.log(`  [${s.course}] ${s.reason} | ${s.stem}...`);
  }
}

const perCourse = {};
for (const f of fixes) perCourse[f.courseName] = (perCourse[f.courseName] || 0) + 1;
console.log("\n按课程统计：");
for (const [c, n] of Object.entries(perCourse).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(10)}: ${n} 道`);
}

if (DRY_RUN) {
  console.log("\n" + "=".repeat(80));
  console.log("DRY RUN：没有改任何东西。要实际修复请去掉 --dry-run 参数");
  console.log("=".repeat(80));
  process.exit(0);
}

// Step 3: 备份
console.log("\n" + "=".repeat(80));
console.log("Step 3: 备份 DB 到 data/backups/");
console.log("=".repeat(80));
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(BACKUP_DIR, `quiz-data.${ts}.json`);
fs.copyFileSync(DB_PATH, backupPath);
console.log(`备份到：${backupPath}`);

// Step 4: 应用修复
console.log("\n" + "=".repeat(80));
console.log("Step 4: 应用修复");
console.log("=".repeat(80));

let applied = 0;
for (const f of fixes) {
  const course = db.courses.find(c => c.name === f.courseName);
  if (!course) continue;
  const q = course.questions[f.questionIndex];
  if (!q) continue;
  q.answer = f.newAnswer;
  applied++;
}
console.log(`已更新 ${applied} 道题的 answer 字段`);

// Step 5: 写回
const newContent = JSON.stringify(db, null, 2) + "\n";
fs.writeFileSync(DB_PATH, newContent, "utf8");
console.log(`已写回 ${DB_PATH}`);
console.log(`新文件大小：${fs.statSync(DB_PATH).size} bytes`);

console.log("\n" + "=".repeat(80));
console.log("修复完成！建议：");
console.log("  1. 跑 audit-mismatch.js 确认 0 错识别");
console.log("  2. 重启 quiz-platform 服务（如果有运行）让内存状态重新加载");
console.log("  3. 在浏览器里抽查几道修复过的多选题确认显示正确");
console.log("=".repeat(80));
