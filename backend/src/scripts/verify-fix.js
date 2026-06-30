/**
 * 端到端验证：把修复后的 import-txt-files.js 解析逻辑用 audit-mismatch 风格跑一遍
 * 看修复后还能不能解析出所有多选题
 */
import fs from "node:fs";
import path from "node:path";

const SOURCE_DIR = "D:\\桌面\\习思想\\习思题库";
const FILES = ["导论.txt","第八章.txt","第二章.txt","第六章.txt","第七章.txt","第三章.txt","第四章.txt","第五章.txt","第一章.txt","九.txt","十.txt","十二.txt","十六.txt","十三.txt","十四.txt","十五.txt","十一.txt"];

// 复制修复后的 parseQuestionBlock（保持完全一致）
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
      // 修复后：用字符级匹配，不依赖分隔符
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
      else throw new Error(`答案无法匹配: "${answerText.slice(0, 40)}..."`);
    }
  }
  return { type, stem: stemBody, options, answer };
}

const norm = s => s.replace(/\.txt$/, "");

console.log("=".repeat(80));
console.log("修复后解析结果");
console.log("=".repeat(80));
let totalQ = 0, totalMulti = 0, totalErrors = 0;
const errSamples = [];
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const content = fs.readFileSync(fp, "utf8");
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  let parsed = 0, multi = 0, single = 0, errs = 0;
  for (const block of blocks) {
    try {
      const q = parseQuestionBlock(block);
      if (q) { parsed++; totalQ++; if (q.answer.length > 1) { multi++; totalMulti++; } else single++; }
    } catch (e) {
      errs++; totalErrors++;
      if (errSamples.length < 5) errSamples.push({ file: fname, err: e.message });
    }
  }
  console.log(`  ${fname.padEnd(12)}  blocks=${blocks.length}  parsed=${parsed}  single=${single}  multi=${multi}  errs=${errs}`);
}
console.log("=".repeat(80));
console.log(`合计：${totalQ} 道题，${totalMulti} 道多选题，${totalErrors} 个解析错误`);
if (errSamples.length) for (const s of errSamples) console.log(`  错误: ${s.file} → ${s.err}`);

// 重点：抽样验证之前出 bug 的"短答案"格式多选题
console.log("\n" + "=".repeat(80));
console.log("抽样验证：之前出 bug 的短答案多选题（答案字段为 ABC/AB/BCD 等）");
console.log("=".repeat(80));
let bugCount = 0, bugOK = 0;
for (const fname of FILES) {
  const fp = path.join(SOURCE_DIR, fname);
  if (!fs.existsSync(fp)) continue;
  const blocks = fs.readFileSync(fp, "utf8").split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim());
    const typeStart = lines.findIndex(l => /^类型[:：]\s*multiple/i.test(l));
    if (typeStart === -1) continue;
    const answerStart = lines.findIndex(l => /^答案[:：]$/i.test(l));
    const answerText = lines.slice(answerStart + 1, typeStart).join(" ").trim();
    if (!/^[A-Z]+$/i.test(answerText)) continue;  // 只看短答案格式
    try {
      const q = parseQuestionBlock(block);
      if (q && q.answer.length > 1) bugOK++;
      else { bugCount++; if (bugCount < 5) console.log(`  ❌ ${fname} 答案="${answerText}" 解析为 L${q ? q.answer.length : '?'}`); }
    } catch (e) {
      bugCount++;
    }
  }
}
console.log(`\n短答案多选题: 修复后正确=${bugOK}  仍错=${bugCount}`);
