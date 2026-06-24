/**
 * 批量导入 txt 题库文件到单个课程
 *
 * 用法：
 *   node backend/src/scripts/import-to-single-course.js "课程名" "题库目录"
 */

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const API_URL = process.env.API_URL || "http://127.0.0.1:8787";

function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_URL);
    const client = url.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = client.request(url, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) }
    }, (res) => {
      let chunks = "";
      res.on("data", (chunk) => chunks += chunk);
      res.on("end", () => { try { resolve(JSON.parse(chunks)); } catch { resolve({ error: chunks }); } });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function parseTxtFile(content, fileName) {
  const questions = [];
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);
  for (const block of blocks) {
    try {
      const q = parseQuestionBlock(block);
      if (q) questions.push(q);
    } catch (e) {
      // 静默跳过解析失败的题目
    }
  }
  return questions;
}

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
  const options = optionLines.map((text, i) => ({ key: String.fromCharCode(65 + i), text: text.trim() }));

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
    else { const m = options.find(opt => opt.text.trim() === answerNorm); if (m) answer = [m.key]; }
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
        if (matched) { answer.push(matched.key); continue; }
        const fuzzy = options.find(opt => opt.text.trim().toLowerCase().includes(ansText) || ansText.includes(opt.text.trim().toLowerCase()));
        if (fuzzy) answer.push(fuzzy.key);
      }
    }
    if (!answer.length) {
      const letterMatch = answerText.match(/[A-Z]/i);
      if (letterMatch) answer = [letterMatch[0].toUpperCase()];
      else throw new Error(`答案无法匹配: "${answerText}"`);
    }
  }

  return { type, stem: stemBody, options, answer, explanation: "" };
}

async function main() {
  const courseName = process.argv[2] || "习思想";
  const dirPath = process.argv[3] || "D:\\桌面\\习思想\\习思题库";

  let files;
  try {
    files = (await fs.readdir(dirPath)).filter(f => f.endsWith(".txt")).sort();
  } catch (e) {
    console.error(`❌ 无法读取目录: ${e.message}`);
    process.exit(1);
  }

  console.log(`📚 找到 ${files.length} 个题库文件，目标课程：${courseName}\n`);

  // 收集所有题目
  const allQuestions = [];
  for (const file of files) {
    const content = await fs.readFile(path.join(dirPath, file), "utf-8");
    const questions = parseTxtFile(content, file);
    console.log(`  📄 ${file}: ${questions.length} 道题目`);
    allQuestions.push(...questions);
  }

  console.log(`\n📊 共 ${allQuestions.length} 道题目，开始导入...\n`);

  // 创建课程
  const courseResult = await post("/api/courses", { name: courseName });
  if (courseResult.error) {
    console.error(`❌ 创建课程失败: ${courseResult.error}`);
    process.exit(1);
  }
  console.log(`✅ 课程「${courseName}」已创建\n`);

  // 分批导入（每批 100 道，避免请求过大）
  const BATCH_SIZE = 100;
  let totalImported = 0;
  let totalFailed = 0;

  for (let i = 0; i < allQuestions.length; i += BATCH_SIZE) {
    const batch = allQuestions.slice(i, i + BATCH_SIZE);
    const result = await post("/api/questions", { questions: batch });

    if (result.error) {
      console.error(`  ❌ 批次 ${Math.floor(i / BATCH_SIZE) + 1} 失败: ${result.error}`);
      continue;
    }

    const imported = result.importResult?.accepted?.length || 0;
    const failed = result.importResult?.rejected?.length || 0;
    totalImported += imported;
    totalFailed += failed;
    console.log(`  ✅ 批次 ${Math.floor(i / BATCH_SIZE) + 1}: 导入 ${imported} 道，跳过 ${failed} 道`);
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`🎉 导入完成！课程「${courseName}」共 ${totalImported} 道题目`);
  if (totalFailed > 0) console.log(`   （${totalFailed} 道因重复或格式问题跳过）`);
}

main().catch(console.error);
