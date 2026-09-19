import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const outputFile = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repoRoot, "dist/maogai-quiz.html");
const defaultProgressFile = path.join(repoRoot, "data", "maogai-progress.json");
const progressFile = process.argv[4] ? path.resolve(process.argv[4]) : defaultProgressFile;

const selectedSource = await selectMaoGaiSource(process.argv[2] ? [path.resolve(process.argv[2])] : await discoverSourceCandidates());
const { sourceFile, sourceRaw, courses, extraction } = selectedSource;
const sourceQuestionCoreSha256 = sha256(JSON.stringify(courses.map(courseCore)));
const generatedNotes = applyGeneratedStudyNotes(courses);
const sourceStat = await fs.stat(sourceFile);

if (!courses.length) {
  throw new Error("没有找到可迁移的毛概课程。");
}

const activeCourseId = courses[0].id;

const payload = {
  metadata: {
    title: "毛概题库离线刷题",
    generatedAt: new Date().toISOString(),
    sourceFile: path.relative(repoRoot, sourceFile).replace(/\\/g, "/"),
    sourceMtime: sourceStat.mtime.toISOString(),
    sourceSha256: sha256(sourceRaw),
    sourceQuestionCoreSha256,
    questionBankSha256: sha256(JSON.stringify(courses.map(({ id, name, questions }) => ({ id, name, questions })))),
    totalCourses: courses.length,
    totalQuestions: courses.reduce((sum, course) => sum + course.questions.length, 0),
    extraction,
    generatedNotes
  },
  activeCourseId,
  courses
};

const embeddedProgress = await loadInitialProgress(progressFile, payload);
if (embeddedProgress) {
  payload.initialProgress = embeddedProgress.progress;
  payload.metadata.initialProgress = embeddedProgress.metadata;
  payload.metadata.compatibleProgressHashes = [
    ...new Set([
      payload.metadata.sourceQuestionCoreSha256,
      embeddedProgress.metadata.originalBankHash
    ].filter(Boolean))
  ];
}

const validation = validatePayload(payload);
if (validation.errors.length) {
  throw new Error(`题库校验失败：\n${validation.errors.join("\n")}`);
}

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, renderHtml(payload), "utf8");

const verifyResult = await verifyOutput(outputFile, payload);

console.log(`HTML: ${outputFile}`);
console.log(`Courses: ${payload.metadata.totalCourses}`);
console.log(`Questions: ${payload.metadata.totalQuestions}`);
console.log(`Source SHA256: ${payload.metadata.sourceSha256}`);
console.log(`Source core SHA256: ${payload.metadata.sourceQuestionCoreSha256}`);
console.log(`Question bank SHA256: ${payload.metadata.questionBankSha256}`);
console.log(`Extraction: ${payload.metadata.extraction.method}`);
console.log(`Generated explanations: ${payload.metadata.generatedNotes.explanationAdded}`);
console.log(`Generated memory tips: ${payload.metadata.generatedNotes.memoryTipAdded}`);
console.log(`Verified: ${verifyResult}`);

async function discoverSourceCandidates() {
  const roots = [
    path.join(repoRoot, "data"),
    path.join(repoRoot, "data/backups")
  ];
  const files = [];
  for (const root of roots) {
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!/^quiz-data(?:\.json|[.-].*)/i.test(entry.name)) continue;
      const file = path.join(root, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat) files.push({ file, mtimeMs: stat.mtimeMs });
    }
  }
  return [...new Map(files.map((item) => [item.file, item])).values()]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((item) => item.file);
}

async function selectMaoGaiSource(files) {
  const candidates = [];
  for (const file of files) {
    const raw = await fs.readFile(file, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    try {
      const state = JSON.parse(raw.replace(/^\uFEFF/, ""));
      const result = extractMaoGaiCourses(state);
      if (result.courses.length) {
        candidates.push({
          sourceFile: file,
          sourceRaw: raw.replace(/^\uFEFF/, ""),
          courses: result.courses,
          extraction: result.extraction,
          score: result.courses.reduce((sum, course) => sum + course.questions.length, 0)
        });
      }
    } catch {
      // Ignore malformed backup candidates.
    }
  }

  if (!candidates.length) {
    throw new Error("没有在 data/ 或 data/backups/ 中找到可识别的毛概题库。");
  }

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function extractMaoGaiCourses(state) {
  const rawCourses = (state.courses || [])
    .filter((course) => Array.isArray(course.questions) && course.questions.length > 0);

  const namedCourses = rawCourses.filter((course) => /毛概|毛泽东思想和中国特色社会主义理论体系概论/.test(course.name || ""));
  if (namedCourses.length) {
    return {
      courses: namedCourses.map((course, index) => ({
        id: course.id || `course-maogai-${index + 1}`,
        name: course.name || "毛概题库",
        questions: course.questions,
        practice: emptyPractice(),
        createdAt: course.createdAt || ""
      })),
      extraction: {
        method: "named-course",
        sourceCourseNames: namedCourses.map((course) => course.name),
        removedPrefixQuestions: 0
      }
    };
  }

  let best = null;
  const byName = new Map();
  for (const course of rawCourses) {
    const key = String(course.name || "");
    byName.set(key, [...(byName.get(key) || []), course]);
  }

  for (const [name, group] of byName) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.questions.length - b.questions.length);
    for (let smallIndex = 0; smallIndex < sorted.length; smallIndex += 1) {
      for (let largeIndex = smallIndex + 1; largeIndex < sorted.length; largeIndex += 1) {
        const smaller = sorted[smallIndex];
        const larger = sorted[largeIndex];
        if (!hasPrefixQuestions(larger.questions, smaller.questions)) continue;
        const appended = larger.questions.slice(smaller.questions.length);
        if (!looksLikeMaoGai(appended)) continue;
        if (!best || appended.length > best.questions.length) {
          best = {
            name,
            larger,
            smaller,
            questions: appended
          };
        }
      }
    }
  }

  if (!best) return { courses: [], extraction: null };

  return {
    courses: [{
      id: "course-maogai-standalone",
      name: "毛概题库",
      questions: best.questions,
      practice: emptyPractice(),
      createdAt: best.larger.createdAt || ""
    }],
    extraction: {
      method: "duplicate-prefix-tail",
      sourceCourseName: best.name,
      sourceCourseId: best.larger.id || "",
      prefixCourseId: best.smaller.id || "",
      removedPrefixQuestions: best.smaller.questions.length,
      extractedQuestions: best.questions.length
    }
  };
}

function hasPrefixQuestions(larger, smaller) {
  if (!Array.isArray(larger) || !Array.isArray(smaller) || larger.length <= smaller.length) return false;
  for (let index = 0; index < smaller.length; index += 1) {
    if (questionSignature(larger[index]) !== questionSignature(smaller[index])) return false;
  }
  return true;
}

function questionSignature(question) {
  return JSON.stringify({
    stem: String(question?.stem || "").trim(),
    options: (question?.options || []).map((option) => ({
      key: String(option.key || "").trim().toUpperCase(),
      text: String(option.text || "").trim()
    })),
    answer: (question?.answer || []).map((item) => String(item || "").trim())
  });
}

function looksLikeMaoGai(questions) {
  const text = questions.map((question) => [
    question.stem,
    ...(question.options || []).map((option) => option.text),
    question.explanation,
    question.memoryTip
  ].join("\n")).join("\n");
  const marker = /毛泽东思想和中国特色社会主义理论体系概论|贯穿于《毛泽东思想和中国特色社会主义理论体系概论》/.test(text);
  const maoHits = (text.match(/毛泽东思想|邓小平理论|三个代表|科学发展观|新民主主义|社会主义改造|社会主义建设|中国特色社会主义理论体系/g) || []).length;
  return marker || maoHits >= 20;
}

function emptyExam() {
  return {
    timeLimitMinutes: 20,
    startedAt: "",
    finishedAt: "",
    questionIds: [],
    answers: [],
    lastWrongIds: [],
    lastSummary: null
  };
}

function emptyPractice() {
  return {
    roundNo: 1,
    remainingIds: [],
    answeredInRound: 0,
    correctInRound: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    currentQuestionId: null,
    lastAnswer: null,
    mode: "all",
    count: 0,
    exam: emptyExam()
  };
}

function normalizePractice(practice = {}) {
  const base = { ...emptyPractice(), ...(practice || {}) };
  return {
    ...base,
    remainingIds: Array.isArray(base.remainingIds) ? base.remainingIds : [],
    answeredInRound: Number(base.answeredInRound) || 0,
    correctInRound: Number(base.correctInRound) || 0,
    totalAnswered: Number(base.totalAnswered) || 0,
    totalCorrect: Number(base.totalCorrect) || 0,
    currentQuestionId: base.currentQuestionId || null,
    lastAnswer: base.lastAnswer || null,
    mode: base.mode || "all",
    count: Number(base.count) || 0,
    exam: {
      ...emptyExam(),
      ...(base.exam || {}),
      questionIds: Array.isArray(base.exam?.questionIds) ? base.exam.questionIds : [],
      answers: Array.isArray(base.exam?.answers) ? base.exam.answers : [],
      lastWrongIds: Array.isArray(base.exam?.lastWrongIds) ? base.exam.lastWrongIds : [],
      lastSummary: base.exam?.lastSummary || null
    }
  };
}

async function loadInitialProgress(file, data) {
  const raw = await fs.readFile(file, "utf8").catch(() => "");
  if (!raw.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`进度文件解析失败：${file}\n${error.message}`);
  }

  const sanitized = sanitizeProgress(parsed, data);
  if (!sanitized) return null;
  const stat = await fs.stat(file).catch(() => null);
  return {
    progress: sanitized.progress,
    metadata: {
      sourceFile: file,
      sourceMtime: stat ? stat.mtime.toISOString() : "",
      originalBankHash: String(parsed.bankHash || ""),
      savedAt: String(parsed.savedAt || parsed.exportedAt || ""),
      activeCourseId: sanitized.progress.activeCourseId,
      practiceCourses: Object.keys(sanitized.progress.practices || {}).length,
      questionProgress: Object.keys(sanitized.progress.questionProgress || {}).length,
      matchedQuestionProgress: sanitized.matchedQuestionProgress
    }
  };
}

function sanitizeProgress(progress, data) {
  if (!progress || typeof progress !== "object") return null;
  const courseIds = new Set(data.courses.map((course) => course.id));
  const questionIds = new Set(data.courses.flatMap((course) => (course.questions || []).map((question) => question.id)));
  const activeCourseId = courseIds.has(progress.activeCourseId) ? progress.activeCourseId : data.activeCourseId;
  const practices = {};

  for (const course of data.courses) {
    if (!progress.practices?.[course.id]) continue;
    const practice = normalizePractice(progress.practices[course.id]);
    practice.remainingIds = practice.remainingIds.filter((id) => questionIds.has(id));
    if (practice.currentQuestionId && !questionIds.has(practice.currentQuestionId)) {
      practice.currentQuestionId = null;
    }
    practice.exam.questionIds = practice.exam.questionIds.filter((id) => questionIds.has(id));
    practice.exam.lastWrongIds = practice.exam.lastWrongIds.filter((id) => questionIds.has(id));
    practice.exam.answers = practice.exam.answers.filter((answer) => questionIds.has(answer?.questionId));
    practices[course.id] = practice;
  }

  const questionProgress = {};
  let matchedQuestionProgress = 0;
  for (const [questionId, patch] of Object.entries(progress.questionProgress || {})) {
    if (!questionIds.has(questionId)) continue;
    matchedQuestionProgress += 1;
    questionProgress[questionId] = {
      wrongCount: Number(patch?.wrongCount) || 0,
      correctCount: Number(patch?.correctCount) || 0,
      bookmarked: Boolean(patch?.bookmarked),
      review: normalizeProgressReview(patch?.review)
    };
  }

  if (!Object.keys(practices).length && !matchedQuestionProgress) return null;
  return {
    matchedQuestionProgress,
    progress: {
      version: 1,
      bankHash: String(progress.bankHash || ""),
      savedAt: String(progress.savedAt || progress.exportedAt || new Date().toISOString()),
      activeCourseId,
      practices,
      questionProgress
    }
  };
}

function normalizeProgressReview(review = {}) {
  return {
    lastAnsweredAt: review?.lastAnsweredAt || "",
    lastWrongAt: review?.lastWrongAt || "",
    lastCorrectAt: review?.lastCorrectAt || "",
    consecutiveCorrect: Number(review?.consecutiveCorrect) || 0,
    masteredAt: review?.masteredAt || "",
    lastSelectedAnswers: Array.isArray(review?.lastSelectedAnswers)
      ? review.lastSelectedAnswers.map((item) => String(item))
      : []
  };
}

function validatePayload(data) {
  const errors = [];
  const ids = new Set();
  let total = 0;

  for (const course of data.courses) {
    if (!course.id) errors.push(`课程缺少 ID：${course.name || "(未命名)"}`);
    if (!course.name) errors.push(`课程缺少名称：${course.id}`);

    for (const question of course.questions || []) {
      total += 1;
      if (!question.id) errors.push(`${course.name} 中有题目缺少 ID`);
      if (ids.has(question.id)) errors.push(`重复题目 ID：${question.id}`);
      ids.add(question.id);

      if (!String(question.stem || "").trim()) errors.push(`题目缺少题干：${question.id}`);
      if (!Array.isArray(question.answer) || !question.answer.length) errors.push(`题目缺少答案：${question.id}`);

      if ((question.type || "choice") === "choice") {
        const options = Array.isArray(question.options) ? question.options : [];
        if (options.length < 2) errors.push(`选择题选项不足：${question.id}`);
        const optionTexts = new Set(options.map((option) => normalizeChoiceText(option.text)));
        for (const answer of question.answer || []) {
          const byKey = options.find((option) => String(option.key || "").trim().toUpperCase() === String(answer || "").trim().toUpperCase());
          const text = byKey ? byKey.text : answer;
          if (!optionTexts.has(normalizeChoiceText(text))) {
            errors.push(`答案不在选项内：${question.id} -> ${answer}`);
          }
        }
      }
    }
  }

  if (total !== data.metadata.totalQuestions) {
    errors.push(`题目数量不一致：metadata=${data.metadata.totalQuestions}, actual=${total}`);
  }

  return { errors };
}

function applyGeneratedStudyNotes(targetCourses) {
  const result = {
    scanned: 0,
    updated: 0,
    explanationAdded: 0,
    memoryTipAdded: 0
  };

  for (const course of targetCourses) {
    for (const question of course.questions || []) {
      result.scanned += 1;
      const notes = buildGeneratedStudyNotes(question, course.name);
      let changed = false;

      if (question.explanation !== notes.explanation) {
        question.explanation = notes.explanation;
        result.explanationAdded += 1;
        changed = true;
      }
      if (question.memoryTip !== notes.memoryTip) {
        question.memoryTip = notes.memoryTip;
        result.memoryTipAdded += 1;
        changed = true;
      }
      if (changed) result.updated += 1;
    }
  }

  return result;
}

function buildGeneratedStudyNotes(question, courseName = "") {
  const topic = identifyTopic(question, courseName);
  const answerText = answerLabel(question);
  const cue = extractCue(question.stem, courseName);
  const isFillBlank = question.type === "fill-blank";
  const isMulti = !isFillBlank && (question.answer || []).length > 1;
  const isJudge = !isFillBlank && isJudgeQuestion(question);

  let explanation;
  if (isFillBlank) {
    explanation = buildFillBlankAnalysis({ question, topic, answerText, cue });
  } else if (isJudge) {
    explanation = buildJudgeAnalysis({ question, topic, answerText, cue });
  } else if (isMulti) {
    explanation = buildMultiAnalysis({ question, topic, answerText, cue });
  } else {
    explanation = buildSingleAnalysis({ question, topic, answerText, cue });
  }

  return {
    explanation,
    memoryTip: buildMemoryTip({ question, topic, answerText, cue, isJudge, isMulti })
  };
}

function buildSingleAnalysis({ question, topic, answerText, cue }) {
  const correct = selectedOptions(question);
  const wrong = distractorOptions(question);
  const negative = isNegativeStem(question.stem);
  const correctText = formatOptionGroup(correct, topic.key) || answerText;
  const distractors = distractorExplanation(wrong, topic.key, negative, cue);

  const analysis = negative
    ? `题干用了否定限定，解题点是找不落在“${topic.scope}”内的选项；${correctText}与这个范围不一致，所以作为答案。`
    : `题干限定在“${cue}”，要核对主体、阶段和概念外延；${correctText}正好满足这个限定。`;

  return [
    `考点：${topic.name}。`,
    `分析：${analysis}`,
    `排除：${distractors}`
  ].join("");
}

function buildMultiAnalysis({ question, topic, answerText, cue }) {
  const wrong = distractorOptions(question);
  const correct = selectedOptions(question);
  const correctText = formatOptionGroup(correct, topic.key) || answerText;
  const wrongText = distractorExplanation(wrong, topic.key, false, cue);
  const fullSet = wrong.length === 0
    ? "本题各选项都属于题干要求的范围，难点不在排除，而在不要漏选。"
    : `正确项共同构成“${cue}”要求的答案组；未选项没有进入这一组，说明它与题干边界不一致。`;

  return [
    `考点：${topic.name}。`,
    `分析：多选题先定范围，再逐项核对是否都属于同一组知识点。${correctText}合起来才完整，不能只按熟悉程度挑一两个。${fullSet}`,
    `排除：${wrongText}`
  ].join("");
}

function buildJudgeAnalysis({ question, topic, answerText, cue }) {
  const isCorrect = normalizeChoiceText(answerText) === normalizeChoiceText("对");
  const special = specialJudgeInsight(question, answerText);
  const judgment = special || (isCorrect
    ? `题干把“${cue}”放在“${topic.scope}”中理解，主体、阶段和结论能够对应，按教材判断为“对”。`
    : `题干看似用了课程关键词，但主体、阶段、范围或规范表述有偏差，按教材判断为“错”。`);

  return [
    `考点：${topic.name}。`,
    `分析：判断题不能只看句子顺不顺，要核对主体、阶段、范围和教材固定表述。${judgment}`,
    `排除：不能只因为题干出现熟悉词就判对，也不能把相邻理论或相邻阶段的说法套到本题；关键看“${cue}”是否完整、准确。`
  ].join("");
}

function buildFillBlankAnalysis({ topic, answerText, cue }) {
  return [
    `考点：${topic.name}。`,
    `分析：填空题要看空格前后的限定语，“${cue}”指向“${topic.scope}”中的规范概念，答案应落在这个固定表述上。`,
    `排除：不要用同章相近概念替换；本题要填的是“${answerText}”，差一个主体或阶段都不算同一答案。`
  ].join("");
}

function buildMemoryTip({ question, topic, answerText, cue, isJudge, isMulti }) {
  const stem = String(question.stem || "");
  const answer = compactAnswer(answerText);

  if (/第二次历史性飞跃|第三次历史性飞跃/.test(stem)) {
    return "看到“第二次/第三次历史性飞跃”不要机械套号，先按教材固定表述核对是否这样定性。";
  }
  if (topic.key === "cst-theory") {
    return "中国特色社会主义理论体系按“邓、三、科、习”成组记；毛泽东思想另列，否定题看到“不包括”就选不在组内的项。";
  }
  if (topic.key === "latest-achievement") {
    return "最新理论成果锁定习近平新时代中国特色社会主义思想；毛、邓、三、科都是较早阶段或相邻理论成果。";
  }
  if (topic.key === "mao-stage" || /萌芽|初步形成|成熟|写入党章|活的灵魂|精髓|毛泽东思想/.test(stem + answerText)) {
    return "毛泽东思想发展线：萌芽看大革命，初步形成看土地革命，成熟看抗日战争，七大写入党章。";
  }
  if (topic.key === "new-democracy") {
    return "新民主主义抓三点：革命对象、动力和领导权；经济成分题按“国营、合作社、个体、私人资本、国家资本”成组记。";
  }
  if (topic.key === "socialist-transformation") {
    return "社会主义改造抓“农业、手工业、资本主义工商业”三条线，实质是生产资料私有制转为社会主义公有制。";
  }
  if (topic.key === "primary-stage") {
    return "初级阶段题先分清：最大实际是初级阶段，基本路线是一个中心两个基本点，基本纲领分经济、政治、文化等领域。";
  }
  if (topic.key === "deng") {
    return "邓小平理论抓改革开放、社会主义本质、初级阶段和中国特色社会主义理论体系开篇之作。";
  }
  if (topic.key === "three-represents") {
    return "三个代表抓“先进生产力、先进文化、最广大人民根本利益”，落脚点是人民群众支持拥护。";
  }
  if (topic.key === "scientific-outlook") {
    return "科学发展观抓第一要义发展、核心以人为本、基本要求全面协调可持续、根本方法统筹兼顾。";
  }
  if (isJudge) {
    return `判断题先查主体、阶段、范围和表述完整性；本题围绕“${cue}”，结论记为“${answerText}”。`;
  }
  if (isMulti) {
    return `多选按组记：“${answer}”；先确定题干范围，再排除相邻阶段、相邻理论或相邻概念。`;
  }
  return `抓限定词“${cue}”，先定范围再定位答案“${answer}”；干扰项多是同章相邻概念、阶段错位或范围不合。`;
}

function answerLabel(question) {
  if (question.type === "fill-blank") {
    return (question.answer || []).map((item) => String(item).trim()).filter(Boolean).join("、") || "正确答案";
  }
  return getChoiceAnswerTextsForBuild(question).join("、") || "正确答案";
}

function getChoiceAnswerTextsForBuild(question, answers = question?.answer || []) {
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

function selectedOptions(question) {
  const answerTexts = getChoiceAnswerTextsForBuild(question);
  return (question.options || []).filter((option) => answerTexts.some((answer) => normalizeChoiceText(answer) === normalizeChoiceText(option.text)));
}

function distractorOptions(question) {
  const answerTexts = getChoiceAnswerTextsForBuild(question);
  return (question.options || []).filter((option) => !answerTexts.some((answer) => normalizeChoiceText(answer) === normalizeChoiceText(option.text)));
}

function identifyTopic(question, courseName = "") {
  const correctAnswer = answerLabel(question);
  const text = [
    courseName,
    question.stem,
    correctAnswer
  ].join("\n");

  const definitions = [
    [/中国特色社会主义理论体系/u, "中国特色社会主义理论体系的构成", "邓小平理论、“三个代表”重要思想、科学发展观、习近平新时代中国特色社会主义思想这一组理论成果", "cst-theory"],
    [/最新理论成果|最新成果|习近平新时代中国特色社会主义思想/u, "马克思主义中国化时代化最新成果", "马克思主义中国化时代化理论成果谱系中的最新成果", "latest-achievement"],
    [/马克思主义中国化时代化|第一次历史性飞跃|新的飞跃/u, "马克思主义中国化时代化的理论成果谱系", "马克思主义中国化时代化不同阶段的理论成果和规范表述", "sinicization-achievement"],
    [/萌芽|初步形成|成熟|抗日战争时期|土地革命战争时期|国民革命战争时期|解放战争时期/u, "毛泽东思想形成发展的阶段", "毛泽东思想萌芽、初步形成、成熟和继续发展的历史阶段", "mao-stage"],
    [/毛泽东思想|活的灵魂|实事求是|七大|农村包围城市|武装夺取政权/u, "毛泽东思想形成发展与历史地位", "毛泽东思想的形成阶段、主要内容、活的灵魂和历史地位", "mao-thought"],
    [/新民主主义/u, "新民主主义革命和新民主主义社会", "新民主主义革命总路线、经济纲领、社会性质和过渡条件", "new-democracy"],
    [/社会主义改造|三大改造|过渡时期|赎买|和平改造|农业合作化|手工业合作化/u, "社会主义改造理论", "从新民主主义到社会主义过渡时期的改造对象、道路和经验", "socialist-transformation"],
    [/社会主义建设|十大关系|正确处理人民内部矛盾|商品生产|价值规律/u, "社会主义建设道路初步探索", "党对社会主义建设规律、矛盾处理和经济建设道路的探索", "socialist-construction"],
    [/社会主义初级阶段|基本路线|基本纲领|一个中心|两个基本点|主要矛盾/u, "社会主义初级阶段理论", "社会主义初级阶段的基本国情、主要矛盾、基本路线和基本纲领", "primary-stage"],
    [/邓小平理论|社会主义本质|改革开放|南方谈话|解放思想/u, "邓小平理论", "改革开放和社会主义现代化建设中的基本问题、路线和理论成果", "deng"],
    [/三个代表|立党之本|执政之基|力量之源|先进生产力|先进文化|根本利益/u, "“三个代表”重要思想", "党的建设、执政基础和中国特色社会主义事业推进中的根本要求", "three-represents"],
    [/科学发展观|以人为本|全面协调可持续|统筹兼顾|第一要义/u, "科学发展观", "新世纪新阶段关于发展目的、发展要求和发展方法的理论", "scientific-outlook"],
    [/党章|会议|七大|十一届三中全会|十四大|十五大|十六大|十七大|十八大|遵义会议|瓦窑堡/u, "重要会议与历史节点", "党的重要会议、理论确立和历史转折之间的对应关系", "meeting"],
    [/群众路线|人民群众|人民|根本工作路线|执政基础/u, "群众路线和人民立场", "人民群众的历史主体地位、群众路线和党的执政基础", "people-line"],
    [/思想路线|实事求是|解放思想|与时俱进|求真务实/u, "党的思想路线", "实事求是、解放思想、与时俱进、求真务实之间的内在关系", "ideological-line"]
  ];

  for (const [pattern, name, scope, key] of definitions) {
    if (pattern.test(text)) return { name, scope, key };
  }

  return {
    name: "毛概核心概念辨析",
    scope: "毛泽东思想和中国特色社会主义理论体系概论中的基本概念、阶段和理论关系",
    key: "general"
  };
}

function formatOptionGroup(options, topicKey) {
  return (options || [])
    .map((option) => {
      const reason = optionReason(option.text, topicKey);
      return `${option.key}.${option.text}${reason ? `（${reason}）` : ""}`;
    })
    .join("、");
}

function distractorExplanation(options, topicKey, negative, cue) {
  if (!options.length) {
    return "没有未选项；本题考的是整组知识点，漏选任何一个正确项都会使范围不完整。";
  }
  const grouped = formatOptionGroup(options.slice(0, 6), topicKey);
  if (negative) {
    return `${grouped}这些未选项与题干限定范围相合，不能当作“不包括/不属于”的答案。`;
  }
  return `${grouped}虽是相关知识点，但没有满足“${cue}”这一限定，常见错因是只看关键词相近而忽略阶段、主体或外延。`;
}

function optionReason(text = "", topicKey = "general") {
  const value = String(text || "");
  if (topicKey === "cst-theory") {
    if (/毛泽东思想/u.test(value)) return "不纳入中国特色社会主义理论体系，属于毛泽东思想范畴";
    if (/邓小平理论|三个代表|科学发展观|习近平新时代中国特色社会主义思想/u.test(value)) return "属于中国特色社会主义理论体系";
  }
  if (topicKey === "latest-achievement") {
    if (/习近平新时代中国特色社会主义思想/u.test(value)) return "是马克思主义中国化时代化最新理论成果";
    if (/毛泽东思想|邓小平理论|三个代表|科学发展观/u.test(value)) return "是较早阶段或相邻理论成果，不是“最新”";
  }
  if (topicKey === "mao-stage") {
    if (/国民革命战争时期|大革命时期/u.test(value)) return "对应毛泽东思想萌芽阶段";
    if (/土地革命战争时期/u.test(value)) return "对应毛泽东思想初步形成阶段";
    if (/抗日战争时期/u.test(value)) return "对应毛泽东思想趋于成熟阶段";
    if (/解放战争时期/u.test(value)) return "对应毛泽东思想继续发展阶段";
  }

  const generalNotes = [
    [/毛泽东思想/u, "毛泽东思想范畴"],
    [/邓小平理论/u, "邓小平理论范畴"],
    [/三个代表/u, "“三个代表”重要思想范畴"],
    [/科学发展观/u, "科学发展观范畴"],
    [/习近平新时代中国特色社会主义思想/u, "习近平新时代中国特色社会主义思想范畴"],
    [/马克思列宁主义/u, "马克思主义理论源头"],
    [/党的七大|中共七大/u, "毛泽东思想写入党章的重要节点"],
    [/遵义会议/u, "党的历史转折相关会议"],
    [/人民群众|人民的支持和拥护/u, "群众基础和人民立场相关表述"],
    [/实事求是/u, "党的思想路线核心表述"],
    [/新民主主义/u, "新民主主义革命或社会相关概念"],
    [/社会主义改造|三大改造/u, "社会主义改造相关概念"],
    [/社会主义初级阶段/u, "社会主义初级阶段相关概念"],
    [/一个中心|两个基本点/u, "社会主义初级阶段基本路线相关表述"]
  ];

  for (const [pattern, reason] of generalNotes) {
    if (pattern.test(value)) return reason;
  }
  return "";
}

function specialJudgeInsight(question, answerText) {
  const stem = String(question.stem || "");
  const isWrong = normalizeChoiceText(answerText) === normalizeChoiceText("错");
  if (/中国特色社会主义理论体系是马克思主义中国化时代化的第二次历史性飞跃/u.test(stem) && isWrong) {
    return "本题错在“第二次历史性飞跃”的机械编号。题库采用的规范表述是把中国特色社会主义理论体系和新时代思想放在马克思主义中国化时代化持续发展的脉络中理解，不能简单写成第二次、第三次。";
  }
  if (/毛泽东思想是马克思主义中国化第一次历史性飞跃的理论成果/u.test(stem) && isWrong) {
    return "本题错在表述不完整。题库要求的完整说法是“马克思主义中国化时代化第一次历史性飞跃”，少了“时代化”就不是本题认可的规范表述。";
  }
  if (/毛泽东思想是中国特色社会主义理论体系的重要组成部分/u.test(stem) && isWrong) {
    return "本题错在把两个理论范畴混在一起。毛泽东思想另列为马克思主义中国化时代化的重要成果，不属于中国特色社会主义理论体系的组成部分。";
  }
  return "";
}

function isNegativeStem(stem = "") {
  return /不包括|不属于|不正确|错误|不符合|不是|不体现/u.test(String(stem || ""));
}

function extractCue(stem = "", fallback = "") {
  const text = String(stem || "")
    .replace(/\s+/g, "")
    .replace(/[（(]\s*[）)]/g, "（ ）")
    .replace(/_+/g, "（ ）")
    .trim();
  if (!text) return fallback || "本题";

  const blankIndex = text.indexOf("（ ）");
  if (blankIndex >= 0) {
    const beforeFull = cleanCue(text.slice(0, blankIndex));
    const before = beforeFull.length <= 32 ? beforeFull : cleanCue(text.slice(Math.max(0, blankIndex - 24), blankIndex));
    const after = cleanCue(text.slice(blankIndex + 3, Math.min(text.length, blankIndex + 24)));
    if (after.length >= 5) return after;
    if (before.length >= 5) return before;
  }

  const keyword = text.match(/马克思主义中国化时代化|毛泽东思想|中国特色社会主义理论体系|新民主主义革命|社会主义改造|社会主义建设|邓小平理论|三个代表|科学发展观|党的思想路线|群众路线|实事求是|主要矛盾|基本路线/u);
  if (keyword) {
    const start = Math.max(0, keyword.index - 8);
    const end = Math.min(text.length, keyword.index + keyword[0].length + 14);
    return cleanCue(text.slice(start, end)) || keyword[0];
  }

  const firstClause = cleanCue(text.split(/[。！？；;,.，：:]/u).find(Boolean) || "");
  if (firstClause && firstClause.length <= 42) return firstClause;
  if (firstClause) return `${firstClause.slice(0, 38)}…`;
  return cleanCue(text.slice(0, 38)) || fallback || "本题";
}

function cleanCue(value) {
  return String(value || "")
    .replace(/^[，。！？；、：:（）()]+|[，。！？；、：:（）()]+$/gu, "")
    .trim();
}

function compactAnswer(value) {
  return String(value || "")
    .split("、")
    .map((item) => item.trim())
    .filter(Boolean)
    .join("+");
}

function isJudgeQuestion(question) {
  const optionTexts = (question.options || [])
    .map((option) => String(option.text || "").trim().replace(/\s+/g, ""))
    .filter(Boolean);
  if (optionTexts.length !== 2) return false;
  const positive = new Set(["正确", "对", "是", "√"]);
  const negative = new Set(["错误", "错", "否", "×", "不正确"]);
  return optionTexts.some((item) => positive.has(item)) && optionTexts.some((item) => negative.has(item));
}

function courseCore(course) {
  return {
    id: course.id,
    name: course.name,
    questions: (course.questions || []).map(questionCore)
  };
}

function questionCore(question) {
  return {
    id: question.id,
    type: question.type,
    stem: question.stem,
    options: question.options,
    answer: question.answer
  };
}

async function verifyOutput(file, expectedPayload) {
  const html = await fs.readFile(file, "utf8");
  const match = html.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("生成文件中没有找到题库 JSON。");
  const embedded = JSON.parse(match[1]);

  const expectedQuestions = JSON.stringify(expectedPayload.courses.map(({ id, name, questions }) => ({ id, name, questions })));
  const embeddedQuestions = JSON.stringify(embedded.courses.map(({ id, name, questions }) => ({ id, name, questions })));
  if (embeddedQuestions !== expectedQuestions) {
    throw new Error("生成文件中的题目数据与源数据不一致。");
  }

  const expectedHash = sha256(expectedQuestions);
  const embeddedHash = sha256(embeddedQuestions);
  if (embeddedHash !== expectedHash || embedded.metadata.questionBankSha256 !== expectedPayload.metadata.questionBankSha256) {
    throw new Error("生成文件中的题库哈希校验失败。");
  }

  const validation = validatePayload(embedded);
  if (validation.errors.length) {
    throw new Error(`生成文件回读校验失败：\n${validation.errors.join("\n")}`);
  }

  return "题干、选项、答案与源题库逐题一致；解析和速记已生成";
}

function renderHtml(data) {
  const safeData = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#a33b28">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>毛概题库离线刷题</title>
  <style>${styleSheet()}</style>
</head>
<body>
  <main class="app">
    <header class="hero">
      <div>
        <p class="eyebrow">Mao Gai Quiz · Offline</p>
        <h1>毛概题库离线刷题</h1>
        <p>单文件 HTML，可直接在手机浏览器打开；题库内嵌只读，答题进度保存在当前浏览器。</p>
      </div>
      <div class="metric">
        <strong id="questionCount">0</strong>
        <span>当前章节题数</span>
      </div>
    </header>

    <section class="toolbar">
      <select id="courseSelect" aria-label="选择章节"></select>
      <div id="courseMeta" class="toolbar-meta"></div>
      <button id="exportProgressBtn" class="ghost" type="button">导出进度</button>
      <button id="importProgressBtn" class="ghost" type="button">导入进度</button>
      <input id="progressFileInput" type="file" accept="application/json" hidden>
    </section>

    <nav class="tabs" aria-label="页面">
      <button class="active" data-tab="practicePanel" type="button">刷题</button>
      <button data-tab="reviewPanel" type="button">复习</button>
      <button data-tab="bankPanel" type="button">题库</button>
      <button data-tab="dataPanel" type="button">数据</button>
    </nav>

    <section id="practicePanel" class="panel active">
      <div class="practice-head">
        <h2>随机刷题</h2>
        <button id="resetRoundBtn" class="ghost" type="button">重置本轮</button>
      </div>
      <div class="practice-mode-bar">
        <span class="practice-mode-label">模式</span>
        <label><input type="radio" name="practiceMode" value="all"> 全部题目</label>
        <label><input type="radio" name="practiceMode" value="count"> 指定数量</label>
        <label><input type="radio" name="practiceMode" value="wrong"> 错题重做</label>
        <label><input type="radio" name="practiceMode" value="exam"> 限时模拟</label>
        <input id="practiceCountInput" class="number-input" type="number" min="1" value="10">
        <span id="practiceCountHint" class="hint">题</span>
        <span id="examTimeControls" class="exam-time-controls">
          <input id="examMinutesInput" class="number-input" type="number" min="1" value="20">
          <span class="hint">分钟</span>
        </span>
      </div>
      <p id="roundInfo" class="round-info"></p>
      <div id="roundBoundary" class="round-boundary"></div>
      <div id="accuracy" class="accuracy"></div>
      <div class="feedback-settings">
        <label><input id="showAnswerToggle" type="checkbox"> 答后显示答案</label>
        <label><input id="showExplanationToggle" type="checkbox"> 答后显示解析</label>
        <label><input id="autoNextToggle" type="checkbox"> 答对自动下一题</label>
        <label><input id="shuffleOptionsToggle" type="checkbox"> 选项乱序</label>
      </div>
      <article id="quizCard" class="quiz-card"></article>
      <div class="sticky-actions">
        <button id="submitBtn" type="button">提交答案</button>
        <button id="prevBtn" class="ghost" type="button">上一题</button>
        <button id="nextBtn" type="button">下一题</button>
        <button id="finishExamBtn" class="ghost" type="button">结束模拟</button>
      </div>
    </section>

    <section id="reviewPanel" class="panel">
      <div class="review-head">
        <h2>复习分析</h2>
        <div class="review-actions">
          <button data-review-action="practice-wrong" type="button">开始错题重做</button>
          <button class="ghost" data-review-action="open-wrong-bank" type="button">打开错题列表</button>
        </div>
      </div>
      <div id="reviewInsights" class="review-insights"></div>
    </section>

    <section id="bankPanel" class="panel">
      <h2>题库浏览</h2>
      <div id="bankToolbar" class="bank-toolbar"></div>
      <div id="bankList" class="bank-list"></div>
    </section>

    <section id="dataPanel" class="panel">
      <h2>迁移校验</h2>
      <div id="dataSummary" class="data-summary"></div>
    </section>
  </main>

  <script type="application/json" id="quiz-data">${safeData}</script>
  <script>(${clientApp.toString()})();</script>
</body>
</html>
`;
}

function styleSheet() {
  return `
:root {
  --ink: #221815;
  --muted: #71625c;
  --paper: #f7f1e8;
  --surface: #fffaf4;
  --line: #dfd0c0;
  --line-soft: #ebdfd2;
  --accent: #a33b28;
  --accent-strong: #842f21;
  --accent-soft: rgba(163, 59, 40, 0.09);
  --danger: #a62e3b;
  --danger-soft: #fde8e6;
  --success: #2f7a46;
  --success-soft: #e2f2e7;
  --gold: #b88622;
  --gold-soft: rgba(184, 134, 34, 0.14);
  --shadow: 0 12px 30px rgba(34, 24, 21, 0.08);
  --radius: 12px;
  --radius-sm: 8px;
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
button {
  border: 0;
  border-radius: var(--radius-sm);
  padding: 9px 14px;
  color: #fff;
  background: var(--accent);
  font-weight: 700;
  cursor: pointer;
}
button:disabled { cursor: not-allowed; opacity: 0.55; }
button.ghost {
  color: var(--ink);
  border: 1px solid var(--line);
  background: transparent;
}
.app {
  width: min(940px, calc(100% - 28px));
  margin: 0 auto;
  padding: 28px 0 44px;
}
.hero {
  display: grid;
  grid-template-columns: 1fr 150px;
  gap: 18px;
  align-items: end;
  margin-bottom: 18px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.hero h1 {
  margin: 0 0 6px;
  font-size: 34px;
  line-height: 1.18;
}
.hero p:last-child { margin: 0; color: var(--muted); }
.metric {
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: center;
  box-shadow: var(--shadow);
}
.metric strong {
  display: block;
  color: var(--accent);
  font-size: 40px;
  line-height: 1;
}
.metric span { color: var(--muted); font-size: 12px; }
.toolbar {
  display: grid;
  grid-template-columns: 230px 1fr auto auto;
  gap: 8px;
  align-items: center;
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
select, input[type="text"], input[type="search"], input[type="number"] {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
  background: #fff;
}
.toolbar-meta, .hint, .round-info, .status { color: var(--muted); font-size: 13px; }
.tabs {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  margin-bottom: 14px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #efe3d6;
}
.tabs button {
  color: var(--muted);
  background: transparent;
  box-shadow: none;
}
.tabs button.active { color: #fff; background: var(--accent); }
.panel {
  display: none;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow);
}
.panel.active { display: block; }
.panel h2 { margin: 0 0 14px; font-size: 19px; }
.practice-head, .review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.practice-mode-bar, .feedback-settings, .bank-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin: 10px 0 12px;
  padding: 10px;
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-sm);
  background: var(--paper);
  font-size: 13px;
}
.practice-mode-bar label, .feedback-settings label {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.practice-mode-label { color: var(--muted); font-weight: 800; }
.number-input { max-width: 72px; text-align: center; }
.exam-time-controls { display: inline-flex; gap: 6px; align-items: center; }
.round-boundary, .accuracy > div, .quiz-card, .bank-item, .review-metric, .review-item, .data-block {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper);
}
.round-boundary {
  margin: 10px 0;
  padding: 10px 12px;
  font-size: 13px;
}
.round-boundary span { color: var(--muted); margin-left: 8px; }
.round-boundary.is-active { border-color: rgba(163, 59, 40, 0.28); background: var(--accent-soft); }
.round-boundary.is-complete { border-color: rgba(47, 122, 70, 0.28); background: var(--success-soft); }
.accuracy {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
  margin: 12px 0;
}
.accuracy > div { padding: 12px; }
.accuracy strong {
  display: block;
  color: var(--accent);
  font-size: 26px;
  line-height: 1.1;
}
.accuracy span { color: var(--muted); font-size: 12px; }
#examTimer.is-danger { color: var(--danger); }
.quiz-card { min-height: 120px; padding: 18px; }
.quiz-card-header {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line-soft);
}
.quiz-card h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.75;
}
.bookmark-btn {
  width: 34px;
  height: 34px;
  padding: 0;
  color: var(--muted);
  border: 1px solid var(--line);
  background: #fff;
}
.bookmark-btn.active { color: var(--gold); border-color: var(--gold); background: var(--gold-soft); }
.option-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}
.option {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 11px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
}
.option input { margin-top: 4px; accent-color: var(--accent); }
.option b { color: var(--accent); }
.option.is-correct { border-color: var(--success); background: var(--success-soft); }
.option.is-wrong { border-color: var(--danger); background: var(--danger-soft); }
.multi-hint, .wrong-count-tag, .stats-tag {
  display: inline-block;
  margin-left: 5px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  vertical-align: middle;
}
.multi-hint, .stats-tag { color: var(--accent); background: var(--accent-soft); }
.wrong-count-tag, .stats-tag.is-pending { color: var(--danger); background: var(--danger-soft); }
.stats-tag.is-mastered { color: var(--success); background: var(--success-soft); }
#answerResult:not(:empty) {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line-soft);
}
.correct, .wrong {
  padding: 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  line-height: 1.8;
}
.correct { border: 1px solid rgba(47,122,70,.22); background: var(--success-soft); }
.correct strong { color: var(--success); }
.wrong { border: 1px solid rgba(166,46,59,.18); background: var(--danger-soft); }
.wrong strong { color: var(--danger); }
.fill-blank-area { display: grid; gap: 8px; margin-top: 12px; }
.fill-blank-input { border: 1px solid var(--line); border-bottom: 2px solid var(--accent); border-radius: var(--radius-sm); padding: 10px 12px; }
.sticky-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
  background: var(--surface);
  z-index: 5;
}
.empty, .round-state, .exam-empty-state { color: var(--muted); text-align: center; padding: 22px 12px; }
.round-state strong, .exam-summary h3 { color: var(--ink); font-size: 17px; }
.exam-summary-grid, .review-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
.exam-summary-grid div, .review-metric { padding: 12px; }
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.review-insights { display: grid; gap: 14px; }
.review-metric strong { display: block; color: var(--accent); font-size: 25px; line-height: 1.1; }
.review-metric span { color: var(--muted); font-size: 12px; }
.review-section { display: grid; gap: 8px; }
.review-section h3 { margin: 0; font-size: 15px; }
.review-item { padding: 12px; }
.review-item h4 { margin: 0 0 5px; font-size: 14px; line-height: 1.6; }
.review-item p, .bank-item p, .data-block p { margin: 3px 0; color: var(--muted); font-size: 12px; }
.bank-toolbar input { flex: 1; min-width: 170px; }
.bank-list { display: grid; gap: 8px; }
.bank-item { display: grid; grid-template-columns: 1fr auto; gap: 12px; padding: 13px; }
.bank-item h3 { margin: 0 0 5px; font-size: 14px; line-height: 1.6; }
.bank-options { display: grid; gap: 2px; margin: 6px 0; }
.bank-actions { display: flex; flex-direction: column; gap: 6px; }
.bank-actions button { padding: 6px 10px; font-size: 12px; }
.active-filter { color: #fff !important; border-color: var(--accent) !important; background: var(--accent) !important; }
.data-summary { display: grid; gap: 10px; }
.data-block { padding: 13px; overflow-wrap: anywhere; }
.course-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.course-pill { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: #fff; font-size: 13px; }
.ok { color: var(--success); font-weight: 800; }
.danger { color: var(--danger); font-weight: 800; }
@media (hover: hover) {
  button:hover { background: var(--accent-strong); }
  button.ghost:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .option:hover { border-color: var(--accent); background: var(--accent-soft); }
}
@media (max-width: 760px) {
  .app { width: calc(100% - 18px); padding: 18px 0 32px; }
  .hero { grid-template-columns: 1fr; }
  .hero h1 { font-size: 25px; }
  .metric { display: flex; gap: 12px; align-items: center; justify-content: center; }
  .metric strong { font-size: 34px; }
  .toolbar { grid-template-columns: 1fr; }
  .panel { padding: 15px; }
  .quiz-card { padding: 14px; }
  .tabs button { padding: 8px 6px; }
  .exam-summary-grid, .review-summary-grid, .course-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .bank-item { grid-template-columns: 1fr; }
  .bank-actions { flex-direction: row; }
  .bank-actions button { flex: 1; }
}
@media (max-width: 430px) {
  .panel h2 { font-size: 17px; }
  .quiz-card h3 { font-size: 14px; }
  .quiz-card-header { flex-direction: column-reverse; }
  .bookmark-btn { align-self: flex-end; }
  .exam-summary-grid, .review-summary-grid, .course-grid { grid-template-columns: 1fr; }
}
`;
}

function clientApp() {
  "use strict";

  const STORAGE_KEY = "maogai-quiz-html-progress-maogai-only-v1";
  const SETTINGS_KEY = "maogai-quiz-html-settings-v1";
  const BANK_RENDER_LIMIT = 120;
  const EXAM_MODES = new Set(["exam", "exam-wrong"]);
  const embedded = JSON.parse(document.getElementById("quiz-data").textContent);
  const baseState = {
    activeCourseId: embedded.activeCourseId,
    courses: embedded.courses
  };
  const baseQuestionById = new Map();
  for (const course of baseState.courses) {
    for (const question of course.questions || []) baseQuestionById.set(question.id, question);
  }
  const embeddedProgressSignature = buildEmbeddedProgressSignature();
  let activeProgressSignature = "";

  const settings = loadSettings();
  const runtime = {
    state: hydrateState(),
    selectedAnswers: [],
    answerFeedback: null,
    submittedQuestionId: "",
    practiceMode: settings.practiceMode || "all",
    practiceCount: settings.practiceCount || 10,
    examCount: settings.examCount || 30,
    examTimeLimitMinutes: settings.examTimeLimitMinutes || 20,
    examTimerId: null,
    finishingExam: false,
    questionHistory: [],
    bankSearch: "",
    bankShowWrongOnly: false,
    bankShowBookmarkedOnly: false
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeChoiceText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]/gu, "")
      .toLowerCase();
  }

  function getChoiceAnswerTexts(question, answers = question?.answer || []) {
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

  function hasChoiceAnswer(question, value, answers = question?.answer || []) {
    const key = normalizeChoiceText(value);
    return getChoiceAnswerTexts(question, answers).some((answer) => normalizeChoiceText(answer) === key);
  }

  function isChoiceAnswerCorrect(question, selectedAnswers) {
    const selected = getChoiceAnswerTexts(question, selectedAnswers).map(normalizeChoiceText).sort();
    const correct = getChoiceAnswerTexts(question).map(normalizeChoiceText).sort();
    return selected.length === correct.length && selected.every((item, index) => item === correct[index]);
  }

  function loadSettings() {
    const saved = readJson(SETTINGS_KEY, {});
    return {
      showAnswer: saved.showAnswer !== false,
      showExplanation: saved.showExplanation !== false,
      autoNext: saved.autoNext === true,
      shuffleOptions: saved.shuffleOptions === true,
      practiceMode: saved.practiceMode || "all",
      practiceCount: Number(saved.practiceCount) || 10,
      examCount: Number(saved.examCount) || 30,
      examTimeLimitMinutes: Number(saved.examTimeLimitMinutes) || 20
    };
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      showAnswer: settings.showAnswer,
      showExplanation: settings.showExplanation,
      autoNext: settings.autoNext,
      shuffleOptions: settings.shuffleOptions,
      practiceMode: runtime.practiceMode,
      practiceCount: runtime.practiceCount,
      examCount: runtime.examCount,
      examTimeLimitMinutes: runtime.examTimeLimitMinutes
    }));
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function hydrateState() {
    const saved = selectProgressForHydration();
    const state = clone(baseState);
    if (saved.activeCourseId && state.courses.some((course) => course.id === saved.activeCourseId)) {
      state.activeCourseId = saved.activeCourseId;
    }

    const progress = saved.questionProgress || {};
    for (const course of state.courses) {
      if (saved.practices?.[course.id]) {
        course.practice = normalizePractice(saved.practices[course.id]);
      } else {
        course.practice = normalizePractice(course.practice);
      }
      for (const question of course.questions || []) {
        const patch = progress[question.id];
        if (!patch) continue;
        question.wrongCount = Number(patch.wrongCount) || 0;
        question.correctCount = Number(patch.correctCount) || 0;
        question.bookmarked = Boolean(patch.bookmarked);
        question.review = normalizeReviewState(patch.review);
      }
    }
    return state;
  }

  function selectProgressForHydration() {
    const local = readJson(STORAGE_KEY, null);
    const hasEmbedded = embeddedProgressSignature && hasProgressData(embedded.initialProgress);
    if (local && typeof local === "object") {
      if (hasProgressData(local) && !isCompatibleProgressHash(local.bankHash)) {
        activeProgressSignature = hasEmbedded ? embeddedProgressSignature : "";
        return hasEmbedded ? withProgressSignature(embedded.initialProgress) : {};
      }
      if (hasEmbedded && local.embeddedProgressSignature !== embeddedProgressSignature) {
        activeProgressSignature = embeddedProgressSignature;
        return withProgressSignature(embedded.initialProgress);
      }
      activeProgressSignature = local.embeddedProgressSignature || "";
      return local;
    }
    activeProgressSignature = hasEmbedded ? embeddedProgressSignature : "";
    return hasEmbedded ? withProgressSignature(embedded.initialProgress) : {};
  }

  function hasProgressData(progress) {
    return Boolean(progress && typeof progress === "object" && (
      Object.keys(progress.practices || {}).length
      || Object.keys(progress.questionProgress || {}).length
    ));
  }

  function buildEmbeddedProgressSignature() {
    const meta = embedded.metadata.initialProgress;
    if (!meta || !embedded.initialProgress) return "";
    return [
      meta.sourceMtime || "",
      meta.originalBankHash || "",
      meta.savedAt || "",
      meta.questionProgress || 0,
      meta.matchedQuestionProgress || 0
    ].join("|");
  }

  function withProgressSignature(progress) {
    return {
      ...clone(progress),
      embeddedProgressSignature
    };
  }

  function isCompatibleProgressHash(hash) {
    if (!hash) return true;
    const allowed = new Set([
      embedded.metadata.questionBankSha256,
      ...(embedded.metadata.compatibleProgressHashes || [])
    ].filter(Boolean));
    return allowed.has(hash);
  }

  function persistState() {
    const practices = {};
    const questionProgress = {};
    for (const course of runtime.state.courses) {
      practices[course.id] = normalizePractice(course.practice);
      for (const question of course.questions || []) {
        const base = baseQuestionById.get(question.id) || {};
        const review = normalizeReviewState(question.review);
        const baseReview = normalizeReviewState(base.review);
        const changed = (Number(question.wrongCount) || 0) !== (Number(base.wrongCount) || 0)
          || (Number(question.correctCount) || 0) !== (Number(base.correctCount) || 0)
          || Boolean(question.bookmarked) !== Boolean(base.bookmarked)
          || JSON.stringify(review) !== JSON.stringify(baseReview);
        if (changed) {
          questionProgress[question.id] = {
            wrongCount: Number(question.wrongCount) || 0,
            correctCount: Number(question.correctCount) || 0,
            bookmarked: Boolean(question.bookmarked),
            review
          };
        }
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      bankHash: embedded.metadata.questionBankSha256,
      savedAt: new Date().toISOString(),
      activeCourseId: runtime.state.activeCourseId,
      practices,
      questionProgress,
      embeddedProgressSignature: activeProgressSignature || ""
    }));
  }

  function normalizeReviewState(review = {}) {
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

  function normalizePractice(practice = {}) {
    return {
      roundNo: Number(practice.roundNo) || 1,
      remainingIds: Array.isArray(practice.remainingIds) ? practice.remainingIds : [],
      answeredInRound: Number(practice.answeredInRound) || 0,
      correctInRound: Number(practice.correctInRound) || 0,
      totalAnswered: Number(practice.totalAnswered) || 0,
      totalCorrect: Number(practice.totalCorrect) || 0,
      currentQuestionId: practice.currentQuestionId || null,
      lastAnswer: practice.lastAnswer || null,
      mode: practice.mode || "all",
      count: Number(practice.count) || 0,
      exam: {
        timeLimitMinutes: Number(practice.exam?.timeLimitMinutes) || 20,
        startedAt: practice.exam?.startedAt || "",
        finishedAt: practice.exam?.finishedAt || "",
        questionIds: Array.isArray(practice.exam?.questionIds) ? practice.exam.questionIds : [],
        answers: Array.isArray(practice.exam?.answers) ? practice.exam.answers : [],
        lastWrongIds: Array.isArray(practice.exam?.lastWrongIds) ? practice.exam.lastWrongIds : [],
        lastSummary: practice.exam?.lastSummary || null
      }
    };
  }

  function activeCourse() {
    return runtime.state.courses.find((course) => course.id === runtime.state.activeCourseId) || runtime.state.courses[0];
  }

  function currentQuestion() {
    const course = activeCourse();
    return course.questions.find((question) => question.id === course.practice.currentQuestionId);
  }

  function clearCurrentAnswer() {
    runtime.selectedAnswers = [];
    runtime.submittedQuestionId = "";
    runtime.answerFeedback = null;
  }

  function rate(correct, total) {
    return total ? `${Math.round((correct / total) * 100)}%` : "0%";
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function isExamMode(mode = runtime.practiceMode) {
    return EXAM_MODES.has(mode);
  }

  function activePracticeCount() {
    return runtime.practiceMode === "exam" ? runtime.examCount : runtime.practiceCount;
  }

  function roundQuestionTotal(practice = {}, fallbackTotal = 0) {
    const answered = Number(practice.answeredInRound) || 0;
    const remaining = Array.isArray(practice.remainingIds) ? practice.remainingIds.length : 0;
    const currentSubmitted = practice.lastAnswer?.questionId && practice.lastAnswer.questionId === practice.currentQuestionId;
    const current = practice.currentQuestionId && !currentSubmitted ? 1 : 0;
    const derived = answered + remaining + current;
    if (derived > 0) return derived;
    return Math.max(0, Number(practice.count) || Number(fallbackTotal) || 0);
  }

  function examQuestionTotal(practice = {}, fallbackTotal = 0) {
    const examIds = practice.exam?.questionIds;
    if (Array.isArray(examIds) && examIds.length) return examIds.length;
    return roundQuestionTotal(practice, fallbackTotal);
  }

  function roundAnsweredCount(practice = {}, fallbackTotal = 0) {
    return Math.min(roundQuestionTotal(practice, fallbackTotal), Number(practice.answeredInRound) || 0);
  }

  function roundRemainingCount(practice = {}, fallbackTotal = 0) {
    const total = roundQuestionTotal(practice, fallbackTotal);
    const answered = Math.min(total, Number(practice.answeredInRound) || 0);
    return Math.max(0, total - answered);
  }

  function hasNextQuestionInRound(practice = {}) {
    return Array.isArray(practice.remainingIds) && practice.remainingIds.length > 0;
  }

  function isPracticeRoundComplete(practice = {}, fallbackTotal = 0) {
    const total = roundQuestionTotal(practice, fallbackTotal);
    if (total <= 0) return false;
    return roundAnsweredCount(practice, fallbackTotal) >= total && !hasNextQuestionInRound(practice);
  }

  function isPracticeRoundStarted(practice = {}) {
    return Boolean(practice.currentQuestionId) || (Number(practice.answeredInRound) || 0) > 0;
  }

  function applyPracticeConfig(course, input) {
    const practice = course.practice;
    practice.mode = input.mode;
    if ((input.mode === "count" || input.mode === "exam") && input.count > 0) practice.count = input.count;
    if (isExamMode(input.mode)) practice.exam.timeLimitMinutes = input.timeLimitMinutes;
  }

  function startPracticeRound(course, input, { incrementRound = false } = {}) {
    applyPracticeConfig(course, input);
    const practice = course.practice;
    const ids = buildPracticeIds(course, input);
    practice.remainingIds = [...ids];
    practice.answeredInRound = 0;
    practice.correctInRound = 0;
    practice.currentQuestionId = null;
    practice.lastAnswer = null;
    if (incrementRound) practice.roundNo += practice.totalAnswered ? 1 : 0;

    if (isExamMode(input.mode)) {
      practice.exam.timeLimitMinutes = input.timeLimitMinutes;
      practice.exam.startedAt = new Date().toISOString();
      practice.exam.finishedAt = "";
      practice.exam.questionIds = [...ids];
      practice.exam.answers = [];
      practice.exam.lastSummary = null;
    }
  }

  function stageLocalPracticeRound() {
    const course = activeCourse();
    course.practice.mode = runtime.practiceMode;
    if ((runtime.practiceMode === "count" || runtime.practiceMode === "exam") && activePracticeCount() > 0) {
      course.practice.count = activePracticeCount();
    } else if (runtime.practiceMode !== "count" && runtime.practiceMode !== "exam") {
      course.practice.count = 0;
    }
    course.practice.remainingIds = [];
    course.practice.answeredInRound = 0;
    course.practice.correctInRound = 0;
    course.practice.currentQuestionId = null;
    course.practice.lastAnswer = null;
    if (isExamMode(runtime.practiceMode)) {
      course.practice.exam = {
        timeLimitMinutes: runtime.examTimeLimitMinutes,
        startedAt: "",
        finishedAt: "",
        questionIds: [],
        answers: [],
        lastWrongIds: course.practice.exam?.lastWrongIds || [],
        lastSummary: runtime.practiceMode === "exam-wrong" ? course.practice.exam?.lastSummary || null : null
      };
    }
    clearCurrentAnswer();
    runtime.questionHistory = [];
    saveSettings();
    persistState();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  }

  function buildPracticeIds(course, input) {
    const questions = course.questions || [];
    if (input.mode === "wrong") return getWrongPracticeQuestions(questions).map((question) => question.id);
    if (input.mode === "exam") return buildExamQuestionIds(questions, input.count);
    if (input.mode === "exam-wrong") {
      const availableIds = new Set(questions.map((question) => question.id));
      return (course.practice.exam?.lastWrongIds || []).filter((id) => availableIds.has(id));
    }

    const allIds = questions.map((question) => question.id);
    if (input.mode === "count" && input.count > 0) return shuffle(allIds).slice(0, Math.min(input.count, allIds.length));
    return shuffle(allIds);
  }

  function buildExamQuestionIds(questions, count) {
    const limit = Math.min(Number(count) || 30, questions.length);
    const selected = [];
    const seen = new Set();
    const add = (items) => {
      for (const question of items) {
        if (!question?.id || seen.has(question.id) || selected.length >= limit) continue;
        seen.add(question.id);
        selected.push(question.id);
      }
    };

    add(getWrongPracticeQuestions(questions));
    add(shuffle(questions.filter((question) => question.bookmarked)));
    add(shuffle(questions.filter((question) => !question.wrongCount && !question.correctCount)));
    add(shuffle(questions));
    return selected;
  }

  function shouldAutoStartRound(practice, mode) {
    if (!isExamMode(mode)) return true;
    const exam = practice.exam || {};
    return !exam.startedAt || Boolean(exam.finishedAt) || !exam.questionIds?.length;
  }

  function isPendingWrongQuestion(question) {
    return (question.wrongCount || 0) > 0 && !question.review?.masteredAt;
  }

  function isMasteredWrongQuestion(question) {
    return (question.wrongCount || 0) > 0 && Boolean(question.review?.masteredAt);
  }

  function questionPriority(question) {
    const wrong = question.wrongCount || 0;
    const correct = question.correctCount || 0;
    const answerCount = (question.answer || []).length;
    const lastWrongAt = Date.parse(question.review?.lastWrongAt || "") || 0;
    const recencyDays = lastWrongAt ? Math.min(30, Math.floor((Date.now() - lastWrongAt) / 86400000)) : 30;
    return wrong * 100 + (correct ? 0 : 40) + (answerCount > 1 ? 24 + answerCount : 0) + (30 - recencyDays);
  }

  function sortWrongQuestions(questions) {
    return [...questions].sort((a, b) => questionPriority(b) - questionPriority(a));
  }

  function getWrongPracticeQuestions(questions) {
    return sortWrongQuestions(questions.filter(isPendingWrongQuestion));
  }

  function updateQuestionReview(question, { correct, selectedAnswers, answeredAt }) {
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
  }

  function nextQuestion() {
    const course = activeCourse();
    const practice = course.practice;
    const prevId = practice.currentQuestionId;
    const mode = practice.mode || runtime.practiceMode;

    if (isExamMode(mode) && isPracticeRoundComplete(practice, mode === "exam" ? runtime.examCount : runtime.practiceCount)) {
      finishExam(false);
      return;
    }

    if (!practice.remainingIds.length && shouldAutoStartRound(practice, mode)) {
      startPracticeRound(course, {
        mode,
        count: mode === "exam" ? runtime.examCount : activePracticeCount(),
        timeLimitMinutes: runtime.examTimeLimitMinutes
      }, { incrementRound: true });
    }
    if (prevId) runtime.questionHistory.push(prevId);
    practice.currentQuestionId = practice.remainingIds.shift() || null;
    practice.lastAnswer = null;
    clearCurrentAnswer();
    persistState();
    renderPracticeOnly();
    updatePrevBtn();
    setupExamTimer();
  }

  function prevQuestion() {
    if (!runtime.questionHistory.length) return;
    const course = activeCourse();
    const prevId = runtime.questionHistory.pop();
    if (course.practice.currentQuestionId) course.practice.remainingIds.unshift(course.practice.currentQuestionId);
    course.practice.currentQuestionId = prevId;
    course.practice.lastAnswer = null;
    clearCurrentAnswer();
    persistState();
    renderPracticeOnly();
    updatePrevBtn();
  }

  function submitAnswer() {
    const question = currentQuestion();
    if (!question) {
      alert("请先点击“开始刷题”。");
      return;
    }
    if (runtime.answerFeedback?.questionId === question.id) {
      alert("这道题已经提交过。");
      return;
    }

    let correct;
    if (question.type === "fill-blank") {
      const inputs = document.querySelectorAll(".fill-blank-input");
      runtime.selectedAnswers = Array.from(inputs).map((el) => el.value.trim());
      if (runtime.selectedAnswers.every((item) => !item)) {
        alert("请填写答案。");
        return;
      }
      const blanksCorrect = runtime.selectedAnswers.map((userAns, index) => {
        if (!userAns) return false;
        const acceptable = String(question.answer[index] || "").split(/[；;|、]/).map((item) => item.trim().toLowerCase()).filter(Boolean);
        return acceptable.includes(userAns.toLowerCase());
      });
      correct = blanksCorrect.length === question.answer.length && blanksCorrect.every(Boolean);
    } else {
      if (!runtime.selectedAnswers.length) {
        alert("请选择答案。");
        return;
      }
      runtime.selectedAnswers = getChoiceAnswerTexts(question, runtime.selectedAnswers);
      correct = isChoiceAnswerCorrect(question, runtime.selectedAnswers);
    }

    const course = activeCourse();
    const answeredAt = new Date().toISOString();
    const answer = {
      id: createId("answer"),
      questionId: question.id,
      selectedAnswers: runtime.selectedAnswers,
      correct,
      answeredAt
    };

    runtime.answerFeedback = answer;
    runtime.submittedQuestionId = question.id;
    course.practice.answeredInRound += 1;
    course.practice.totalAnswered += 1;
    if (correct) {
      course.practice.correctInRound += 1;
      course.practice.totalCorrect += 1;
      question.correctCount = (question.correctCount || 0) + 1;
    } else {
      question.wrongCount = (question.wrongCount || 0) + 1;
    }
    updateQuestionReview(question, { correct, selectedAnswers: runtime.selectedAnswers, answeredAt });
    course.practice.lastAnswer = answer;
    recordExamAnswer(course.practice, answer);
    persistState();
    renderPracticeOnly();

    if (correct && settings.autoNext && hasNextQuestionInRound(course.practice)) {
      setTimeout(nextQuestion, 200);
    }
  }

  function resetRound() {
    const course = activeCourse();
    startPracticeRound(course, {
      mode: runtime.practiceMode,
      count: activePracticeCount(),
      timeLimitMinutes: runtime.examTimeLimitMinutes
    });
    clearCurrentAnswer();
    runtime.questionHistory = [];
    persistState();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  }

  function recordExamAnswer(practice, answer) {
    if (!isExamMode(practice.mode)) return;
    practice.exam.answers.push({
      id: answer.id,
      questionId: answer.questionId,
      selectedAnswers: answer.selectedAnswers || [],
      correct: Boolean(answer.correct),
      answeredAt: answer.answeredAt
    });
  }

  function finishExam(timedOut = false) {
    if (!isExamMode(activeCourse().practice.mode) || runtime.finishingExam) return;
    runtime.finishingExam = true;
    const course = activeCourse();
    const practice = course.practice;
    const exam = practice.exam;
    const finishedAt = new Date().toISOString();
    const questionsById = new Map(course.questions.map((question) => [question.id, question]));
    const questionIds = (exam.questionIds || []).filter((id) => questionsById.has(id));
    const latestAnswers = new Map();
    for (const answer of exam.answers || []) {
      if (questionIds.includes(answer.questionId)) latestAnswers.set(answer.questionId, answer);
    }

    const wrongIds = [];
    let correct = 0;
    for (const questionId of questionIds) {
      const answer = latestAnswers.get(questionId);
      if (answer?.correct) correct += 1;
      else wrongIds.push(questionId);
    }

    const startedAt = exam.startedAt || finishedAt;
    const elapsedSeconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
    const summary = {
      id: createId("exam-summary"),
      mode: practice.mode,
      total: questionIds.length,
      answered: latestAnswers.size,
      correct,
      wrong: wrongIds.length,
      accuracy: questionIds.length ? Math.round((correct / questionIds.length) * 100) : 0,
      wrongIds,
      timedOut,
      startedAt,
      finishedAt,
      timeLimitMinutes: Number(exam.timeLimitMinutes) || 20,
      elapsedSeconds
    };

    exam.finishedAt = finishedAt;
    exam.lastWrongIds = wrongIds;
    exam.lastSummary = summary;
    practice.remainingIds = [];
    practice.currentQuestionId = null;
    practice.lastAnswer = null;
    clearCurrentAnswer();
    runtime.questionHistory = [];
    runtime.finishingExam = false;
    persistState();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  }

  function setupExamTimer() {
    if (runtime.examTimerId) {
      clearInterval(runtime.examTimerId);
      runtime.examTimerId = null;
    }
    updateExamTimerText();
    const practice = activeCourse().practice;
    if (!isExamMode(practice.mode) || !practice.exam?.startedAt || practice.exam.finishedAt) {
      toggleFinishExamButton(false);
      return;
    }
    toggleFinishExamButton(true);
    runtime.examTimerId = setInterval(() => {
      const remaining = updateExamTimerText();
      if (remaining <= 0) finishExam(true);
    }, 1000);
  }

  function updateExamTimerText() {
    const timer = $("#examTimer");
    const exam = activeCourse().practice.exam;
    if (!timer || !isExamMode(activeCourse().practice.mode) || !exam?.startedAt || exam.finishedAt) return Infinity;
    const started = Date.parse(exam.startedAt || "");
    if (!started) return Infinity;
    const limitMs = (Number(exam.timeLimitMinutes) || runtime.examTimeLimitMinutes || 20) * 60_000;
    const remaining = started + limitMs - Date.now();
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    timer.classList.toggle("is-danger", remaining <= 60_000);
    return remaining;
  }

  function toggleFinishExamButton(show) {
    const btn = $("#finishExamBtn");
    if (btn) btn.style.display = show ? "" : "none";
  }

  function renderApp() {
    renderCourseToolbar();
    renderPractice(activeCourse());
    renderReview(activeCourse());
    renderBank(activeCourse());
    renderDataPanel();
  }

  function renderPracticeOnly() {
    renderPractice(activeCourse());
  }

  function renderCourseToolbar() {
    const course = activeCourse();
    $("#questionCount").textContent = course.questions.length;
    $("#courseSelect").innerHTML = runtime.state.courses.map((item) => (
      `<option value="${escapeHtml(item.id)}" ${item.id === runtime.state.activeCourseId ? "selected" : ""}>${escapeHtml(item.name)}（${item.questions.length}题）</option>`
    )).join("");
    const answered = course.questions.filter((question) => (question.correctCount || 0) || (question.wrongCount || 0)).length;
    $("#courseMeta").textContent = `已练 ${answered}/${course.questions.length} 题 · 错题 ${course.questions.filter(isPendingWrongQuestion).length} 道`;
  }

  function renderPractice(course) {
    const practice = course.practice;
    const question = currentQuestion();
    const mode = practice.mode || "all";
    runtime.practiceMode = mode === "exam-wrong" ? runtime.practiceMode : mode;
    syncPracticeInputs();

    const examTotal = examQuestionTotal(practice, runtime.examCount);
    const plannedTotal = plannedPracticeTotal(course, practice, mode, examTotal);
    const roundTotal = isExamMode(mode) ? examTotal || plannedTotal : roundQuestionTotal(practice, plannedTotal);
    const answeredCount = roundAnsweredCount(practice, roundTotal);
    const remainingCount = roundRemainingCount(practice, roundTotal);
    const roundComplete = isPracticeRoundComplete(practice, roundTotal);

    const modeLabel = mode === "exam"
      ? `限时模拟 ${examTotal || practice.count || runtime.examCount} 题`
      : mode === "exam-wrong"
        ? "本轮错题复盘"
        : mode === "wrong"
          ? "错题重做"
          : mode === "count"
            ? `指定 ${practice.count || runtime.practiceCount} 题`
            : "全部题目";
    $("#roundInfo").textContent = `${course.name}：${modeLabel}，剩余 ${remainingCount} 题`;
    $("#accuracy").innerHTML = `
      <div><strong>${rate(practice.correctInRound, practice.answeredInRound)}</strong><span>正确率 ${practice.correctInRound}/${practice.answeredInRound}</span></div>
      ${isExamMode(mode) ? `<div class="exam-stat"><strong id="examTimer">${practice.exam?.finishedAt ? "已结束" : "--:--"}</strong><span>剩余时间 · ${Math.min(roundTotal, practice.answeredInRound || 0)}/${roundTotal} 题</span></div>` : ""}
    `;
    renderRoundBoundary({ practice, mode, question, total: roundTotal, answered: answeredCount, remaining: remainingCount, complete: roundComplete });
    updatePracticeActions({ practice, question, mode, complete: roundComplete });

    if (!question) {
      if (isExamMode(mode) && practice.exam?.lastSummary) {
        $("#quizCard").innerHTML = renderExamSummary(practice.exam.lastSummary);
        updateExamTimerText();
        return;
      }
      if (isExamMode(mode) && roundComplete) {
        $("#quizCard").innerHTML = `<section class="exam-empty-state"><p class="empty">本轮题目已答完，结束模拟查看总结。</p><button data-exam-action="finish" type="button">结束模拟</button></section>`;
        updateExamTimerText();
        return;
      }
      if (!isPracticeRoundStarted(practice) && practice.remainingIds.length) {
        $("#quizCard").innerHTML = renderRoundStartState(mode);
        updateExamTimerText();
        return;
      }
      if (roundComplete && mode === "count") {
        $("#quizCard").innerHTML = renderRoundCompleteState(practice, "本轮指定题数已完成。");
      } else if (mode === "wrong" && practice.answeredInRound > 0) {
        $("#quizCard").innerHTML = renderRoundCompleteState(practice, "本轮待清错题已完成。连续答对 2 次的题会标记为已掌握。");
      } else if (mode === "wrong") {
        $("#quizCard").innerHTML = `<p class="empty">暂无待清错题。答错的题会进入这里，连续答对 2 次后自动清出。</p>`;
      } else {
        $("#quizCard").innerHTML = renderRoundStartState(mode);
      }
      updateExamTimerText();
      return;
    }

    if (question.type === "fill-blank") renderFillBlankPractice(question);
    else renderChoicePractice(question);
    updateExamTimerText();
  }

  function plannedPracticeTotal(course, practice, mode, examTotal) {
    if (mode === "exam") return examTotal || practice.count || runtime.examCount || 0;
    if (mode === "exam-wrong") return examTotal || practice.exam?.lastWrongIds?.length || 0;
    if (mode === "count") return practice.count || runtime.practiceCount || 0;
    if (mode === "wrong") return course.questions.filter(isPendingWrongQuestion).length;
    return course.questions.length;
  }

  function renderRoundBoundary({ practice, mode, question, total, answered, remaining, complete }) {
    const target = $("#roundBoundary");
    const started = isPracticeRoundStarted(practice);
    let label = "未开始";
    let detail = "点击“开始刷题”进入本轮第一题。";
    let tone = "is-start";
    if (complete) {
      label = isExamMode(mode) ? "本轮题目已答完" : "本轮已完成";
      detail = isExamMode(mode) ? "点击“结束模拟”查看本轮总结和错题复盘。" : "点击“开始下一轮”继续刷题，或重置本轮重新抽题。";
      tone = "is-complete";
    } else if (started || question) {
      label = "进行中";
      detail = total > 0 ? `进度 ${answered}/${total}，剩余 ${remaining} 题。` : "正在刷题。";
      tone = "is-active";
    }
    target.className = `round-boundary ${tone}`;
    target.innerHTML = `<strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span>`;
  }

  function updatePracticeActions({ practice, question, mode, complete }) {
    const submitBtn = $("#submitBtn");
    const nextBtn = $("#nextBtn");
    const submitted = question && runtime.answerFeedback?.questionId === question.id;
    const finishedExam = isExamMode(mode) && practice.exam?.finishedAt;
    submitBtn.disabled = !question || Boolean(submitted) || Boolean(finishedExam);
    submitBtn.textContent = submitted ? "已提交" : "提交答案";
    nextBtn.style.display = finishedExam ? "none" : "";
    if (!question && !isPracticeRoundStarted(practice)) nextBtn.textContent = mode === "exam" ? "开始模拟" : "开始刷题";
    else if (complete) nextBtn.textContent = isExamMode(mode) ? "结束模拟" : "开始下一轮";
    else nextBtn.textContent = "下一题";
  }

  function renderRoundStartState(mode) {
    const title = mode === "exam" ? "限时模拟未开始" : "本轮未开始";
    const action = mode === "exam" ? "开始模拟" : "开始刷题";
    return `<section class="round-state"><strong>${title}</strong><p>点击下方“${action}”抽取第一题。本轮开始后会显示进度和剩余题数。</p></section>`;
  }

  function renderRoundCompleteState(practice, message) {
    return `<section class="round-state"><strong>本轮已完成</strong><p>${escapeHtml(message)}</p><p>正确率 ${rate(practice.correctInRound, practice.answeredInRound)}，已答 ${practice.correctInRound}/${practice.answeredInRound}。</p><button data-round-action="next-round" type="button">开始下一轮</button></section>`;
  }

  function renderChoicePractice(question) {
    const isMulti = question.answer.length > 1;
    const inputType = isMulti ? "checkbox" : "radio";
    const options = settings.shuffleOptions ? shuffle(question.options) : question.options;
    const wrongTag = question.wrongCount > 0 ? `<span class="wrong-count-tag">已错 ${question.wrongCount} 次</span>` : "";
    $("#quizCard").innerHTML = `
      <div class="quiz-card-header">
        <h3>${escapeHtml(question.stem || "题干缺失")} ${isMulti ? '<span class="multi-hint">多选题</span>' : ""} ${wrongTag}</h3>
        <button class="bookmark-btn ${question.bookmarked ? "active" : ""}" data-bookmark="${escapeHtml(question.id)}" title="收藏" type="button">★</button>
      </div>
      <div class="option-list">
        ${options.map((option) => `
          <label class="option ${optionClass(question, option)}">
            <input type="${inputType}" name="answer" value="${escapeHtml(option.text)}" data-key="${escapeHtml(option.key)}" ${runtime.answerFeedback ? "disabled" : ""}>
            <span><b>${escapeHtml(option.key)}.</b> ${escapeHtml(option.text)}</span>
          </label>
        `).join("")}
      </div>
      <div id="answerResult">${renderAnswerFeedback(question)}</div>
    `;
    document.querySelectorAll("input[name='answer']").forEach((input) => {
      input.checked = hasChoiceAnswer(question, input.value, runtime.selectedAnswers);
      input.addEventListener("change", () => {
        const value = input.value;
        if (isMulti) {
          if (input.checked) runtime.selectedAnswers = getChoiceAnswerTexts(question, [...runtime.selectedAnswers, value]);
          else runtime.selectedAnswers = runtime.selectedAnswers.filter((item) => normalizeChoiceText(item) !== normalizeChoiceText(value));
        } else {
          runtime.selectedAnswers = getChoiceAnswerTexts(question, [value]);
        }
      });
    });
  }

  function renderFillBlankPractice(question) {
    const feedback = runtime.answerFeedback;
    const hasSubmitted = feedback && feedback.questionId === question.id;
    const blankCount = question.answer.length;
    const inputs = Array.from({ length: blankCount }, (_, index) => (
      `<input type="text" class="fill-blank-input" data-index="${index}" placeholder="第${index + 1}个空" value="${escapeHtml(runtime.selectedAnswers[index] || "")}" ${hasSubmitted ? "disabled" : ""}>`
    )).join("");
    $("#quizCard").innerHTML = `
      <div class="quiz-card-header">
        <h3>${escapeHtml(question.stem || "题干缺失")} ${blankCount > 1 ? `<span class="multi-hint">共 ${blankCount} 个空</span>` : ""}</h3>
        <button class="bookmark-btn ${question.bookmarked ? "active" : ""}" data-bookmark="${escapeHtml(question.id)}" title="收藏" type="button">★</button>
      </div>
      <div class="fill-blank-area">${inputs}</div>
      <div id="answerResult">${renderAnswerFeedback(question)}</div>
    `;
    if (!hasSubmitted) {
      document.querySelectorAll(".fill-blank-input").forEach((input) => {
        input.addEventListener("input", () => {
          runtime.selectedAnswers = Array.from(document.querySelectorAll(".fill-blank-input")).map((el) => el.value.trim());
        });
      });
    }
  }

  function optionClass(question, option) {
    const feedback = runtime.answerFeedback;
    if (!feedback || feedback.questionId !== question.id) return "";
    if (hasChoiceAnswer(question, option.text)) return "is-correct";
    if (feedback.selectedAnswers && hasChoiceAnswer(question, option.text, feedback.selectedAnswers)) return "is-wrong";
    return "";
  }

  function renderAnswerFeedback(question) {
    const feedback = runtime.answerFeedback;
    if (!feedback || feedback.questionId !== question.id) return "";
    const isFillBlank = question.type === "fill-blank";
    const selected = isFillBlank
      ? (feedback.selectedAnswers || []).map((answer, index) => `第${index + 1}空：${answer || "未填写"}`).join("、")
      : getChoiceAnswerTexts(question, feedback.selectedAnswers || []).join("、") || "未选择";
    const correctText = isFillBlank
      ? question.answer.map((answer, index) => `第${index + 1}空：${answer}`).join("、")
      : getChoiceAnswerTexts(question).join("、");
    const lines = [
      `<strong>${feedback.correct ? "回答正确" : "回答错误"}</strong>`,
      `你的答案：${escapeHtml(selected)}`
    ];
    if (settings.showAnswer) lines.push(`正确答案：${escapeHtml(correctText)}`);
    if (settings.showExplanation && question.explanation) lines.push(`解析：${escapeHtml(question.explanation)}`);
    if (settings.showExplanation && question.memoryTip) lines.push(`速记：${escapeHtml(String(question.memoryTip).replace(/^速记[:：]\s*/, ""))}`);
    if (!settings.showAnswer && !settings.showExplanation) lines.push("已记录本题结果，可在上方开关中选择是否显示答案和解析。");
    return `<div class="${feedback.correct ? "correct" : "wrong"}">${lines.join("<br>")}</div>`;
  }

  function renderExamSummary(summary) {
    const wrongCount = summary.wrongIds?.length || summary.wrong || 0;
    return `
      <section class="exam-summary">
        <h3>${summary.timedOut ? "时间到，模拟结束" : "限时模拟完成"}</h3>
        <div class="exam-summary-grid">
          <div><strong>${summary.accuracy}%</strong><span>正确率</span></div>
          <div><strong>${summary.correct}/${summary.total}</strong><span>答对题数</span></div>
          <div><strong>${wrongCount}</strong><span>本轮错题</span></div>
          <div><strong>${formatDuration(summary.elapsedSeconds)}</strong><span>用时</span></div>
        </div>
        ${wrongCount ? `<button data-exam-action="review-wrong" type="button">复盘本轮错题</button>` : `<p class="empty">本轮没有错题。</p>`}
      </section>
    `;
  }

  function formatDuration(seconds = 0) {
    const safe = Math.max(0, Number(seconds) || 0);
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
  }

  function analyzeReview(course) {
    const questions = course.questions || [];
    const wrongQuestions = questions.filter((question) => (question.wrongCount || 0) > 0);
    const pendingWrongQuestions = wrongQuestions.filter(isPendingWrongQuestion);
    const masteredWrongQuestions = wrongQuestions.filter(isMasteredWrongQuestion);
    const answeredQuestions = questions.filter((question) => (question.wrongCount || 0) > 0 || (question.correctCount || 0) > 0);
    const correctAttempts = questions.reduce((sum, question) => sum + (question.correctCount || 0), 0);
    const wrongAttempts = questions.reduce((sum, question) => sum + (question.wrongCount || 0), 0);
    const repeatedWrong = pendingWrongQuestions.filter((question) => (question.wrongCount || 0) >= 2);
    const multiWrong = pendingWrongQuestions.filter((question) => (question.answer || []).length > 1);
    return {
      totalQuestions: questions.length,
      answeredQuestions: answeredQuestions.length,
      wrongQuestions: wrongQuestions.length,
      pendingWrongQuestions: pendingWrongQuestions.length,
      masteredWrongQuestions: masteredWrongQuestions.length,
      repeatedWrong: repeatedWrong.length,
      multiWrong: multiWrong.length,
      correctAttempts,
      wrongAttempts,
      accuracy: correctAttempts + wrongAttempts ? Math.round((correctAttempts / (correctAttempts + wrongAttempts)) * 100) : 0,
      priorityQuestions: sortWrongQuestions(pendingWrongQuestions).slice(0, 12)
    };
  }

  function renderReview(course) {
    const review = analyzeReview(course);
    $("#reviewInsights").innerHTML = `
      <div class="review-summary-grid">
        ${renderReviewMetric("已练题目", `${review.answeredQuestions}/${review.totalQuestions}`, "按题目去重")}
        ${renderReviewMetric("总正确率", `${review.accuracy}%`, `${review.correctAttempts}/${review.correctAttempts + review.wrongAttempts}`)}
        ${renderReviewMetric("待清错题", review.pendingWrongQuestions, "连续答对 2 次清出")}
        ${renderReviewMetric("已掌握错题", review.masteredWrongQuestions, "从待清错题移出")}
      </div>
      <section class="review-section">
        <h3>优先复习</h3>
        ${review.priorityQuestions.length ? review.priorityQuestions.map((question, index) => renderPriorityQuestion(question, index)).join("") : `<p class="empty">当前章节暂无待清错题。</p>`}
      </section>
    `;
  }

  function renderReviewMetric(label, value, note) {
    return `<div class="review-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
  }

  function renderPriorityQuestion(question, index) {
    return `
      <article class="review-item">
        <h4>${index + 1}. ${escapeHtml(question.stem)}</h4>
        <p>答案：${escapeHtml(getChoiceAnswerTexts(question).join("、"))}</p>
        <p>已错 ${question.wrongCount || 0} 次，连续答对 ${question.review?.consecutiveCorrect || 0}/2。</p>
      </article>
    `;
  }

  function renderBank(course) {
    $("#bankToolbar").innerHTML = `
      <input id="bankSearch" type="search" placeholder="搜索题干、选项、答案、解析" value="${escapeHtml(runtime.bankSearch)}">
      <button id="toggleWrongOnlyBtn" class="ghost ${runtime.bankShowWrongOnly ? "active-filter" : ""}" type="button">只看错题</button>
      <button id="toggleBookmarkedOnlyBtn" class="ghost ${runtime.bankShowBookmarkedOnly ? "active-filter" : ""}" type="button">只看收藏</button>
      <span class="toolbar-meta">${course.questions.length} 题</span>
    `;
    renderBankList(course);
  }

  function renderBankList(course) {
    const keyword = runtime.bankSearch.trim().toLowerCase();
    let questions = course.questions || [];
    if (runtime.bankShowWrongOnly) questions = questions.filter(isPendingWrongQuestion);
    if (runtime.bankShowBookmarkedOnly) questions = questions.filter((question) => question.bookmarked);
    if (keyword) {
      questions = questions.filter((question) => [
        question.stem,
        ...(question.options || []).map((option) => option.text),
        ...(question.answer || []),
        question.explanation || "",
        question.memoryTip || ""
      ].join("\n").toLowerCase().includes(keyword));
    }
    const visible = questions.slice(0, BANK_RENDER_LIMIT);
    $("#bankList").innerHTML = `
      ${questions.length > BANK_RENDER_LIMIT ? `<p class="status">当前筛选 ${questions.length} 题，仅显示前 ${BANK_RENDER_LIMIT} 题；可继续输入关键词缩小范围。</p>` : ""}
      ${visible.length ? visible.map(renderBankItem).join("") : `<p class="empty">没有匹配的题目。</p>`}
    `;
  }

  function renderBankItem(question) {
    const tags = [];
    if ((question.answer || []).length > 1) tags.push("多选");
    if (question.wrongCount > 0) tags.push(`错 ${question.wrongCount}`);
    if (isMasteredWrongQuestion(question)) tags.push("已掌握");
    if (question.bookmarked) tags.push("收藏");
    return `
      <article class="bank-item">
        <div>
          <h3>${escapeHtml(question.stem)} ${tags.map((tag) => `<span class="stats-tag ${tag.startsWith("错") ? "is-pending" : ""}">${escapeHtml(tag)}</span>`).join("")}</h3>
          <div class="bank-options">
            ${(question.options || []).map((option) => `<p>${escapeHtml(option.key)}. ${escapeHtml(option.text)}</p>`).join("")}
          </div>
          <p>答案：${escapeHtml(getChoiceAnswerTexts(question).join("、"))}</p>
          ${question.explanation ? `<p>解析：${escapeHtml(question.explanation)}</p>` : ""}
        </div>
        <div class="bank-actions">
          <button class="ghost" data-bank-practice="${escapeHtml(question.id)}" type="button">练这题</button>
          <button class="ghost" data-bank-bookmark="${escapeHtml(question.id)}" type="button">${question.bookmarked ? "取消收藏" : "收藏"}</button>
        </div>
      </article>
    `;
  }

  function renderDataPanel() {
    const totalQuestions = runtime.state.courses.reduce((sum, course) => sum + course.questions.length, 0);
    const progress = selectProgressForHydration();
    const progressCount = Object.keys(progress.questionProgress || {}).length;
    $("#dataSummary").innerHTML = `
      <div class="data-block">
        <p><span class="ok">已完成迁移校验</span>：${embedded.metadata.totalCourses} 个章节，${embedded.metadata.totalQuestions} 道题，题干、选项、答案与源 JSON 逐题一致。</p>
        <p>本 HTML 已生成分析型解析和速记：解析 ${embedded.metadata.generatedNotes?.explanationAdded || 0} 条，速记 ${embedded.metadata.generatedNotes?.memoryTipAdded || 0} 条。</p>
        <p>当前载入：${totalQuestions} 道题；本机已保存进度题目：${progressCount} 道。</p>
      </div>
      <div class="data-block">
        <p>源文件：${escapeHtml(embedded.metadata.sourceFile)}</p>
        <p>源文件修改时间：${escapeHtml(embedded.metadata.sourceMtime)}</p>
        <p>题目核心 SHA256：${escapeHtml(embedded.metadata.sourceQuestionCoreSha256 || "")}</p>
        <p>题库 SHA256：${escapeHtml(embedded.metadata.questionBankSha256)}</p>
        <p>生成时间：${escapeHtml(embedded.metadata.generatedAt)}</p>
      </div>
      <div class="data-block">
        <p>章节题量</p>
        <div class="course-grid">
          ${runtime.state.courses.map((course) => `<div class="course-pill">${escapeHtml(course.name)}：${course.questions.length} 题</div>`).join("")}
        </div>
      </div>
      <div class="data-block">
        <button id="resetProgressBtn" class="ghost" type="button">清空本机进度</button>
      </div>
    `;
  }

  function syncPracticeInputs() {
    const mode = runtime.practiceMode;
    const countInput = $("#practiceCountInput");
    const countHint = $("#practiceCountHint");
    const examTimeControls = $("#examTimeControls");
    const showCount = mode === "count" || mode === "exam";
    countInput.style.display = showCount ? "" : "none";
    countHint.style.display = showCount ? "" : "none";
    examTimeControls.style.display = mode === "exam" ? "" : "none";
    countInput.value = mode === "exam" ? runtime.examCount : runtime.practiceCount;
    $("#examMinutesInput").value = runtime.examTimeLimitMinutes;
    const radio = document.querySelector(`input[name='practiceMode'][value='${mode}']`);
    if (radio) radio.checked = true;
  }

  function updatePrevBtn() {
    $("#prevBtn").style.display = runtime.questionHistory.length ? "" : "none";
  }

  function bind() {
    document.querySelectorAll(".tabs button").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tabs button,.panel").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        $(`#${button.dataset.tab}`).classList.add("active");
        if (button.dataset.tab === "reviewPanel") renderReview(activeCourse());
        if (button.dataset.tab === "bankPanel") renderBank(activeCourse());
        if (button.dataset.tab === "dataPanel") renderDataPanel();
      });
    });

    $("#courseSelect").addEventListener("change", (event) => {
      runtime.state.activeCourseId = event.target.value;
      clearCurrentAnswer();
      runtime.questionHistory = [];
      const course = activeCourse();
      runtime.practiceMode = course.practice.mode === "exam-wrong" ? "wrong" : course.practice.mode || runtime.practiceMode;
      persistState();
      renderApp();
      updatePrevBtn();
      setupExamTimer();
    });

    $("#showAnswerToggle").checked = settings.showAnswer;
    $("#showExplanationToggle").checked = settings.showExplanation;
    $("#autoNextToggle").checked = settings.autoNext;
    $("#shuffleOptionsToggle").checked = settings.shuffleOptions;
    $("#showAnswerToggle").addEventListener("change", (event) => { settings.showAnswer = event.target.checked; saveSettings(); renderPracticeOnly(); });
    $("#showExplanationToggle").addEventListener("change", (event) => { settings.showExplanation = event.target.checked; saveSettings(); renderPracticeOnly(); });
    $("#autoNextToggle").addEventListener("change", (event) => { settings.autoNext = event.target.checked; saveSettings(); });
    $("#shuffleOptionsToggle").addEventListener("change", (event) => { settings.shuffleOptions = event.target.checked; saveSettings(); renderPracticeOnly(); });

    document.querySelectorAll("input[name='practiceMode']").forEach((radio) => {
      radio.addEventListener("change", (event) => {
        runtime.practiceMode = event.target.value;
        stageLocalPracticeRound();
      });
    });

    $("#practiceCountInput").addEventListener("input", (event) => {
      const value = Math.max(1, Number(event.target.value) || 1);
      if (runtime.practiceMode === "exam") runtime.examCount = value;
      else runtime.practiceCount = value;
      saveSettings();
    });
    $("#practiceCountInput").addEventListener("change", () => {
      if (runtime.practiceMode === "count" || runtime.practiceMode === "exam") stageLocalPracticeRound();
    });
    $("#examMinutesInput").addEventListener("input", (event) => {
      runtime.examTimeLimitMinutes = Math.max(1, Number(event.target.value) || 1);
      saveSettings();
    });
    $("#examMinutesInput").addEventListener("change", () => {
      if (runtime.practiceMode === "exam") stageLocalPracticeRound();
    });

    $("#resetRoundBtn").addEventListener("click", resetRound);
    $("#submitBtn").addEventListener("click", submitAnswer);
    $("#prevBtn").addEventListener("click", prevQuestion);
    $("#nextBtn").addEventListener("click", nextQuestion);
    $("#finishExamBtn").addEventListener("click", () => finishExam(false));

    $("#quizCard").addEventListener("click", (event) => {
      const bookmark = event.target.closest("[data-bookmark]");
      if (bookmark) toggleBookmark(bookmark.dataset.bookmark);
      const examAction = event.target.closest("[data-exam-action]");
      if (examAction?.dataset.examAction === "review-wrong") startExamWrongReview();
      if (examAction?.dataset.examAction === "finish") finishExam(false);
      const roundAction = event.target.closest("[data-round-action]");
      if (roundAction?.dataset.roundAction === "next-round") nextQuestion();
    });

    $("#reviewPanel").addEventListener("click", (event) => {
      const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
      if (action === "practice-wrong") {
        runtime.practiceMode = "wrong";
        stageLocalPracticeRound();
        switchTab("practicePanel");
        resetRound();
      }
      if (action === "open-wrong-bank") {
        runtime.bankShowWrongOnly = true;
        runtime.bankShowBookmarkedOnly = false;
        runtime.bankSearch = "";
        switchTab("bankPanel");
        renderBank(activeCourse());
      }
    });

    $("#bankToolbar").addEventListener("input", (event) => {
      if (event.target.id === "bankSearch") {
        runtime.bankSearch = event.target.value;
        renderBankList(activeCourse());
      }
    });
    $("#bankToolbar").addEventListener("click", (event) => {
      if (event.target.id === "toggleWrongOnlyBtn") {
        runtime.bankShowWrongOnly = !runtime.bankShowWrongOnly;
        renderBank(activeCourse());
      }
      if (event.target.id === "toggleBookmarkedOnlyBtn") {
        runtime.bankShowBookmarkedOnly = !runtime.bankShowBookmarkedOnly;
        renderBank(activeCourse());
      }
    });
    $("#bankList").addEventListener("click", (event) => {
      const practiceId = event.target.closest("[data-bank-practice]")?.dataset.bankPractice;
      if (practiceId) practiceSpecificQuestion(practiceId);
      const bookmarkId = event.target.closest("[data-bank-bookmark]")?.dataset.bankBookmark;
      if (bookmarkId) toggleBookmark(bookmarkId);
    });

    $("#dataPanel").addEventListener("click", (event) => {
      if (event.target.id === "resetProgressBtn") resetProgress();
    });
    $("#exportProgressBtn").addEventListener("click", exportProgress);
    $("#importProgressBtn").addEventListener("click", () => $("#progressFileInput").click());
    $("#progressFileInput").addEventListener("change", importProgress);

    bindKeyboardShortcuts();
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tabs button,.panel").forEach((item) => item.classList.remove("active"));
    document.querySelector(`.tabs button[data-tab='${tabId}']`)?.classList.add("active");
    $(`#${tabId}`)?.classList.add("active");
  }

  function toggleBookmark(questionId) {
    const course = activeCourse();
    const question = course.questions.find((item) => item.id === questionId);
    if (!question) return;
    question.bookmarked = !question.bookmarked;
    persistState();
    renderApp();
  }

  function practiceSpecificQuestion(questionId) {
    const course = activeCourse();
    if (!course.questions.some((question) => question.id === questionId)) return;
    course.practice.mode = "count";
    course.practice.count = 1;
    course.practice.remainingIds = [];
    course.practice.answeredInRound = 0;
    course.practice.correctInRound = 0;
    course.practice.currentQuestionId = questionId;
    course.practice.lastAnswer = null;
    runtime.practiceMode = "count";
    runtime.questionHistory = [];
    clearCurrentAnswer();
    persistState();
    switchTab("practicePanel");
    renderApp();
    updatePrevBtn();
  }

  function startExamWrongReview() {
    runtime.practiceMode = "exam-wrong";
    const course = activeCourse();
    startPracticeRound(course, {
      mode: "exam-wrong",
      count: runtime.practiceCount,
      timeLimitMinutes: runtime.examTimeLimitMinutes
    });
    clearCurrentAnswer();
    runtime.questionHistory = [];
    persistState();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  }

  function resetProgress() {
    if (!confirm("确认清空当前浏览器里的答题进度、错题和收藏？题库文件本身不会改变。")) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      bankHash: embedded.metadata.questionBankSha256,
      savedAt: new Date().toISOString(),
      activeCourseId: embedded.activeCourseId,
      practices: {},
      questionProgress: {},
      embeddedProgressSignature
    }));
    activeProgressSignature = embeddedProgressSignature;
    runtime.state = hydrateState();
    clearCurrentAnswer();
    runtime.questionHistory = [];
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  }

  function exportProgress() {
    persistState();
    const payload = readJson(STORAGE_KEY, {});
    payload.exportedAt = new Date().toISOString();
    payload.bankHash = embedded.metadata.questionBankSha256;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `毛概刷题进度-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importProgress(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      if (!isCompatibleProgressHash(payload.bankHash)) {
        if (!confirm("进度文件来自不同题库版本，仍要导入吗？")) return;
      }
      payload.embeddedProgressSignature = embeddedProgressSignature;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      activeProgressSignature = embeddedProgressSignature;
      runtime.state = hydrateState();
      clearCurrentAnswer();
      runtime.questionHistory = [];
      renderApp();
      updatePrevBtn();
      setupExamTimer();
      alert("进度已导入。");
    } catch (error) {
      alert(`导入失败：${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function bindKeyboardShortcuts() {
    document.addEventListener("keydown", (event) => {
      const tagName = event.target.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      const key = event.key.toUpperCase();
      if (/^[A-Z]$/.test(key)) {
        const question = currentQuestion();
        if (!question || runtime.answerFeedback) return;
        const option = question.options?.find((item) => item.key === key);
        if (!option) return;
        const input = document.querySelector(`input[name='answer'][data-key='${key}']`);
        if (!input) return;
        const isMulti = question.answer.length > 1;
        if (isMulti) {
          input.checked = !input.checked;
          if (input.checked) runtime.selectedAnswers = getChoiceAnswerTexts(question, [...runtime.selectedAnswers, option.text]);
          else runtime.selectedAnswers = runtime.selectedAnswers.filter((item) => normalizeChoiceText(item) !== normalizeChoiceText(option.text));
        } else {
          document.querySelectorAll("input[name='answer']").forEach((el) => { el.checked = false; });
          input.checked = true;
          runtime.selectedAnswers = getChoiceAnswerTexts(question, [option.text]);
        }
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        submitAnswer();
        return;
      }
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        nextQuestion();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        prevQuestion();
      }
    });
  }

  bind();
  const course = activeCourse();
  if (course.practice.lastAnswer) {
    runtime.answerFeedback = course.practice.lastAnswer;
    runtime.selectedAnswers = course.practice.lastAnswer.selectedAnswers || [];
    runtime.submittedQuestionId = course.practice.lastAnswer.questionId;
  }
  runtime.practiceMode = course.practice.mode === "exam-wrong" ? "wrong" : course.practice.mode || runtime.practiceMode;
  renderApp();
  updatePrevBtn();
  setupExamTimer();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeChoiceText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}
