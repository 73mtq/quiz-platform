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

export function normalizeQuestion(question) {
  // 自动推断类型：显式指定 > 无选项有答案 > 默认选择题
  let type = question.type;
  if (type !== "fill-blank" && type !== "choice") {
    const hasOptions = (question.options || []).length > 0;
    const hasAnswer = (question.answer || []).length > 0;
    type = !hasOptions && hasAnswer ? "fill-blank" : "choice";
  }
  const normalized = {
    id: question.id || createId("question"),
    type,
    stem: String(question.stem || "").trim(),
    options: (question.options || []).map((option) => ({
      key: String(option.key || "").trim().toUpperCase(),
      text: String(option.text || "").trim()
    })).filter((option) => option.key && option.text),
    answer: type === "fill-blank"
      ? (question.answer || []).map((item) => String(item).trim()).filter(Boolean)
      : (question.answer || []).map((item) => String(item).trim().toUpperCase()).filter(Boolean),
    explanation: String(question.explanation || "").trim(),
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

  const optionKeys = new Set(question.options.map((option) => option.key));
  const invalidAnswer = question.answer.find((key) => !optionKeys.has(key));
  if (invalidAnswer) return `答案 ${invalidAnswer} 不在选项中`;

  return "";
}
