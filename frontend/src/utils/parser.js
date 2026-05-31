const optionRe = /^[（(]?\s*([A-Ha-h])\s*[）)\].、.．:：]?\s*(.+)$/;
const selectedARe = /^[oO0●○]\s+(.+)$/;
const answerRe = /^(?:正确\s*)?(?:答案|正确答案|参考答案|answer|ans)[\s:：]*(.+)$/i;
const explanationRe = /^(?:解析|答案解析|说明|解释|analysis)[\s:：]*(.*)$/i;
const startRe = /^(?:[|一]\s*)?(?:第?\s*\d+\s*[题、.．:：)]|\d+\s*[、.．:：)]|[（(]\d+[）)])\s*(.*)$/;
const noiseRe = /^(?:本题得分|得分|收起解析|展开解析|人\s*\^|[-—_]\s*[@●○oO0]?|一\s*\d+|[@●○])[:：\s\d分^@]*$/;
const optionKeys = ["A", "B", "C", "D", "E", "F", "G", "H"];

export function parseQuestions(text) {
  const questions = [];
  let current = createDraft();
  let readingExplanation = false;

  for (const line of normalize(text).split("\n").map((item) => item.trim()).filter(Boolean)) {
    if (noiseRe.test(line)) continue;

    const start = line.match(startRe);
    const option = line.match(optionRe);
    const selectedA = line.match(selectedARe);
    const answer = line.match(answerRe);
    const explanation = line.match(explanationRe);

    if (start && (current.options.length || current.answer.length || readingExplanation)) {
      finalize(current, questions);
      current = createDraft();
      readingExplanation = false;
      if (start[1]) current.stem.push(cleanText(start[1]));
      continue;
    }

    if (answer) {
      const answerText = answer[1].trim();
      // 判断是选择题答案（纯字母）还是填空题答案（含中文/数字等）
      const letterAnswers = (answerText.match(/[A-Ha-h]/g) || []).map((item) => item.toUpperCase());
      const isOnlyLetters = letterAnswers.length > 0 && answerText.replace(/[^A-Ha-h]/g, "").length === answerText.replace(/\s/g, "").length;
      if (isOnlyLetters) {
        current.answer = letterAnswers;
        current.type = "choice";
      } else {
        // 填空题：按 ；|、 分隔多个答案
        current.answer = answerText.split(/[；;|、]/).map((s) => cleanText(s.trim())).filter(Boolean);
        if (!current.answer.length) current.answer = [cleanText(answerText)];
        current.type = "fill-blank";
      }
      readingExplanation = true;
      continue;
    }
    if (explanation) {
      current.explanation = explanation[1] || "";
      readingExplanation = true;
      continue;
    }
    if (option && !readingExplanation) {
      current.options.push({ key: option[1].toUpperCase(), text: cleanOption(option[2]) });
      continue;
    }
    if (selectedA && !readingExplanation && !current.options.some((item) => item.key === "A")) {
      current.options.push({ key: "A", text: cleanOption(selectedA[1]) });
      continue;
    }
    if (!readingExplanation && looksLikeMissingOption(line, current)) {
      const key = nextOptionKey(current);
      if (key) {
        current.options.push({
          key,
          text: cleanOption(line.replace(/^[（(]?\s*\d+\s*[）)\]]?\s*/, "").replace(/^[-@●○oO0]\s*/, ""))
        });
        continue;
      }
    }
    if (readingExplanation) current.explanation += `${current.explanation ? "\n" : ""}${line}`;
    else current.stem.push(cleanText(start ? start[1] : line));
  }
  finalize(current, questions);
  return questions;
}

function createDraft() {
  return { stem: [], options: [], answer: [], explanation: "", type: "choice" };
}

function finalize(draft, target) {
  const stem = cleanText(draft.stem.join("\n"));
  const options = draft.options.map((option) => ({
    key: option.key,
    text: cleanOption(option.text)
  })).filter((option) => option.text);
  if (!stem || !draft.answer.length) return;

  const isFillBlank = draft.type === "fill-blank";
  // 填空题不需要选项，选择题至少需要 2 个选项
  if (!isFillBlank && options.length < 2) return;

  target.push({
    type: isFillBlank ? "fill-blank" : "choice",
    stem,
    options: isFillBlank ? [] : options,
    answer: [...new Set(draft.answer)],
    explanation: cleanText(draft.explanation)
  });
}

function normalize(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/PMoO|PmoO|PM0|Pwo/g, "PMO")
    .split("\n")
    .map((line) => cleanText(line).replace(/\s+/g, " ").trim())
    .join("\n");
}

function cleanText(text) {
  let next = String(text || "");
  let prev = "";
  while (next !== prev) {
    prev = next;
    next = next.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, "$1$2");
  }
  return next.trim();
}

function cleanOption(text) {
  return cleanText(text)
    .replace(/^[●○oO]\s*/, "")
    .replace(/[✓√✔✕×]\s*/g, "")
    .replace(/汽车轮取/g, "汽车轮胎")
    .trim();
}

function nextOptionKey(question) {
  const used = new Set(question.options.map((option) => option.key));
  return optionKeys.find((key) => !used.has(key)) || null;
}

function looksLikeMissingOption(line, question) {
  if (!question.options.length || question.answer.length) return false;
  if (!/[\u4e00-\u9fff]/.test(line)) return false;
  if (/^(?:正确答案|答案|本题得分|收起解析|展开解析)/.test(line)) return false;
  return /^[（(]?\s*\d+\s*[）)\]]?\s+/.test(line) || /^[-@●○oO0]\s*/.test(line);
}
