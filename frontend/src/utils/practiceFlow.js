export function examQuestionTotal(practice = {}, fallbackTotal = 0) {
  const examIds = practice.exam?.questionIds;
  if (Array.isArray(examIds) && examIds.length) return examIds.length;

  return roundQuestionTotal(practice, fallbackTotal);
}

export function roundQuestionTotal(practice = {}, fallbackTotal = 0) {
  const answered = Number(practice.answeredInRound) || 0;
  const remaining = Array.isArray(practice.remainingIds) ? practice.remainingIds.length : 0;
  const currentSubmitted = practice.lastAnswer?.questionId && practice.lastAnswer.questionId === practice.currentQuestionId;
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
  return String(value || "")
    .trim()
    .replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "")
    .replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "")
    .trim();
}
