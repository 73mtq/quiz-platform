import fs from "node:fs/promises";
import path from "node:path";
import { frontendDir } from "./config.js";
import { applyStudyNotesToState } from "./services/StudyNoteGenerator.js";
import {
  areChoiceAnswerSetsEqual,
  createId,
  getChoiceAnswerTexts,
  getWrongPracticeQuestions,
  normalizeChoiceText,
  normalizeQuestion,
  readBody,
  sendJson,
  updateQuestionReview,
  validateQuestion
} from "./utils.js";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export function createRouter({ repository, aiService }) {
  return async function route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url, repository, aiService);
      return;
    }

    await serveStatic(url, res);
  };
}

async function handleApi(req, res, url, repository, aiService) {
  try {
    const body = req.method === "POST" ? parseBody(await readBody(req)) : {};

    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(res, 200, await repository.getState());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export") {
      sendJson(res, 200, await repository.getState());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/backups") {
      sendJson(res, 200, { backups: await repository.listBackups() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/study-notes/generate") {
      let result = null;
      const state = await repository.update((draft) => {
        result = applyStudyNotesToState(draft, { overwrite: Boolean(body.overwrite) });
      });
      sendJson(res, 200, { state, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses") {
      const state = await repository.update((draft) => {
        const course = repository.createCourse(String(body.name || "").trim() || "新课程");
        draft.courses.push(course);
        draft.activeCourseId = course.id;
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses/active") {
      const lightResponse = url.searchParams.get("light") === "1";
      const state = await repository.update((draft) => {
        if (draft.courses.some((course) => course.id === body.courseId)) {
          draft.activeCourseId = body.courseId;
        }
      }, { skipBackup: true, readAfterWrite: !lightResponse });
      sendJson(res, 200, lightResponse ? { activeCourseId: state.activeCourseId } : state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses/delete") {
      const state = await repository.update((draft) => {
        if (draft.courses.length <= 1) return;
        draft.courses = draft.courses.filter((course) => course.id !== body.courseId);
        draft.activeCourseId = draft.courses[0].id;
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions") {
      let importResult = null;
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        importResult = buildImportResult(body.questions || [], course.questions);
        course.questions.push(...importResult.accepted);
      });
      sendJson(res, 200, { state, importResult });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/delete") {
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        course.questions = course.questions.filter((question) => question.id !== body.questionId);
        course.practice.remainingIds = course.practice.remainingIds.filter((id) => id !== body.questionId);
        if (course.practice.currentQuestionId === body.questionId) course.practice.currentQuestionId = null;
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/update") {
      const { questionId, stem, options, answer, explanation, memoryTip } = body;
      const lightResponse = url.searchParams.get("light") === "1";
      if (!questionId) {
        sendJson(res, 400, { error: "缺少题目 ID" });
        return;
      }
      const state = await repository.update((draft) => {
        const result = repository.updateQuestion(draft, questionId, { stem, options, answer, explanation, memoryTip });
        if (!result) throw new Error("题目不存在");
      }, { readAfterWrite: !lightResponse });
      sendJson(res, 200, lightResponse ? { questionId } : state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/bookmark") {
      const { questionId } = body;
      if (!questionId) {
        sendJson(res, 400, { error: "缺少题目 ID" });
        return;
      }
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        const question = course.questions.find((q) => q.id === questionId);
        if (!question) throw new Error("题目不存在");
        question.bookmarked = !question.bookmarked;
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/next") {
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        const input = practiceInput(body, course.practice);
        applyPracticeConfig(course, input);

        if (!course.practice.remainingIds.length && shouldAutoStartRound(course.practice, input.mode)) {
          startPracticeRound(course, input, { incrementRound: true });
        }
        course.practice.currentQuestionId = course.practice.remainingIds.shift() || null;
        course.practice.lastAnswer = null;
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/answer") {
      let answerResult = null;
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        const question = course.questions.find((item) => item.id === body.questionId);
        if (!question) {
          answerResult = { accepted: false, message: "题目不存在" };
          return;
        }
        if (course.practice.lastAnswer?.questionId === question.id) {
          answerResult = {
            accepted: false,
            message: "这道题已经提交过",
            ...course.practice.lastAnswer,
            correctAnswer: question.answer
          };
          return;
        }

        let correct;
        let selectedAnswers;
        if (question.type === "fill-blank") {
          // 填空题：逐空匹配，每空任一可接受答案匹配即算对
          selectedAnswers = (body.selectedAnswers || []).map((item) => String(item).trim());
          const blanksCorrect = selectedAnswers.map((userAns, i) => {
            if (!userAns) return false;
            const acceptable = (question.answer[i] || "").split(/[；;|、]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
            return acceptable.includes(userAns.toLowerCase());
          });
          correct = blanksCorrect.length === question.answer.length && blanksCorrect.every(Boolean);
        } else {
          selectedAnswers = getChoiceAnswerTexts(question, body.selectedAnswers || []);
          correct = areChoiceAnswerSetsEqual(question, selectedAnswers);
        }
        course.practice.answeredInRound += 1;
        course.practice.totalAnswered += 1;
        const answeredAt = new Date().toISOString();
        if (correct) {
          course.practice.correctInRound += 1;
          course.practice.totalCorrect += 1;
          question.correctCount = (question.correctCount || 0) + 1;
        } else {
          question.wrongCount = (question.wrongCount || 0) + 1;
        }
        updateQuestionReview(question, { correct, selectedAnswers, answeredAt });
        course.practice.lastAnswer = {
          id: createId("answer"),
          questionId: question.id,
          selectedAnswers,
          correct,
          answeredAt
        };
        recordExamAnswer(course.practice, course.practice.lastAnswer);
        answerResult = {
          accepted: true,
          ...course.practice.lastAnswer,
          correctAnswer: question.answer
        };
      });
      sendJson(res, 200, { state, answerResult });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/reset-round") {
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        startPracticeRound(course, practiceInput(body, course.practice));
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/finish-exam") {
      let summary = null;
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        summary = finishExam(course, { timedOut: Boolean(body.timedOut) });
      });
      sendJson(res, 200, { state, summary });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/recognize-image") {
      const result = await aiService.recognizeImage(body.imageDataUrl);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: "API not found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器错误" });
  }
}

async function serveStatic(url, res) {
  const requestPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const target = path.join(frontendDir, path.normalize(requestPath));
  const relative = path.relative(frontendDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await fs.readFile(target);
    res.writeHead(200, { "content-type": mimeTypes[path.extname(target)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

function parseBody(raw) {
  if (!raw) return {};
  return JSON.parse(raw);
}

function practiceInput(body, practice = {}) {
  const mode = body.mode || practice.mode || "all";
  const rawCount = Number(body.count);
  const count = rawCount > 0
    ? rawCount
    : isExamMode(mode)
      ? Number(practice.count) || 30
      : Number(practice.count) || 0;
  const rawTimeLimit = Number(body.timeLimitMinutes);
  const timeLimitMinutes = rawTimeLimit > 0
    ? rawTimeLimit
    : Number(practice.exam?.timeLimitMinutes) || 20;
  return { mode, count, timeLimitMinutes };
}

function applyPracticeConfig(course, input) {
  const practice = course.practice;
  practice.mode = input.mode;
  if ((input.mode === "count" || input.mode === "exam") && input.count > 0) {
    practice.count = input.count;
  }
  if (isExamMode(input.mode)) {
    const exam = ensureExamState(practice);
    exam.timeLimitMinutes = input.timeLimitMinutes;
  }
}

function startPracticeRound(course, input, { incrementRound = false } = {}) {
  applyPracticeConfig(course, input);
  const practice = course.practice;
  const ids = buildPracticeIds(course, input);
  practice.remainingIds = ids;
  practice.answeredInRound = 0;
  practice.correctInRound = 0;
  practice.currentQuestionId = null;
  practice.lastAnswer = null;
  if (incrementRound) practice.roundNo += practice.totalAnswered ? 1 : 0;

  if (isExamMode(input.mode)) {
    const exam = ensureExamState(practice);
    exam.timeLimitMinutes = input.timeLimitMinutes;
    exam.startedAt = new Date().toISOString();
    exam.finishedAt = "";
    exam.questionIds = ids;
    exam.answers = [];
    exam.lastSummary = null;
  }
}

function buildPracticeIds(course, input) {
  const questions = course.questions || [];

  if (input.mode === "wrong") {
    return getWrongPracticeQuestions(questions).map((question) => question.id);
  }
  if (input.mode === "exam") {
    return buildExamQuestionIds(questions, input.count);
  }
  if (input.mode === "exam-wrong") {
    const availableIds = new Set(questions.map((question) => question.id));
    return ensureExamState(course.practice).lastWrongIds.filter((id) => availableIds.has(id));
  }

  const allIds = questions.map((question) => question.id);
  if (input.mode === "count" && input.count > 0) {
    return shuffle(allIds).slice(0, Math.min(input.count, allIds.length));
  }
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

  const pendingWrong = getWrongPracticeQuestions(questions);
  const bookmarked = shuffle(questions.filter((question) => question.bookmarked));
  const unanswered = shuffle(questions.filter((question) => !question.wrongCount && !question.correctCount));
  const rest = shuffle(questions);

  add(pendingWrong);
  add(bookmarked);
  add(unanswered);
  add(rest);
  return selected;
}

function shouldAutoStartRound(practice, mode) {
  if (!isExamMode(mode)) return true;
  const exam = ensureExamState(practice);
  return !exam.startedAt || Boolean(exam.finishedAt) || !exam.questionIds.length;
}

function recordExamAnswer(practice, answer) {
  if (!isExamMode(practice.mode)) return;
  const exam = ensureExamState(practice);
  exam.answers.push({
    id: answer.id,
    questionId: answer.questionId,
    selectedAnswers: answer.selectedAnswers || [],
    correct: Boolean(answer.correct),
    answeredAt: answer.answeredAt
  });
}

function finishExam(course, { timedOut = false } = {}) {
  const practice = course.practice;
  const exam = ensureExamState(practice);
  const finishedAt = new Date().toISOString();
  const questionsById = new Map((course.questions || []).map((question) => [question.id, question]));
  const questionIds = (exam.questionIds || []).filter((id) => questionsById.has(id));
  const latestAnswers = new Map();
  for (const answer of exam.answers || []) {
    if (questionIds.includes(answer.questionId)) latestAnswers.set(answer.questionId, answer);
  }

  const wrongIds = [];
  let correct = 0;
  for (const questionId of questionIds) {
    const answer = latestAnswers.get(questionId);
    if (answer?.correct) {
      correct += 1;
    } else {
      wrongIds.push(questionId);
    }
  }

  const total = questionIds.length;
  const startedAt = exam.startedAt || finishedAt;
  const elapsedSeconds = Math.max(0, Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000));
  const summary = {
    id: createId("exam-summary"),
    mode: practice.mode,
    total,
    answered: latestAnswers.size,
    correct,
    wrong: wrongIds.length,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
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
  return summary;
}

function ensureExamState(practice) {
  practice.exam = {
    timeLimitMinutes: 20,
    startedAt: "",
    finishedAt: "",
    questionIds: [],
    answers: [],
    lastWrongIds: [],
    lastSummary: null,
    ...(practice.exam || {})
  };
  return practice.exam;
}

function isExamMode(mode) {
  return mode === "exam" || mode === "exam-wrong";
}

function buildImportResult(rawQuestions, existingQuestions = []) {
  const accepted = [];
  const rejected = [];
  const seen = new Set(existingQuestions.map(questionFingerprint));
  const seenStems = new Set(existingQuestions.map((question) => normalizeFingerprintText(question.stem)));
  const seenIds = new Set(existingQuestions.map((question) => question.id).filter(Boolean));

  rawQuestions.forEach((rawQuestion, index) => {
    const question = normalizeQuestion(rawQuestion);
    const reason = validateQuestion(question);
    if (reason) {
      rejected.push({
        index: index + 1,
        reason,
        stem: question.stem || String(rawQuestion?.stem || "").slice(0, 80)
      });
      return;
    }

    const fingerprint = questionFingerprint(question);
    const stemKey = normalizeFingerprintText(question.stem);
    if (seenIds.has(question.id) || seen.has(fingerprint) || seenStems.has(stemKey)) {
      rejected.push({
        index: index + 1,
        reason: "重复题目，已跳过",
        stem: question.stem
      });
      return;
    }

    seenIds.add(question.id);
    seen.add(fingerprint);
    seenStems.add(stemKey);
    accepted.push(question);
  });

  return {
    total: rawQuestions.length,
    accepted,
    rejected
  };
}

function questionFingerprint(question) {
  const stem = normalizeFingerprintText(question.stem);
  const type = question.type || "choice";
  if (type === "fill-blank") {
    const answer = (question.answer || [])
      .map((item) => String(item).trim().toLowerCase())
      .sort()
      .join(",");
    return `fill-blank|${stem}|${answer}`;
  }
  const options = (question.options || [])
    .map((option) => `${String(option.key || "").trim().toUpperCase()}:${normalizeFingerprintText(option.text)}`)
    .join("|");
  const answer = getChoiceAnswerTexts(question)
    .map((item) => normalizeChoiceText(item))
    .sort()
    .join(",");

  return `choice|${stem}|${options}|${answer}`;
}

function normalizeFingerprintText(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[。．.]/g, "")
    .trim()
    .toLowerCase();
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
