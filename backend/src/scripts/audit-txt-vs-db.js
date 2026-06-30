/**
 * 审计脚本：对比源文件 vs 数据库
 * 1. 用 import-txt-files.js 的 parseQuestionBlock 逻辑解析所有源文件
 * 2. 读取 data/quiz-data.json
 * 3. 统计每门课的差异
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\习思想\\习思题库";
const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];

// ========== 复制 import-txt-files.js 的 parseQuestionBlock ==========
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
    const isLetterAnswer = /^[A-Z](\s*[；;、]\s*[A-Z]|###\s*[A-Z])*$/i.test(answerText);
    if (isLetterAnswer) {
      answer = answerText.split(/[；;、###\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
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
      else throw new Error(`答案无法匹配: "${answerText.slice(0, 40)}..."`);
    }
  }

  return { type, stem: stemBody, options, answer };
}

// ========== 解析所有源文件 ==========
const report = { perFile: [], totalParsed: 0, totalParseErrors: 0, parseErrorSamples: [] };

for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) {
    report.perFile.push({ file: fname, error: "不存在" });
    continue;
  }
  const content = fs.readFileSync(fp, "utf8");
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  let parsed = 0;
  const errors = [];
  const parsedList = [];
  for (let i = 0; i < blocks.length; i++) {
    try {
      const q = parseQuestionBlock(blocks[i]);
      if (q) { parsed++; parsedList.push(q); }
      else errors.push({ block: i + 1, reason: "parseQuestionBlock 返回 null" });
    } catch (e) {
      errors.push({ block: i + 1, reason: e.message });
      if (report.parseErrorSamples.length < 10) {
        const headMatch = blocks[i].match(/^题目\s+\d+/m);
        report.parseErrorSamples.push({ file: fname, block: i + 1, head: headMatch ? headMatch[0] : "(无题号)", reason: e.message });
      }
    }
  }
  report.perFile.push({
    file: fname,
    blocks: blocks.length,
    parsed,
    multiAnswer: parsedList.filter(q => q.answer.length > 1).length,
    singleAnswer: parsedList.filter(q => q.answer.length === 1).length,
    errorCount: errors.length,
    errors: errors.slice(0, 3)
  });
  report.totalParsed += parsed;
  report.totalParseErrors += errors.length;
}

// ========== 读数据库 ==========
const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);

// 课程名 → 题数映射
const dbCourseMap = {};
for (const c of db.courses) {
  dbCourseMap[c.name] = c.questions.length;
}

// 课程名归一化（去掉 .txt 扩展名）
const norm = s => s.replace(/\.txt$/, "");

// ========== 对比 ==========
console.log("=".repeat(80));
console.log("源文件解析结果 vs 数据库题数");
console.log("=".repeat(80));
console.log("文件                     blocks  parsed  single  multi  err   DB题数  diff");
console.log("-".repeat(80));

for (const f of report.perFile) {
  if (f.error) { console.log(`${f.file.padEnd(24)}  错误: ${f.error}`); continue; }
  const dbCount = dbCourseMap[norm(f.file)] ?? 0;
  const diff = dbCount - f.parsed;
  const diffStr = diff === 0 ? "✓" : (diff > 0 ? `+${diff}` : `${diff}`);
  console.log(
    `${f.file.padEnd(22)}  ${String(f.blocks).padStart(6)}  ${String(f.parsed).padStart(6)}  ${String(f.singleAnswer).padStart(6)}  ${String(f.multiAnswer).padStart(5)}  ${String(f.errorCount).padStart(3)}  ${String(dbCount).padStart(6)}  ${diffStr.padStart(4)}`
  );
}

console.log("-".repeat(80));
const totalDB = Object.values(dbCourseMap).reduce((a, b) => a + b, 0);
console.log(`合计：parsed=${report.totalParsed}  解析错误=${report.totalParseErrors}  DB总题数=${totalDB}`);

if (report.parseErrorSamples.length) {
  console.log("\n" + "=".repeat(80));
  console.log("解析失败样本（前 10 个）");
  console.log("=".repeat(80));
  for (const s of report.parseErrorSamples) {
    console.log(`  [${s.file}] block#${s.block} (${s.head}) → ${s.reason}`);
  }
}

if (report.totalParseErrors > 0 || report.totalParsed !== totalDB) {
  console.log("\n" + "=".repeat(80));
  console.log("差异分析");
  console.log("=".repeat(80));
  for (const f of report.perFile) {
    if (f.error) continue;
    const dbCount = dbCourseMap[norm(f.file)] ?? 0;
    if (f.errorCount > 0) {
      console.log(`⚠️  ${f.file}: ${f.errorCount} 道题解析失败`);
      for (const e of f.errors) console.log(`     - block#${e.block}: ${e.reason}`);
    }
    if (dbCount !== f.parsed) {
      const diff = dbCount - f.parsed;
      if (diff > 0) console.log(`📉 ${f.file}: 源文件 ${f.parsed} 道，DB 多 ${diff} 道（可能含历史遗留或重复）`);
      else console.log(`📈 ${f.file}: 源文件 ${f.parsed} 道，DB 少 ${-diff} 道（导入丢失）`);
    }
  }
}
