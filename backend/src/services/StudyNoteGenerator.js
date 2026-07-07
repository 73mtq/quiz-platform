import { getChoiceAnswerTexts } from "../utils.js";

const BLANK_RE = /（\s*）|\(\s*\)|\[\s*\]|_{2,}|__+/u;
const SENTENCE_SPLIT_RE = /[。！？；;,.，\n]/u;
const SHORT_CUE_LENGTH = 4;
const KEYWORD_RE = /根本|核心|关键|基础|前提|保证|抓手|标志|体现|目的|原则|要求|任务|目标|途径|制度|体系|战略|方针|思想|路线/u;

export function buildStudyNotes(question, courseName = "") {
  const answerText = answerLabel(question);
  const cue = extractCue(question.stem, courseName);
  const isFillBlank = question.type === "fill-blank";
  const isMulti = !isFillBlank && (question.answer || []).length > 1;
  const isJudge = !isFillBlank && isJudgeQuestion(question);
  const wrongCount = Number(question.wrongCount) || 0;

  const explanation = buildExplanation({
    answerText,
    cue,
    isFillBlank,
    isMulti,
    isJudge
  });

  const memoryTip = [
    buildMemoryTip({
      answerText,
      cue,
      isFillBlank,
      isMulti,
      isJudge
    }),
    wrongCount > 0 ? `这题错过 ${wrongCount} 次，考前优先重刷。` : ""
  ].filter(Boolean).join(" ");

  return {
    explanation,
    memoryTip: stripMemoryTipLabel(memoryTip)
  };
}

export function applyStudyNotesToState(state, { overwrite = false } = {}) {
  const result = {
    scanned: 0,
    updated: 0,
    explanationAdded: 0,
    memoryTipAdded: 0
  };

  for (const course of state.courses || []) {
    for (const question of course.questions || []) {
      result.scanned += 1;
      const notes = buildStudyNotes(question, course.name);
      let changed = false;

      if (overwrite || !String(question.explanation || "").trim()) {
        question.explanation = notes.explanation;
        result.explanationAdded += 1;
        changed = true;
      }

      const existingMemoryTip = stripMemoryTipLabel(question.memoryTip);
      if (overwrite || !existingMemoryTip) {
        question.memoryTip = notes.memoryTip;
        result.memoryTipAdded += 1;
        changed = true;
      } else if (existingMemoryTip !== question.memoryTip) {
        question.memoryTip = existingMemoryTip;
        changed = true;
      }

      if (changed) result.updated += 1;
    }
  }

  return result;
}

export function stripMemoryTipLabel(value = "") {
  let text = String(value || "").trim();
  while (/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u.test(text)) {
    text = text.replace(/^(?:速记|快速记忆|记忆法|口诀)\s*[：:]\s*/u, "").trim();
  }
  return text;
}

function buildExplanation({ answerText, cue, isFillBlank, isMulti, isJudge }) {
  if (isFillBlank) {
    return `本题是填空题，空格所在短句指向“${answerText}”。定位“${cue}”，直接回填答案。`;
  }
  if (isMulti) {
    return `本题是多选题，正确项为“${answerText}”。少选、多选都算错，要按题干里的并列要点成组记。`;
  }
  if (isJudge) {
    return `本题是判断题，题干表述应判为“${answerText}”。先抓限定词，再判断整句话是否成立。`;
  }
  return `本题考题干短句“${cue}”对应的概念或表述，正确答案是“${answerText}”。`;
}

function buildMemoryTip({ answerText, cue, isFillBlank, isMulti, isJudge }) {
  if (isFillBlank) {
    return `定位“${cue}”，空里填“${answerText}”。先背定位词，再默写答案。`;
  }
  if (isMulti) {
    return `把正确项压成一组“${compact(answerText)}”。做题先数答案数，再逐项排除。`;
  }
  if (isJudge) {
    return `看到题干限定词先判整句：本题结论是“${answerText}”。`;
  }
  return `用“${cue} -> ${answerText}”绑定，看到同类短句先锁定答案再排除。`;
}

function answerLabel(question) {
  if (question.type === "fill-blank") {
    return (question.answer || []).map((item) => String(item).trim()).filter(Boolean).join("、") || "正确答案";
  }
  return getChoiceAnswerTexts(question).join("、") || "正确答案";
}

function extractCue(stem = "", courseName = "") {
  const text = normalizeStem(stem);
  if (!text) return courseName || "本题";

  const blankCue = cueNearBlank(text);
  if (blankCue) return blankCue;

  const keywordCue = cueNearKeyword(text);
  if (keywordCue) return keywordCue;

  return sentenceCue(text, courseName);
}

function cueNearBlank(text) {
  const blankIndex = text.search(BLANK_RE);
  if (blankIndex < 0) return "";

  const before = cleanCue(text.slice(Math.max(0, blankIndex - 18), blankIndex));
  const afterText = text.slice(blankIndex).replace(BLANK_RE, "");
  const after = cleanCue((afterText.split(SENTENCE_SPLIT_RE).find(Boolean) || afterText).slice(0, 18));
  if (after && KEYWORD_RE.test(after) && !enoughCue(after)) {
    const joined = text.replace(BLANK_RE, "");
    return cleanCue(joined.slice(Math.max(0, blankIndex - 18), Math.min(joined.length, blankIndex + 18))) || sentenceCue(joined);
  }
  const candidate = chooseCue(before, after);
  return candidate || sentenceCue(text);
}

function cueNearKeyword(text) {
  const match = KEYWORD_RE.exec(text);
  if (!match) return "";
  const start = Math.max(0, match.index - 12);
  const end = Math.min(text.length, match.index + match[0].length + 12);
  return enoughCue(cleanCue(text.slice(start, end))) || "";
}

function chooseCue(before, after) {
  const candidates = [after, before].filter(Boolean);
  for (const candidate of candidates) {
    const enough = enoughCue(candidate);
    if (enough) return enough;
  }
  return "";
}

function sentenceCue(text, fallback = "") {
  const firstSentence = text.split(SENTENCE_SPLIT_RE).find(Boolean) || text;
  return cleanCue(firstSentence.slice(0, 28)) || fallback || "本题";
}

function enoughCue(value) {
  const cue = cleanCue(value);
  if (!cue) return "";
  if (cue.length > SHORT_CUE_LENGTH) return cue;
  return "";
}

function normalizeStem(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[？?]$/u, "")
    .trim();
}

function cleanCue(value) {
  return String(value || "")
    .replace(/[“”‘’"'<>\[\]【】]/gu, "")
    .replace(/^[，。；、：:（）()]+|[，。；、：:（）()]+$/gu, "")
    .replace(/^是/u, "")
    .trim();
}

function compact(value) {
  return String(value || "")
    .split("、")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("+");
}

function isJudgeQuestion(question) {
  const optionTexts = (question.options || [])
    .map((option) => String(option.text || "").trim())
    .filter(Boolean);
  if (optionTexts.length !== 2) return false;
  const normalized = optionTexts.map((item) => item.replace(/\s+/g, ""));
  const positive = ["正确", "对", "是", "√"];
  const negative = ["错误", "错", "否", "×", "不正确"];
  return normalized.some((item) => positive.includes(item)) && normalized.some((item) => negative.includes(item));
}
