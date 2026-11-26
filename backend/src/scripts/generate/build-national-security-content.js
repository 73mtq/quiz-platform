import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeQuestion } from "../../utils.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const args = parseArgs(process.argv.slice(2));
const sourceFile = args.source ? path.resolve(String(args.source)) : path.join(repoRoot, "data/quiz-data.json");
const explanationsDir = path.join(repoRoot, "content/national-security/explanations");
const outputFile = args.output ? path.resolve(String(args.output)) : path.join(repoRoot, "content/national-security/course.json");
const courseName = String(args.course || "国家安全教育");

const state = JSON.parse(fs.readFileSync(sourceFile, "utf8").replace(/^\uFEFF/, ""));
const sourceCourse = (state.courses || []).find((course) => course.name === courseName);
if (!sourceCourse) throw new Error(`题库文件中没有课程“${courseName}”`);

const notes = new Map();
for (const file of fs.readdirSync(explanationsDir).filter((name) => /^batch-\d+\.json$/.test(name)).sort()) {
  const batch = JSON.parse(fs.readFileSync(path.join(explanationsDir, file), "utf8").replace(/^\uFEFF/, ""));
  for (const [id, value] of Object.entries(batch)) {
    if (!value || typeof value !== "object") continue;
    notes.set(id, value);
  }
}

const missing = [];
const questions = (sourceCourse.questions || []).map((question) => {
  const note = notes.get(question.id);
  if (!note?.explanation) missing.push(question.id);
  return normalizeQuestion({
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    explanation: note?.explanation || "",
    memoryTip: note?.memoryTip || "",
    wrongCount: 0,
    correctCount: 0,
    bookmarked: false,
    review: {},
    createdAt: question.createdAt
  });
});

const payload = {
  activeCourseId: sourceCourse.id,
  courses: [{
    id: sourceCourse.id,
    name: sourceCourse.name,
    questions,
    practice: emptyPractice(),
    createdAt: sourceCourse.createdAt || ""
  }]
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), "utf8");
console.log(`已写入：${outputFile}`);
console.log(`题目：${questions.length}`);
console.log(`解析：${questions.filter((question) => String(question.explanation || "").trim()).length}`);
console.log(`缺少解析：${missing.length}`);
if (missing.length) {
  console.log("缺少解析的题目：");
  for (const id of missing.slice(0, 40)) console.log(`- ${id}`);
}

function emptyPractice() {
  return {
    roundNo: 1,
    remainingIds: [],
    answeredInRound: 0,
    correctInRound: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    currentQuestionId: null,
    lastAnswer: null,
    mode: "all",
    count: 0,
    exam: {
      timeLimitMinutes: 20,
      startedAt: "",
      finishedAt: "",
      questionIds: [],
      answers: [],
      lastWrongIds: [],
      lastSummary: null
    }
  };
}

function parseArgs(values) {
  const result = { _: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    if (equals >= 0) {
      result[value.slice(2, equals)] = value.slice(equals + 1);
      continue;
    }
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}
