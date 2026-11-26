import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const contentFile = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "content/national-security/course.json");
const expectedTotal = 290;
const labels = ["正确答案：", "为什么对：", "干扰项分析：", "记忆：", "依据："];

const raw = fs.readFileSync(contentFile, "utf8").replace(/^\uFEFF/, "");
const data = JSON.parse(raw);
const sourcesFile = path.join(path.dirname(contentFile), "sources.jsonl");
const allowedSourceTitles = new Set();
if (fs.existsSync(sourcesFile)) {
  for (const line of fs.readFileSync(sourcesFile, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const source = JSON.parse(line);
    if (source.title) allowedSourceTitles.add(source.title);
  }
}
const course = (data.courses || []).find((item) => item.name === "国家安全教育") || (data.courses || [])[0];
const errors = [];
const warnings = [];

if (!course) {
  console.error("没有找到国家安全教育课程。");
  process.exit(1);
}

const questions = course.questions || [];
if (questions.length !== expectedTotal) {
  errors.push(`题目数量应为 ${expectedTotal}，实际为 ${questions.length}`);
}

const ids = new Set();
const explanationSeen = new Map();

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[“”‘’"'《》〈〉（）()【】\[\]，。；：:、,.!?！？]/g, "")
    .toLowerCase();
}

function section(explanation, label, nextLabel) {
  const start = explanation.indexOf(label);
  if (start < 0) return "";
  const contentStart = start + label.length;
  const end = nextLabel ? explanation.indexOf(nextLabel, contentStart) : explanation.length;
  return explanation.slice(contentStart, end < 0 ? explanation.length : end).trim();
}

for (const [index, question] of questions.entries()) {
  const position = index + 1;
  const id = String(question.id || "");
  const tag = `第 ${position} 题（${id || "缺少 ID"}）`;
  if (!id) errors.push(`${tag}：缺少 ID`);
  if (ids.has(id)) errors.push(`${tag}：ID 重复`);
  ids.add(id);

  const options = Array.isArray(question.options) ? question.options : [];
  if (options.length !== 4) errors.push(`${tag}：选项数量为 ${options.length}，应为 4`);
  const optionTexts = new Set(options.map((option) => normalize(option.text)));
  for (const answer of question.answer || []) {
    if (!optionTexts.has(normalize(answer))) errors.push(`${tag}：答案不在选项内 -> ${answer}`);
  }

  const explanation = String(question.explanation || "").trim();
  const memoryTip = String(question.memoryTip || "").trim();
  if (!explanation) {
    errors.push(`${tag}：缺少解析`);
    continue;
  }
  if (explanation.length < 100) errors.push(`${tag}：解析过短（${explanation.length} 字）`);
  if (explanation.length > 900) warnings.push(`${tag}：解析较长（${explanation.length} 字）`);
  if (!memoryTip) errors.push(`${tag}：缺少 memoryTip`);
  if (memoryTip.length < 8 || memoryTip.length > 80) warnings.push(`${tag}：memoryTip 长度 ${memoryTip.length}`);

  const positions = labels.map((label) => explanation.indexOf(label));
  if (positions.some((value) => value < 0)) {
    errors.push(`${tag}：解析缺少五段标签之一 -> ${labels.filter((_, i) => positions[i] < 0).join("、")}`);
    continue;
  }
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] <= positions[i - 1]) errors.push(`${tag}：解析标签顺序错误`);
  }

  const correctSection = section(explanation, labels[0], labels[1]);
  const distractors = section(explanation, labels[2], labels[3]);
  const basis = section(explanation, labels[4]);
  for (const answer of question.answer || []) {
    if (!normalize(correctSection).includes(normalize(answer))) {
      errors.push(`${tag}：正确答案段没有写答案原文 -> ${answer}`);
    }
  }
  const wrongOptions = options.filter((option) => !(question.answer || []).some((answer) => normalize(answer) === normalize(option.text)));
  const matchedWrong = wrongOptions.filter((option) => normalize(distractors).includes(normalize(option.text)));
  const requiredWrong = Math.min(2, wrongOptions.length);
  if (matchedWrong.length < requiredWrong) {
    errors.push(`${tag}：干扰项分析只覆盖 ${matchedWrong.length}/${wrongOptions.length} 个错误选项`);
  }
  if (!basis) errors.push(`${tag}：缺少依据`);
  const knownBasis = [...allowedSourceTitles].some((allowed) => basis.includes(allowed) || basis.includes(allowed.replace(/^中华人民共和国/, "")));
  if (basis && !basis.includes("《") && !basis.includes("教材表述") && !knownBasis) {
    errors.push(`${tag}：依据没有写文件名或“教材表述”`);
  }
  for (const match of basis.matchAll(/《([^》]+)》/g)) {
    const title = match[1].trim();
    const shortTitle = title.replace(/^中华人民共和国/, "");
    const known = [...allowedSourceTitles].some((allowed) => allowed === title || allowed.replace(/^中华人民共和国/, "") === shortTitle);
    if (allowedSourceTitles.size && !known) {
      errors.push(`${tag}：引用了未登记来源《${title}》`);
    }
  }

  const letterPattern = /(^|[^A-Za-z])([ABCD])([.．、：:)）]|\s|$)/;
  if (letterPattern.test(explanation) || /选项\s*[ABCD]/.test(explanation)) {
    errors.push(`${tag}：解析中用 A/B/C/D 指代选项`);
  }
  if (/待补|TODO|同上|未知|待定|略$/.test(explanation)) {
    errors.push(`${tag}：解析含占位内容`);
  }

  const key = normalize(explanation);
  if (explanationSeen.has(key)) {
    errors.push(`${tag}：解析与第 ${explanationSeen.get(key)} 题重复`);
  } else {
    explanationSeen.set(key, position);
  }
}

console.log(`课程：${course.name}`);
console.log(`题目：${questions.length}`);
console.log(`解析：${questions.filter((question) => String(question.explanation || "").trim()).length}`);
console.log(`速记：${questions.filter((question) => String(question.memoryTip || "").trim()).length}`);
console.log(`警告：${warnings.length}`);
for (const warning of warnings.slice(0, 20)) console.log(`警告 ${warning}`);
if (errors.length) {
  console.error(`\n校验失败，共 ${errors.length} 条：`);
  for (const error of errors.slice(0, 80)) console.error(`- ${error}`);
  if (errors.length > 80) console.error(`……还有 ${errors.length - 80} 条`);
  process.exitCode = 1;
} else {
  console.log("校验通过。");
}
