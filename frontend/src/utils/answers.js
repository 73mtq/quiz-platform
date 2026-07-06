export function normalizeChoiceText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}

export function getChoiceAnswerTexts(question, answers = question?.answer || []) {
  const options = question?.options || [];
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

export function hasChoiceAnswer(question, value, answers = question?.answer || []) {
  const key = normalizeChoiceText(value);
  return getChoiceAnswerTexts(question, answers).some((answer) => normalizeChoiceText(answer) === key);
}

export function isChoiceAnswerCorrect(question, selectedAnswers) {
  const selected = getChoiceAnswerTexts(question, selectedAnswers).map(normalizeChoiceText).sort();
  const correct = getChoiceAnswerTexts(question).map(normalizeChoiceText).sort();
  return selected.length === correct.length && selected.every((item, index) => item === correct[index]);
}
