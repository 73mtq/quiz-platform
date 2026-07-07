export function examQuestionTotal(practice = {}, fallbackTotal = 0) {
  const examIds = practice.exam?.questionIds;
  if (Array.isArray(examIds) && examIds.length) return examIds.length;

  const answered = Number(practice.answeredInRound) || 0;
  const remaining = Array.isArray(practice.remainingIds) ? practice.remainingIds.length : 0;
  const current = practice.currentQuestionId ? 1 : 0;
  const derived = answered + remaining + current;
  if (derived > 0) return derived;

  return Math.max(0, Number(practice.count) || Number(fallbackTotal) || 0);
}

export function examRemainingCount(practice = {}, fallbackTotal = 0) {
  const total = examQuestionTotal(practice, fallbackTotal);
  const answered = Math.min(total, Number(practice.answeredInRound) || 0);
  return Math.max(0, total - answered);
}

export function hasNextQuestionInRound(practice = {}) {
  return Array.isArray(practice.remainingIds) && practice.remainingIds.length > 0;
}

export function shouldAutoNextAfterSubmit({ correct, autoNext, practice }) {
  return Boolean(correct && autoNext && hasNextQuestionInRound(practice));
}

export function stripMemoryTipLabel(value = "") {
  return String(value || "")
    .trim()
    .replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "")
    .replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "")
    .trim();
}
