export function createId(prefix = "id") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

export function readBody(req, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
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

    const byKey = options.find((option) => option.key.toUpperCase() === raw.toUpperCase());
    const byText = byKey || options.find((option) => normalizeChoiceText(option.text) === normalizeChoiceText(raw));
    const text = byText ? byText.text : raw;
    const key = normalizeChoiceText(text);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(text);
  }

  return result;
}

export function areChoiceAnswerSetsEqual(question, selectedAnswers, correctAnswers = question.answer || []) {
  const selected = getChoiceAnswerTexts(question, selectedAnswers).map(normalizeChoiceText).sort();
  const correct = getChoiceAnswerTexts(question, correctAnswers).map(normalizeChoiceText).sort();
  return selected.length === correct.length && selected.every((item, index) => item === correct[index]);
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
    wrongCount: Number(question.wrongCount) || 0,
    correctCount: Number(question.correctCount) || 0,
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
