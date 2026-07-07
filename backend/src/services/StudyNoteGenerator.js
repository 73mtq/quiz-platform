import { getChoiceAnswerTexts } from "../utils.js";

const BLANK_RE = /（\s*）|\(\s*\)|\[\s*\]|_{2,}|…+/;
const SENTENCE_SPLIT_RE = /[。！？；;,.，\n]/;

export function buildStudyNotes(question, courseName = "") {
  const answerText = answerLabel(question);
  const cue = extractCue(question.stem, courseName);
  const isFillBlank = question.type === "fill-blank";
  const isMulti = !isFillBlank && (question.answer || []).length > 1;
  const wrongCount = Number(question.wrongCount) || 0;

  const explanation = isFillBlank
    ? `本题考固定表述：看到“${cue}”，空里补“${answerText}”。`
    : isMulti
      ? `本题是多选题，正确组合是“${answerText}”，要按整组理解。`
      : `本题考“${cue}”对应的概念或表述，正确答案是“${answerText}”。`;

  const memoryTip = [
    isFillBlank
      ? `速记：${cue} -> ${answerText}。先背关键词，再默写答案。`
      : isMulti
        ? `速记：把答案压成一组“${compact(answerText)}”，做题时先数并列点。`
        : `速记：${cue} = ${answerText}。看到关键词先锁定答案，再排除干扰项。`,
    wrongCount > 0 ? `这题错过 ${wrongCount} 次，考前优先重刷。` : ""
  ].filter(Boolean).join(" ");

  return { explanation, memoryTip };
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
      if (overwrite || !String(question.memoryTip || "").trim()) {
        question.memoryTip = notes.memoryTip;
        result.memoryTipAdded += 1;
        changed = true;
      }
      if (changed) result.updated += 1;
    }
  }

  return result;
}

function answerLabel(question) {
  if (question.type === "fill-blank") {
    return (question.answer || []).map((item) => String(item).trim()).filter(Boolean).join("、") || "正确答案";
  }
  return getChoiceAnswerTexts(question).join("、") || "正确答案";
}

function extractCue(stem = "", courseName = "") {
  const text = String(stem || "").replace(/\s+/g, "").trim();
  if (!text) return courseName || "本题";

  const blankIndex = text.search(BLANK_RE);
  if (blankIndex >= 0) {
    const before = cleanCue(text.slice(Math.max(0, blankIndex - 18), blankIndex));
    const afterText = text.slice(blankIndex).replace(BLANK_RE, "");
    const after = cleanCue((afterText.split(SENTENCE_SPLIT_RE).find(Boolean) || afterText).slice(0, 18));
    if (after && (blankIndex < 3 || /^是/.test(after) || /根本|核心|关键|基础|前提|保证|抓手|标志|体现|目的|重要|手段/.test(after))) {
      return after;
    }
    const cue = before || after;
    if (cue) return cue;
  }

  const firstSentence = text.split(SENTENCE_SPLIT_RE).find(Boolean) || text;
  return cleanCue(firstSentence.slice(0, 22)) || courseName || "本题";
}

function cleanCue(value) {
  return String(value || "")
    .replace(/[“”"'《》<>]/g, "")
    .replace(/^[，。；、：:（）()]+|[，。；、：:（）()]+$/g, "")
    .replace(/^是/, "")
    .trim();
}

function compact(value) {
  return String(value || "")
    .split("、")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("+");
}
