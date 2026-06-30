/**
 * 批量导入 txt 题库文件
 *
 * 用法：
 *   node backend/src/scripts/import-txt-files.js "D:\桌面\习思想\习思题库"
 *
 * 可选环境变量：
 *   API_URL  后端地址（默认 http://127.0.0.1:8787）
 */

import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";

const API_URL = process.env.API_URL || "http://127.0.0.1:8787";

/** 发送 POST 请求 */
function post(endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, API_URL);
    const data = JSON.stringify(body);
    const req = http.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data)
      }
    }, (res) => {
      let chunks = "";
      res.on("data", (chunk) => chunks += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(chunks));
        } catch {
          resolve({ error: chunks });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** 解析单个 txt 文件中的题目 */
function parseTxtFile(content, fileName) {
  const questions = [];
  // 按分隔线分割题目块
  const blocks = content.split(/^-{10,}$/m).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    try {
      const question = parseQuestionBlock(block);
      if (question) questions.push(question);
    } catch (e) {
      console.warn(`  ⚠️ 解析失败 [${fileName}]: ${e.message}`);
    }
  }

  return questions;
}

/** 解析单个题目块 */
function parseQuestionBlock(block) {
  const lines = block.split("\n").map(l => l.trim());

  // 提取题干（从 "题目 N (ID: xxx):" 之后到 "选项:" 之前）
  const stemStart = lines.findIndex(l => /^题目\s+\d+/.test(l));
  const optionsStart = lines.findIndex(l => /^选项[:：]$/i.test(l));
  const answerStart = lines.findIndex(l => /^答案[:：]$/i.test(l));
  const typeStart = lines.findIndex(l => /^类型[:：]/i.test(l));

  if (stemStart === -1 || optionsStart === -1 || answerStart === -1) {
    return null;
  }

  // 题干：从题目行的冒号之后，到选项行之前
  const stemLine = lines[stemStart];
  const colonIdx = stemLine.indexOf("):");
  const stemFromHeader = colonIdx !== -1 ? stemLine.slice(colonIdx + 2).trim() : "";
  const stemBody = stemFromHeader || lines.slice(stemStart + 1, optionsStart).join(" ").trim();

  if (!stemBody) return null;

  // 选项：从 "选项:" 之后到 "答案:" 之前
  const optionLines = lines.slice(optionsStart + 1, answerStart).filter(l => l);
  if (!optionLines.length) return null;

  // 给选项分配 A/B/C/D 键
  const options = optionLines.map((text, i) => ({
    key: String.fromCharCode(65 + i), // A, B, C, D...
    text: text.trim()
  }));

  // 答案：从 "答案:" 之后到 "类型:" 或下一个标记之前
  const answerEnd = typeStart !== -1 ? typeStart : lines.length;
  const answerText = lines.slice(answerStart + 1, answerEnd).join(" ").trim();

  if (!answerText) return null;

  // 检测题型
  const typeStr = typeStart !== -1 ? lines[typeStart].replace(/^类型[:：]/, "").trim().toLowerCase() : "single";
  const isJudgement = typeStr.includes("judgement") || typeStr.includes("judge");
  let type = "choice";
  let answer = [];

  // 判断题处理：选项是"对/错"，答案是"正确/错误"
  if (isJudgement) {
    const answerNorm = answerText.trim();
    if (answerNorm === "正确") {
      answer = ["对"];
    } else if (answerNorm === "错误") {
      answer = ["错"];
    } else {
      const matched = options.find(opt => opt.text.trim() === answerNorm);
      if (matched) answer = [matched.key];
    }
    // 判断题选项标准化为"对/错"
    if (options.length === 2) {
      options[0] = { key: "对", text: options[0].text };
      options[1] = { key: "错", text: options[1].text };
    }
  } else {
    // 选择题答案匹配
    // 允许纯字母串（"ABC"）或带分隔符的字母串（"A B"/"A、B"/"A###B"/"A;B"），
    // 旧的正则不允许无分隔符的连续字母，会让 "ABC" 走 else 分支被当作填空题
    const isLetterAnswer = /^[A-Z\s；;、###]+$/i.test(answerText);

    if (isLetterAnswer) {
      // 用字符级匹配而不是分隔符 split —— 否则 "ABC" 这种无分隔符的连续字母
      // 会被整体保留为 ["ABC"]，导致多选题被错误识别为单选
      answer = (answerText.match(/[A-Z]/gi) || []).map(s => s.toUpperCase());
    } else {
      const answerTexts = answerText.split(/[；;、###]/).map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const ansText of answerTexts) {
        const matched = options.find(opt => opt.text.trim().toLowerCase() === ansText);
        if (matched) {
          answer.push(matched.key);
        } else {
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
      if (letterMatch) {
        answer = [letterMatch[0].toUpperCase()];
      } else {
        throw new Error(`答案无法匹配: "${answerText}"`);
      }
    }
  }

  return {
    type,
    stem: stemBody,
    options,
    answer,
    explanation: ""
  };
}

async function main() {
  const dirPath = process.argv[2];
  if (!dirPath) {
    console.error("❌ 请指定题库目录路径");
    console.error('   node backend/src/scripts/import-txt-files.js "D:\\桌面\\习思想\\习思题库"');
    process.exit(1);
  }

  // 读取目录中的所有 txt 文件
  let files;
  try {
    files = (await fs.readdir(dirPath))
      .filter(f => f.endsWith(".txt"))
      .sort();
  } catch (e) {
    console.error(`❌ 无法读取目录: ${e.message}`);
    process.exit(1);
  }

  if (!files.length) {
    console.error("❌ 目录中没有 txt 文件");
    process.exit(1);
  }

  console.log(`📚 找到 ${files.length} 个题库文件\n`);

  let totalImported = 0;
  let totalRejected = 0;

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const content = await fs.readFile(filePath, "utf-8");
    const questions = parseTxtFile(content, file);

    if (!questions.length) {
      console.log(`📄 ${file}: 无有效题目，跳过`);
      continue;
    }

    // 用文件名（去掉 .txt）作为课程名
    const courseName = file.replace(/\.txt$/, "");

    // 先创建课程
    console.log(`\n📖 创建课程: ${courseName}`);
    const courseResult = await post("/api/courses", { name: courseName });
    if (courseResult.error) {
      console.error(`   ❌ 创建课程失败: ${courseResult.error}`);
      continue;
    }

    // 导入题目
    console.log(`   导入 ${questions.length} 道题目...`);
    const result = await post("/api/questions", { questions });

    if (result.error) {
      console.error(`   ❌ 导入失败: ${result.error}`);
      continue;
    }

    const imported = result.importResult?.accepted?.length || 0;
    const rejected = result.importResult?.rejected?.length || 0;
    console.log(`   ✅ 成功导入 ${imported} 道，${rejected} 道失败`);
    totalImported += imported;
    totalRejected += rejected;
  }

  console.log(`\n${"=".repeat(40)}`);
  console.log(`🎉 全部完成！共导入 ${totalImported} 道题目，${totalRejected} 道失败`);
}

main().catch(console.error);
