import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";

const API_URL = process.env.API_URL;
if (!API_URL) {
  console.error("请设置 API_URL 环境变量，例如：API_URL=https://your-app.onrender.com");
  process.exit(1);
}

const COURSE_NAME = process.argv[2] || "毛概";
const DIR = process.argv[3];

if (!DIR) {
  console.error("用法：API_URL=... node import-md-files.js <课程名> <目录路径>");
  process.exit(1);
}

function parseMdQuestions(text) {
  const questions = [];
  const lines = text.split("\n");

  let currentSectionType = "single"; // 根据章节标题推断题型
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // 检测章节标题以推断题型：## 一、单选题 / ## 二、多选题 / ## 三、判断题
    const sectionMatch = line.match(/^#+\s*[一二三四五六七八九十]+[.、]\s*(单选题|多选题|判断题)/);
    if (sectionMatch) {
      const t = sectionMatch[1];
      currentSectionType = t === "单选题" ? "single" : t === "多选题" ? "multi" : "judgement";
      i++;
      continue;
    }

    // 检测题干 —— 支持三种格式
    let stem = null;
    let explicitType = null; // 题干中显式标注的类型

    // 格式A: **N. [类型] 题目** ✅/❌
    const mA = line.match(/^\*\*\d+\.\s*\[(单选题|多选题|判断题)\]\s*(.+?)\*\*\s*[✅❌]?$/);
    if (mA) {
      stem = mA[2].trim();
      explicitType = mA[1] === "单选题" ? "single" : mA[1] === "多选题" ? "multi" : "judgement";
    }

    // 格式B: **N.** 题目
    if (!stem) {
      const mB = line.match(/^\*\*\d+\.\*\*\s*(.+)$/);
      if (mB) stem = mB[1].trim();
    }

    // 格式C: ### N. [✓] 题目  或  ### N. [✗] 题目
    if (!stem) {
      const mC = line.match(/^#{2,3}\s*\d+\.\s*\[[✓✗]\]\s*(.+)$/);
      if (mC) stem = mC[1].trim();
    }

    if (!stem) { i++; continue; }

    // 收集选项和答案
    const options = [];
    let answerRaw = "";
    let explanation = "";
    i++;

    while (i < lines.length) {
      const l = lines[i].trim();

      // 遇到分隔线或下一个题干则结束
      if (l === "---" || l.match(/^\*\*\d+\.\s*(\[|.*\*\*)/) || l.match(/^#{2,3}\s*\d+\./) || l.match(/^#+\s*[一二三四五六七八九十]+[.、]/)) {
        break;
      }

      // 选项：- A. 文本
      const optMatch = l.match(/^- ([A-Z])\.\s*(.+)$/);
      if (optMatch) {
        options.push({ key: optMatch[1], text: optMatch[2].trim() });
        i++;
        continue;
      }

      // 格式A答案: > **正确答案: X** 或 > 正确答案: X
      const ansA = l.match(/^>\s*\*?\*?正确答案[：:]\s*(.+?)\*?\*?\s*$/);
      if (ansA) { answerRaw = ansA[1].trim(); i++; continue; }

      // 格式B答案: > **答案：X** 或 > 答案：X
      const ansB = l.match(/^>\s*\*?\*?答案[：:]\s*(.+?)\*?\*?\s*$/);
      if (ansB) { answerRaw = ansB[1].trim(); i++; continue; }

      // 格式C答案: **正确答案:** X （行内）
      const ansC = l.match(/\*?\*?正确答案[：:]\*?\*?\s*([A-Z对错]+)/);
      if (ansC) { answerRaw = ansC[1].trim(); i++; continue; }

      // 解析
      const explMatch = l.match(/(?:>|^)\s*答案解析[：:]\s*(.+)$/);
      if (explMatch) { explanation = explMatch[1].trim(); i++; continue; }

      // 我的答案行（格式C，跳过）
      if (l.match(/\*?\*?我的答案[：:]/)) { i++; continue; }

      i++;
    }

    if (!options.length || !answerRaw) continue;

    // 确定题型
    const type = explicitType || currentSectionType;

    // 解析答案
    let answer;
    if (type === "judgement") {
      const normalized = answerRaw.replace(/[Aa]$/, "对").replace(/[Bb]$/, "错");
      answer = [normalized === "对" || normalized === "正确" ? "对" : "错"];
      // 标准化选项
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

async function request(pathStr, body) {
  const url = new URL(pathStr, API_URL);
  const payload = JSON.stringify(body);
  const client = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        } else {
          resolve(JSON.parse(data));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".md")).sort();
  console.log(`找到 ${files.length} 个 Markdown 文件`);

  let totalParsed = 0;
  let totalAccepted = 0;
  let totalRejected = 0;

  for (const file of files) {
    const filePath = path.join(DIR, file);
    const text = fs.readFileSync(filePath, "utf-8");
    const questions = parseMdQuestions(text);
    totalParsed += questions.length;
    console.log(`  ${file} → ${questions.length} 道题`);

    if (!questions.length) continue;

    // 分批导入（每批 100 题）
    const batchSize = 100;
    for (let i = 0; i < questions.length; i += batchSize) {
      const batch = questions.slice(i, i + batchSize);
      try {
        const result = await request("/api/questions", { questions: batch });
        const accepted = result.importResult?.accepted?.length || 0;
        const rejected = result.importResult?.rejected?.length || 0;
        totalAccepted += accepted;
        totalRejected += rejected;
        if (rejected > 0) {
          console.log(`    批次 ${Math.floor(i / batchSize) + 1}: ${accepted} 成功, ${rejected} 跳过`);
        }
      } catch (err) {
        console.error(`    批次 ${Math.floor(i / batchSize) + 1} 失败: ${err.message}`);
      }
    }
  }

  console.log(`\n导入完成！`);
  console.log(`  解析: ${totalParsed} 道`);
  console.log(`  成功: ${totalAccepted} 道`);
  console.log(`  跳过: ${totalRejected} 道（重复等）`);
}

main().catch((err) => {
  console.error("导入失败:", err.message);
  process.exit(1);
});
