import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { frontendDir } from "./config.js";
import { applyStudyNotesToState } from "./services/StudyNoteGenerator.js";
import { compactStatePayload } from "./repositories/StateShape.js";
import {
  areChoiceAnswerSetsEqual,
  areFillBlankAnswersCorrect,
  createId,
  getChoiceAnswerTexts,
  getWrongPracticeQuestions,
  httpError,
  normalizeChoiceText,
  normalizeQuestion,
  readBody,
  restoreAnsweredIds,
  sendBody,
  sendJson,
  updateQuestionReview,
  validateQuestion
} from "./utils.js";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const PRACTICE_MODES = new Set(["all", "count", "wrong", "exam", "exam-wrong"]);
const staticCache = new Map();
const STATIC_CACHE_LIMIT = 32;
const gzipAsync = promisify(zlib.gzip);

export function createRouter({ repository, aiService }) {
  return async function route(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);

      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, repository, aiService);
        return;
      }

      await serveStatic(req, res, url);
    } catch (error) {
      await sendJson(req, res, error.statusCode || 500, { error: error.message || "服务器错误" });
    }
  };
}

async function handleApi(req, res, url, repository, aiService) {
  try {
    const body = req.method === "POST" ? parseBody(await readBody(req)) : {};

    if (req.method === "GET" && url.pathname === "/api/state") {
      const state = await repository.readState();
      await sendJson(req, res, 200, state);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/export") {
      const state = await repository.readState();
      await sendJson(req, res, 200, state);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      const state = await repository.readState();
      const revision = repository.getRevision();
      await sendJson(req, res, 200, compactStatePayload(state, revision));
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/explanations") {
      const state = await repository.readState();
      const courseId = url.searchParams.get("courseId") || state.activeCourseId;
      const course = state.courses.find((item) => item.id === courseId);
      if (!course) throw httpError(404, "课程不存在");
      const explanations = {};
      for (const question of course.questions || []) {
        if (!question.explanation && !question.memoryTip) continue;
        explanations[question.id] = {
          explanation: question.explanation || "",
          memoryTip: question.memoryTip || ""
        };
      }
      await sendJson(req, res, 200, {
        revision: repository.getRevision(),
        courseId,
        explanations
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/backups") {
      await sendJson(req, res, 200, { backups: await repository.listBackups() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/study-notes/generate") {
      let result = null;
      const state = await repository.update((draft) => {
        result = applyStudyNotesToState(draft, { overwrite: Boolean(body.overwrite) });
      });
      await sendJson(req, res, 200, {
        revision: repository.getRevision(),
        state: compactStatePayload(state, repository.getRevision()),
        result
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses") {
      const state = await repository.update((draft) => {
        const course = repository.createCourse(String(body.name || "").trim() || "新课程");
        draft.courses.push(course);
        draft.activeCourseId = course.id;
      });
      await sendJson(req, res, 200, compactStatePayload(state, repository.getRevision()));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses/active") {
      const lightResponse = url.searchParams.get("light") === "1";
      const result = await repository.setActiveCourse(body.courseId, { includeCourse: !lightResponse });
      if (!result) throw httpError(404, "课程不存在");
      const course = result.course
        ? {
          ...result.course,
          practice: {
            ...result.course.practice,
            answeredIds: restoreAnsweredIds(result.course.practice, result.course.questions)
          }
        }
        : null;
      await sendJson(req, res, 200, lightResponse
        ? { revision: result.revision, activeCourseId: result.activeCourseId }
        : { revision: result.revision, activeCourseId: result.activeCourseId, course });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/courses/delete") {
      const state = await repository.update((draft) => {
        if (draft.courses.length <= 1) return false;
        if (!draft.courses.some((course) => course.id === body.courseId)) return false;
        draft.courses = draft.courses.filter((course) => course.id !== body.courseId);
        draft.activeCourseId = draft.courses[0].id;
      });
      await sendJson(req, res, 200, compactStatePayload(state, repository.getRevision()));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions") {
      let importResult = null;
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        importResult = buildImportResult(body.questions || [], course.questions);
        course.questions.push(...importResult.accepted);
      });
      await sendJson(req, res, 200, {
        ...compactStatePayload(state, repository.getRevision()),
        importResult
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/delete") {
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        course.questions = course.questions.filter((question) => question.id !== body.questionId);
        removeQuestionReferences(course.practice, body.questionId);
      });
      await sendJson(req, res, 200, compactStatePayload(state, repository.getRevision()));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/update") {
      const { questionId, stem, options, answer, explanation, memoryTip } = body;
      const lightResponse = url.searchParams.get("light") === "1";
      if (!questionId) {
        await sendJson(req, res, 400, { error: "缺少题目 ID" });
        return;
      }
      const state = await repository.update((draft) => {
        const result = repository.updateQuestion(draft, questionId, { stem, options, answer, explanation, memoryTip });
        if (!result) throw httpError(404, "题目不存在");
      });
      await sendJson(req, res, 200, lightResponse
        ? { revision: repository.getRevision(), questionId }
        : compactStatePayload(state, repository.getRevision()));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/questions/bookmark") {
      const { questionId } = body;
      if (!questionId) {
        await sendJson(req, res, 400, { error: "缺少题目 ID" });
        return;
      }
      let bookmarked = false;
      const result = await repository.updateAnswer(body.courseId || null, questionId, (view) => {
        const course = repository.getActiveCourse(view);
        const question = course.questions.find((item) => item.id === questionId);
        if (!question) throw httpError(404, "题目不存在");
        question.bookmarked = !question.bookmarked;
        bookmarked = question.bookmarked;
      }, { operationId: body.operationId || "" });
      if (!result) throw httpError(404, "课程不存在");
      if (result.missingQuestion) throw httpError(404, "题目不存在");
      await sendJson(req, res, 200, {
        revision: result.revision,
        courseId: result.courseId,
        question: { id: questionId, bookmarked: result.question ? Boolean(result.question.bookmarked) : bookmarked }
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/next") {
      let currentQuestion = null;
      const result = await repository.updatePractice(body.courseId || null, (view) => {
        const course = repository.getActiveCourse(view);
        course.practice.answeredIds = restoreAnsweredIds(course.practice, course.questions);
        const input = practiceInput(body, course.practice);
        const modeChanged = input.mode !== course.practice.mode;
        applyPracticeConfig(course, input);

        if (modeChanged) {
          startPracticeRound(course, input, { incrementRound: true });
        } else {
          ensureRoundTotal(course.practice);
          if (!course.practice.remainingIds.length && shouldAutoStartRound(course.practice, input.mode)) {
            startPracticeRound(course, input, { incrementRound: true });
          }
        }

        if (course.practice.currentQuestionId) {
          course.practice.historyIds.push(course.practice.currentQuestionId);
        }
        course.practice.currentQuestionId = course.practice.remainingIds.shift() || null;
        course.practice.lastAnswer = null;
        currentQuestion = findQuestion(course, course.practice.currentQuestionId);
      }, { operationId: body.operationId || "", needStats: true });
      if (!result) throw httpError(404, "课程不存在");
      await sendJson(req, res, 200, withQuestionNotes(practicePayload(result), currentQuestion));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/answer") {
      if (!body.questionId) {
        await sendJson(req, res, 400, { error: "缺少题目 ID" });
        return;
      }
      let answerResult = null;
      let answeredQuestion = null;
      const result = await repository.updateAnswer(
        body.courseId || null,
        body.questionId,
        (view) => {
          const course = repository.getActiveCourse(view);
          const question = course.questions.find((item) => item.id === body.questionId);
          if (!question) throw httpError(404, "题目不存在");
          const practice = course.practice;

          practice.answeredIds = restoreAnsweredIds(practice, course.questions);
          if (practice.answeredIds.includes(question.id)) {
            answerResult = {
              accepted: false,
              message: "这道题本轮已经作答",
              correctAnswer: question.answer
            };
            return false;
          }
          if (practice.lastAnswer?.questionId === question.id) {
            answerResult = {
              accepted: false,
              message: "这道题已经提交过",
              ...practice.lastAnswer,
              correctAnswer: question.answer
            };
            return false;
          }
          const reachable = question.id === practice.currentQuestionId
            || practice.historyIds.includes(question.id);
          if (!reachable) {
            answerResult = {
              accepted: false,
              message: "题目不在本轮",
              correctAnswer: question.answer
            };
            return false;
          }

          let correct;
          let selectedAnswers;
          if (question.type === "fill-blank") {
            selectedAnswers = (body.selectedAnswers || []).map((item) => String(item).trim());
            correct = areFillBlankAnswersCorrect(question, selectedAnswers);
          } else {
            selectedAnswers = getChoiceAnswerTexts(question, body.selectedAnswers || []);
            correct = areChoiceAnswerSetsEqual(question, selectedAnswers);
          }

          practice.answeredInRound += 1;
          practice.totalAnswered += 1;
          const answeredAt = new Date().toISOString();
          if (correct) {
            practice.correctInRound += 1;
            practice.totalCorrect += 1;
            question.correctCount = (question.correctCount || 0) + 1;
          } else {
            question.wrongCount = (question.wrongCount || 0) + 1;
          }
          updateQuestionReview(question, { correct, selectedAnswers, answeredAt });
          practice.answeredIds.push(question.id);
          practice.lastAnswer = {
            id: createId("answer"),
            questionId: question.id,
            selectedAnswers,
            correct,
            answeredAt
          };
          recordExamAnswer(practice, practice.lastAnswer);
          answeredQuestion = question;
          answerResult = {
            accepted: true,
            ...practice.lastAnswer,
            correctAnswer: question.answer
          };
        },
        { operationId: body.operationId || "" }
      );

      if (!result) throw httpError(404, "课程不存在");
      if (result.missingQuestion) throw httpError(404, "题目不存在");
      if (result.duplicate) {
        await sendJson(req, res, 200, {
          ...practicePayload(result),
          answerResult: { accepted: true, duplicate: true }
        });
        return;
      }

      const payload = {
        ...practicePayload(result),
        answerResult
      };
      if (answeredQuestion) payload.question = questionState(answeredQuestion);
      await sendJson(req, res, 200, payload);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/reset-round") {
      const result = await repository.updatePractice(body.courseId || null, (view) => {
        const course = repository.getActiveCourse(view);
        startPracticeRound(course, practiceInput(body, course.practice));
      }, { operationId: body.operationId || "", needStats: true });
      if (!result) throw httpError(404, "课程不存在");
      await sendJson(req, res, 200, practicePayload(result));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/finish-exam") {
      let summary = null;
      const result = await repository.updatePractice(body.courseId || null, (view) => {
        const course = repository.getActiveCourse(view);
        course.practice.answeredIds = restoreAnsweredIds(course.practice, course.questions);
        summary = finishExam(course, { timedOut: Boolean(body.timedOut) });
      }, { operationId: body.operationId || "", needStats: true });
      if (!result) throw httpError(404, "课程不存在");
      await sendJson(req, res, 200, {
        ...practicePayload(result),
        summary: summary || result.practice.exam?.lastSummary || null
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/prev") {
      let currentQuestion = null;
      const result = await repository.updatePractice(body.courseId || null, (view) => {
        const course = repository.getActiveCourse(view);
        const practice = course.practice;
        practice.answeredIds = restoreAnsweredIds(practice, course.questions);
        if (!practice.historyIds.length) return false;
        const previousId = practice.historyIds.pop();
        if (practice.currentQuestionId) practice.remainingIds.unshift(practice.currentQuestionId);
        practice.currentQuestionId = previousId;
        practice.lastAnswer = null;
        currentQuestion = findQuestion(course, practice.currentQuestionId);
      }, { operationId: body.operationId || "", needStats: true });
      if (!result) throw httpError(404, "课程不存在");
      await sendJson(req, res, 200, withQuestionNotes(practicePayload(result), currentQuestion));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/recognize-image") {
      const result = await aiService.recognizeImage(body.imageDataUrl);
      await sendJson(req, res, 200, result);
      return;
    }

    await sendJson(req, res, 404, { error: "API not found" });
  } catch (error) {
    await sendJson(req, res, error.statusCode || 500, { error: error.message || "服务器错误" });
  }
}

async function serveStatic(req, res, url) {
  let requestPath;
  try {
    requestPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    await sendJson(req, res, 400, { error: "非法的请求路径" });
    return;
  }

  const target = path.join(frontendDir, path.normalize(requestPath));
  const relative = path.relative(frontendDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    await sendBody(req, res, 403, "text/plain; charset=utf-8", Buffer.from("Forbidden", "utf8"));
    return;
  }

  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    await sendBody(req, res, 404, "text/plain; charset=utf-8", Buffer.from("Not found", "utf8"));
    return;
  }
  if (!stat.isFile()) {
    await sendBody(req, res, 404, "text/plain; charset=utf-8", Buffer.from("Not found", "utf8"));
    return;
  }

  const etag = `W/"${stat.size}-${Math.round(stat.mtimeMs)}"`;
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, { etag, "cache-control": "no-cache" });
    res.end();
    return;
  }

  let cached = staticCache.get(target);
  if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
    const content = await fs.readFile(target);
    cached = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      content,
      compressed: content.length >= 1024 ? await gzipAsync(content) : null
    };
    staticCache.set(target, cached);
    if (staticCache.size > STATIC_CACHE_LIMIT) {
      staticCache.delete(staticCache.keys().next().value);
    }
  }

  const contentType = mimeTypes[path.extname(target)] || "application/octet-stream";
  const headers = { etag, "cache-control": "no-cache" };
  if (cached.compressed && acceptsGzip(req)) {
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
    res.writeHead(200, { "content-type": contentType, ...headers });
    res.end(cached.compressed);
    return;
  }
  res.writeHead(200, { "content-type": contentType, ...headers });
  res.end(cached.content);
}

function parseBody(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "请求体不是合法 JSON");
  }
}

function acceptsGzip(req) {
  return /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
}

function practicePayload(result) {
  return {
    revision: result.revision,
    courseId: result.courseId,
    practice: result.practice,
    duplicate: Boolean(result.duplicate)
  };
}

function practiceInput(body, practice = {}) {
  const mode = normalizePracticeMode(body.mode || practice.mode || "all");
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

function normalizePracticeMode(mode) {
  return PRACTICE_MODES.has(mode) ? mode : "all";
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
  practice.remainingIds = [...ids];
  practice.answeredInRound = 0;
  practice.correctInRound = 0;
  practice.currentQuestionId = null;
  practice.lastAnswer = null;
  practice.roundTotal = ids.length;
  practice.answeredIds = [];
  practice.historyIds = [];
  if (incrementRound) practice.roundNo += practice.totalAnswered ? 1 : 0;

  if (isExamMode(input.mode)) {
    const exam = ensureExamState(practice);
    exam.timeLimitMinutes = input.timeLimitMinutes;
    exam.startedAt = new Date().toISOString();
    exam.finishedAt = "";
    exam.questionIds = [...ids];
    exam.answers = [];
    exam.lastSummary = null;
  }
}

function ensureRoundTotal(practice) {
  if (Number(practice.roundTotal) > 0) return;
  const currentSubmitted = practice.lastAnswer?.questionId
    && practice.lastAnswer.questionId === practice.currentQuestionId;
  practice.roundTotal = (Number(practice.answeredInRound) || 0)
    + (Array.isArray(practice.remainingIds) ? practice.remainingIds.length : 0)
    + (practice.currentQuestionId && !currentSubmitted ? 1 : 0);
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
  const questionIdSet = new Set(questionIds);
  const latestAnswers = new Map();
  for (const answer of exam.answers || []) {
    if (questionIdSet.has(answer.questionId)) latestAnswers.set(answer.questionId, answer);
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
  practice.historyIds = [];
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

function removeQuestionReferences(practice, questionId) {
  practice.remainingIds = practice.remainingIds.filter((id) => id !== questionId);
  practice.historyIds = practice.historyIds.filter((id) => id !== questionId);
  practice.answeredIds = practice.answeredIds.filter((id) => id !== questionId);
  if (practice.currentQuestionId === questionId) practice.currentQuestionId = null;
  practice.exam.questionIds = practice.exam.questionIds.filter((id) => id !== questionId);
  practice.exam.answers = practice.exam.answers.filter((answer) => answer?.questionId !== questionId);
  practice.exam.lastWrongIds = practice.exam.lastWrongIds.filter((id) => id !== questionId);
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

function findQuestion(course, questionId) {
  if (!questionId) return null;
  return (course.questions || []).find((question) => question.id === questionId) || null;
}

function withQuestionNotes(payload, question) {
  if (!question) return payload;
  return {
    ...payload,
    question: {
      id: question.id,
      explanation: question.explanation || "",
      memoryTip: question.memoryTip || ""
    }
  };
}

function questionState(question) {
  return {
    id: question.id,
    wrongCount: question.wrongCount,
    correctCount: question.correctCount,
    review: question.review,
    explanation: question.explanation || "",
    memoryTip: question.memoryTip || ""
  };
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
