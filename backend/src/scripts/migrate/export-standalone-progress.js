import fs from "node:fs";
import path from "node:path";
import { computeBankHash, computeCoreHash } from "../../services/StandaloneBankHash.js";

const args = parseArgs(process.argv.slice(2));
const stateFile = requirePath(args.state, "--state");
const contentFile = requirePath(args.content, "--content");
const outputFile = requirePath(args.output, "--output");
const courseName = String(args.course || "国家安全教育");

const state = JSON.parse(fs.readFileSync(stateFile, "utf8").replace(/^\uFEFF/, ""));
const content = JSON.parse(fs.readFileSync(contentFile, "utf8").replace(/^\uFEFF/, ""));

const oldCourse = (state.courses || []).find((course) => course.name === courseName);
if (!oldCourse) throw new Error(`旧状态中没有课程“${courseName}”`);
const newCourse = (content.courses || []).find((course) => course.name === courseName);
if (!newCourse) throw new Error(`内容文件中没有课程“${courseName}”`);

const newById = new Map((newCourse.questions || []).map((question) => [question.id, question]));
const newByStem = new Map((newCourse.questions || []).map((question) => [normalizeStem(question.stem), question]));
const idMap = new Map();
const unmatched = [];

for (const question of oldCourse.questions || []) {
  const direct = newById.get(question.id);
  const byStem = direct || newByStem.get(normalizeStem(question.stem));
  if (byStem) idMap.set(question.id, byStem.id);
  else unmatched.push(question);
}

const questionProgress = {};
let matchedProgress = 0;
for (const question of oldCourse.questions || []) {
  const newId = idMap.get(question.id);
  if (!newId) continue;
  const hasProgress = (Number(question.wrongCount) || 0) > 0
    || (Number(question.correctCount) || 0) > 0
    || Boolean(question.bookmarked)
    || Boolean(question.review?.lastAnsweredAt);
  if (!hasProgress) continue;
  questionProgress[newId] = {
    wrongCount: Number(question.wrongCount) || 0,
    correctCount: Number(question.correctCount) || 0,
    bookmarked: Boolean(question.bookmarked),
    review: question.review || {}
  };
  matchedProgress += 1;
}

const practice = normalizePractice(oldCourse.practice || {});
practice.remainingIds = (practice.remainingIds || []).map((id) => idMap.get(id)).filter(Boolean);
practice.currentQuestionId = practice.currentQuestionId ? idMap.get(practice.currentQuestionId) || null : null;
practice.exam.questionIds = (practice.exam.questionIds || []).map((id) => idMap.get(id)).filter(Boolean);
practice.exam.lastWrongIds = (practice.exam.lastWrongIds || []).map((id) => idMap.get(id)).filter(Boolean);
practice.exam.answers = (practice.exam.answers || []).filter((answer) => idMap.has(answer.questionId)).map((answer) => ({
  ...answer,
  questionId: idMap.get(answer.questionId)
}));

const output = {
  version: 1,
  bankHash: computeBankHash(content.courses || []),
  coreHash: computeCoreHash(content.courses || []),
  exportedAt: new Date().toISOString(),
  savedAt: new Date().toISOString(),
  activeCourseId: newCourse.id,
  practices: { [newCourse.id]: practice },
  questionProgress: questionProgress
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), "utf8");
console.log(`已写入：${outputFile}`);
console.log(`旧题目：${(oldCourse.questions || []).length}；新题目：${(newCourse.questions || []).length}`);
console.log(`按 ID 或题干匹配：${idMap.size}；未匹配：${unmatched.length}`);
console.log(`已恢复进度：${matchedProgress} 道题`);
if (unmatched.length) {
  console.log("未匹配题目：");
  for (const question of unmatched.slice(0, 20)) console.log(`- ${question.id} ${question.stem}`);
}

function requirePath(value, flag) {
  if (!value || value === true) throw new Error(`缺少参数 ${flag}`);
  return path.resolve(String(value));
}

function normalizeStem(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（）()]/g, "")
    .trim();
}

function normalizePractice(practice = {}) {
  return {
    roundNo: Number(practice.roundNo) || 1,
    remainingIds: Array.isArray(practice.remainingIds) ? practice.remainingIds : [],
    answeredInRound: Number(practice.answeredInRound) || 0,
    correctInRound: Number(practice.correctInRound) || 0,
    totalAnswered: Number(practice.totalAnswered) || 0,
    totalCorrect: Number(practice.totalCorrect) || 0,
    currentQuestionId: practice.currentQuestionId || null,
    lastAnswer: practice.lastAnswer || null,
    mode: practice.mode || "all",
    count: Number(practice.count) || 0,
    exam: {
      timeLimitMinutes: Number(practice.exam?.timeLimitMinutes) || 20,
      startedAt: practice.exam?.startedAt || "",
      finishedAt: practice.exam?.finishedAt || "",
      questionIds: Array.isArray(practice.exam?.questionIds) ? practice.exam.questionIds : [],
      answers: Array.isArray(practice.exam?.answers) ? practice.exam.answers : [],
      lastWrongIds: Array.isArray(practice.exam?.lastWrongIds) ? practice.exam.lastWrongIds : [],
      lastSummary: practice.exam?.lastSummary || null
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
