import fs from "node:fs/promises";
import path from "node:path";
import { frontendDir } from "./config.js";
import { createId, normalizeQuestion, readBody, sendJson, validateQuestion } from "./utils.js";

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
      const state = await repository.update((draft) => {
        if (draft.courses.some((course) => course.id === body.courseId)) {
          draft.activeCourseId = body.courseId;
        }
      });
      sendJson(res, 200, state);
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
      const { questionId, stem, options, answer, explanation } = body;
      if (!questionId) {
        sendJson(res, 400, { error: "缺少题目 ID" });
        return;
      }
      const state = await repository.update((draft) => {
        const result = repository.updateQuestion(draft, questionId, { stem, options, answer, explanation });
        if (!result) throw new Error("题目不存在");
      });
      sendJson(res, 200, state);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/practice/next") {
      const state = await repository.update((draft) => {
        const course = repository.getActiveCourse(draft);
        const mode = body.mode || course.practice.mode || "all";
        const count = Number(body.count) || course.practice.count || 0;

        // 记录当前模式到 practice 中
        course.practice.mode = mode;
        if (mode === "count" && count > 0) {
          course.practice.count = count;
        }

        if (!course.practice.remainingIds.length) {
          const allIds = course.questions.map((question) => question.id);
          if (mode === "count" && count > 0) {
            // 指定数量模式：随机抽取 count 道题
            const shuffled = shuffle(allIds);
            course.practice.remainingIds = shuffled.slice(0, Math.min(count, shuffled.length));
          } else {
            // 全部模式：打乱所有题目
            course.practice.remainingIds = shuffle(allIds);
          }
          course.practice.roundNo += course.practice.totalAnswered ? 1 : 0;
          course.practice.answeredInRound = 0;
          course.practice.correctInRound = 0;
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
          selectedAnswers = (body.selectedAnswers || [])
            .map((item) => String(item).toUpperCase())
            .sort();
          const correctAnswers = [...question.answer].sort();
          correct = selectedAnswers.length === correctAnswers.length
            && selectedAnswers.every((item, index) => item === correctAnswers[index]);
        }
        course.practice.answeredInRound += 1;
        course.practice.totalAnswered += 1;
        if (correct) {
          course.practice.correctInRound += 1;
          course.practice.totalCorrect += 1;
          question.correctCount = (question.correctCount || 0) + 1;
        } else {
          question.wrongCount = (question.wrongCount || 0) + 1;
        }
        course.practice.lastAnswer = {
          id: createId("answer"),
          questionId: question.id,
          selectedAnswers,
          correct,
          answeredAt: new Date().toISOString()
        };
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
        const mode = body.mode || course.practice.mode || "all";
        const count = Number(body.count) || course.practice.count || 0;

        course.practice.mode = mode;
        if (mode === "count" && count > 0) {
          course.practice.count = count;
        }

        const allIds = course.questions.map((question) => question.id);
        if (mode === "count" && count > 0) {
          const shuffled = shuffle(allIds);
          course.practice.remainingIds = shuffled.slice(0, Math.min(count, shuffled.length));
        } else {
          course.practice.remainingIds = shuffle(allIds);
        }
        course.practice.answeredInRound = 0;
        course.practice.correctInRound = 0;
        course.practice.currentQuestionId = null;
        course.practice.lastAnswer = null;
      });
      sendJson(res, 200, state);
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
  const answer = (question.answer || [])
    .map((item) => String(item).trim().toUpperCase())
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
