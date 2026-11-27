import { isChoiceAnswerCorrect, isFillBlankAnswerCorrect } from "./answers.js";

export function examQuestionTotal(practice = {}, fallbackTotal = 0) {
  const examIds = practice.exam?.questionIds;
  if (Array.isArray(examIds) && examIds.length) return examIds.length;

  return roundQuestionTotal(practice, fallbackTotal);
}

export function roundQuestionTotal(practice = {}, fallbackTotal = 0) {
  const fixed = Number(practice.roundTotal) || 0;
  if (fixed > 0) return fixed;

  const answered = Number(practice.answeredInRound) || 0;
  const answeredIds = new Set(Array.isArray(practice.answeredIds) ? practice.answeredIds : []);
  const remaining = (Array.isArray(practice.remainingIds) ? practice.remainingIds : [])
    .filter((id) => !answeredIds.has(id)).length;
  const currentSubmitted = Boolean(practice.currentQuestionId) && (
    practice.lastAnswer?.questionId === practice.currentQuestionId
    || answeredIds.has(practice.currentQuestionId)
  );
  const current = practice.currentQuestionId && !currentSubmitted ? 1 : 0;
  const derived = answered + remaining + current;
  if (derived > 0) return derived;

  return Math.max(0, Number(practice.count) || Number(fallbackTotal) || 0);
}

export function examRemainingCount(practice = {}, fallbackTotal = 0) {
  return roundRemainingCount(practice, fallbackTotal);
}

export function roundAnsweredCount(practice = {}, fallbackTotal = 0) {
  const total = roundQuestionTotal(practice, fallbackTotal);
  return Math.min(total, Number(practice.answeredInRound) || 0);
}

export function roundRemainingCount(practice = {}, fallbackTotal = 0) {
  const total = roundQuestionTotal(practice, fallbackTotal);
  const answered = Math.min(total, Number(practice.answeredInRound) || 0);
  return Math.max(0, total - answered);
}

export function hasNextQuestionInRound(practice = {}) {
  return Array.isArray(practice.remainingIds) && practice.remainingIds.length > 0;
}

export function shouldAutoNextAfterSubmit({ correct, autoNext, practice }) {
  return Boolean(correct && autoNext && hasNextQuestionInRound(practice));
}

export function isQuestionAnsweredInRound(practice = {}, questionId) {
  return Boolean(questionId && Array.isArray(practice.answeredIds) && practice.answeredIds.includes(questionId));
}

/** 本轮已作答回顾：优先使用刚提交的反馈，否则用本轮保存的答案重建 */
export function resolveAnswerFeedback({ question, practice = {}, liveFeedback = null } = {}) {
  if (!question?.id) return null;
  if (liveFeedback?.questionId === question.id) return liveFeedback;
  if (!isQuestionAnsweredInRound(practice, question.id)) return null;

  const examAnswer = (practice.exam?.answers || []).find((answer) => answer?.questionId === question.id);
  const recordedAnswers = examAnswer?.selectedAnswers || question.review?.lastSelectedAnswers || [];
  if (!recordedAnswers.length) return null;

  const selectedAnswers = recordedAnswers.map((item) => String(item));
  const correct = question.type === "fill-blank"
    ? isFillBlankAnswerCorrect(question, selectedAnswers)
    : isChoiceAnswerCorrect(question, selectedAnswers);
  return { questionId: question.id, selectedAnswers, correct };
}

export function isPracticeRoundComplete(practice = {}, fallbackTotal = 0) {
  const total = roundQuestionTotal(practice, fallbackTotal);
  if (total <= 0) return false;
  return roundAnsweredCount(practice, fallbackTotal) >= total && !hasNextQuestionInRound(practice);
}

export function isPracticeRoundStarted(practice = {}) {
  return Boolean(practice.currentQuestionId) || (Number(practice.answeredInRound) || 0) > 0;
}

export function applyLocalPracticeConfig(practice = {}, { mode = "all", count = 0, timeLimitMinutes = 20 } = {}) {
  practice.mode = mode;
  if ((mode === "count" || mode === "exam") && Number(count) > 0) {
    practice.count = Number(count);
  } else if (mode !== "count" && mode !== "exam") {
    practice.count = 0;
  }
  practice.remainingIds = [];
  practice.answeredInRound = 0;
  practice.correctInRound = 0;
  practice.currentQuestionId = null;
  practice.lastAnswer = null;
  practice.roundTotal = 0;
  practice.answeredIds = [];
  practice.historyIds = [];

  if (mode === "exam" || mode === "exam-wrong") {
    practice.exam = {
      timeLimitMinutes: Number(timeLimitMinutes) || 20,
      startedAt: "",
      finishedAt: "",
      questionIds: [],
      answers: [],
      lastWrongIds: practice.exam?.lastWrongIds || [],
      lastSummary: mode === "exam-wrong" ? practice.exam?.lastSummary || null : null
    };
  }

  return practice;
}

export function stripMemoryTipLabel(value = "") {
  let text = String(value || "").trim();
  while (/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u.test(text)) {
    text = text.replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "").trim();
  }
  return text;
}
