import zlib from "node:zlib";
import { promisify } from "node:util";

const gzip = promisify(zlib.gzip);
const COMPRESS_MIN_BYTES = 1024;

export function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function httpError(status, message) {
  const error = new Error(message);
  error.statusCode = status;
  return error;
}

export async function sendJson(req, res, status, payload) {
  await sendBody(req, res, status, "application/json; charset=utf-8", Buffer.from(JSON.stringify(payload), "utf8"), {
    "cache-control": "no-store"
  });
}

export async function sendBody(req, res, status, contentType, body, extraHeaders = {}) {
  if (res.writableEnded) return;
  const headers = { "content-type": contentType, ...extraHeaders };
  if (body.length >= COMPRESS_MIN_BYTES && acceptsGzip(req)) {
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
    res.writeHead(status, headers);
    res.end(await gzip(body));
    return;
  }
  res.writeHead(status, headers);
  res.end(body);
}

export function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
}

export function readBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let exceeded = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (exceeded) return;
      size += chunk.length;
      if (size > maxBytes) {
        exceeded = true;
        chunks.length = 0;
        reject(httpError(413, "请求体超过大小上限"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!exceeded) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!exceeded) reject(error);
    });
  });
}

export function normalizeChoiceText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function getChoiceAnswerTexts(question, answers = question.answer || []) {
  const options = question.options || [];
  const seen = new Set();
  const result = [];

  for (const answer of answers || []) {
    const raw = String(answer || "").trim();
    if (!raw) continue;

    const byKey = options.find((option) => String(option.key || "").trim().toUpperCase() === raw.toUpperCase());
    const byText = byKey || options.find((option) => normalizeChoiceText(option.text) === normalizeChoiceText(raw));
    const text = byText ? byText.text : raw;
    const key = normalizeChoiceText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

export function normalizeReviewState(review = {}) {
  return {
    lastAnsweredAt: review.lastAnsweredAt || "",
    lastWrongAt: review.lastWrongAt || "",
    lastCorrectAt: review.lastCorrectAt || "",
    consecutiveCorrect: Number(review.consecutiveCorrect) || 0,
    masteredAt: review.masteredAt || "",
    lastSelectedAnswers: Array.isArray(review.lastSelectedAnswers)
      ? review.lastSelectedAnswers.map((item) => String(item))
      : []
  };
}

export function isPendingWrongQuestion(question) {
  return (question.wrongCount || 0) > 0 && !question.review?.masteredAt;
}

export function reviewPriority(question) {
  const wrong = question.wrongCount || 0;
  const correct = question.correctCount || 0;
  const answerCount = (question.answer || []).length;
  const lastWrongAt = Date.parse(question.review?.lastWrongAt || "") || 0;
  const recency = lastWrongAt ? Math.min(30, Math.floor((Date.now() - lastWrongAt) / 86400000)) : 30;

  return (wrong * 100)
    + (correct ? 0 : 40)
    + (answerCount > 1 ? 24 + answerCount : 0)
    + (30 - recency);
}

export function getWrongPracticeQuestions(questions) {
  return questions
    .filter(isPendingWrongQuestion)
    .sort((a, b) => reviewPriority(b) - reviewPriority(a));
}

export function updateQuestionReview(question, { correct, selectedAnswers, answeredAt = new Date().toISOString() }) {
  const review = normalizeReviewState(question.review);
  review.lastAnsweredAt = answeredAt;
  review.lastSelectedAnswers = (selectedAnswers || []).map((item) => String(item));

  if (correct) {
    review.lastCorrectAt = answeredAt;
    review.consecutiveCorrect += 1;
    if ((question.wrongCount || 0) > 0 && review.consecutiveCorrect >= 2) {
      review.masteredAt = review.masteredAt || answeredAt;
    }
  } else {
    review.lastWrongAt = answeredAt;
    review.consecutiveCorrect = 0;
    review.masteredAt = "";
  }

  question.review = review;
  return review;
}

export function areChoiceAnswerSetsEqual(question, selectedAnswers, correctAnswers = question.answer || []) {
  const selected = getChoiceAnswerTexts(question, selectedAnswers).map(normalizeChoiceText).sort();
  const correct = getChoiceAnswerTexts(question, correctAnswers).map(normalizeChoiceText).sort();
  return selected.length === correct.length && selected.every((item, index) => item === correct[index]);
}

export function areFillBlankAnswersCorrect(question, selectedAnswers = []) {
  const answers = (selectedAnswers || []).map((item) => String(item ?? "").trim());
  const blanks = question.answer || [];
  const blanksCorrect = answers.map((userAnswerText, index) => {
    if (!userAnswerText) return false;
    const acceptable = String(blanks[index] || "")
      .split(/[；;|、]/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    return acceptable.includes(userAnswerText.toLowerCase());
  });
  return blanksCorrect.length === blanks.length && blanksCorrect.every(Boolean);
}

export function normalizeQuestion(question) {
  // 自动推断类型：显式指定 > 无选项有答案 > 默认选择题
  let type = question.type;
  if (type !== "fill-blank" && type !== "choice") {
    const hasOptions = (question.options || []).length > 0;
    const hasAnswer = (question.answer || []).length > 0;
    type = !hasOptions && hasAnswer ? "fill-blank" : "choice";
  }
  const options = (question.options || []).map((option) => {
    const key = String(option.key || "").trim().toUpperCase();
    return {
      key,
      text: cleanOptionText(String(option.text || "").trim(), key)
    };
  }).filter((option) => option.key && option.text);

  const normalized = {
    id: question.id || createId("question"),
    type,
    stem: String(question.stem || "").trim(),
    options,
    answer: type === "fill-blank"
      ? (question.answer || []).map((item) => String(item).trim()).filter(Boolean)
      : getChoiceAnswerTexts({ options }, question.answer || []),
	    explanation: String(question.explanation || "").trim(),
	    memoryTip: String(question.memoryTip || "").trim(),
	    wrongCount: Number(question.wrongCount) || 0,
    correctCount: Number(question.correctCount) || 0,
    bookmarked: Boolean(question.bookmarked),
    review: normalizeReviewState(question.review),
    createdAt: question.createdAt || new Date().toISOString()
  };
  if (question.updatedAt) normalized.updatedAt = question.updatedAt;
  return normalized;
}

export function validateQuestion(question) {
  if (!question.stem) return "缺少题干";
  if (question.type === "fill-blank") {
    if (!question.answer.length) return "缺少正确答案";
    return "";
  }
  if (question.options.length < 2) return "至少需要 2 个选项";
  if (!question.answer.length) return "缺少正确答案";

  const optionTexts = new Set(question.options.map((option) => normalizeChoiceText(option.text)));
  const invalidAnswer = question.answer.find((answer) => !optionTexts.has(normalizeChoiceText(answer)));
  if (invalidAnswer) return `答案 ${invalidAnswer} 不在选项内容中`;

  return "";
}

function cleanOptionText(text, key) {
  if (!/^[A-Z]$/.test(key)) return text;
  return text.replace(new RegExp(`^${key}\\s*[.．、)）:：]\\s*`, "i"), "").trim();
}
