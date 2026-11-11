import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRouter } from "../src/routes.js";
import { buildStudyNotes, stripMemoryTipLabel } from "../src/services/StudyNoteGenerator.js";
import { normalizeQuestion } from "../src/utils.js";
import {
  applyLocalPracticeConfig,
  examQuestionTotal,
  isPracticeRoundComplete,
  roundQuestionTotal,
  roundRemainingCount,
  shouldAutoNextAfterSubmit,
  stripMemoryTipLabel as stripRenderedMemoryTipLabel
} from "../../frontend/src/utils/practiceFlow.js";

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
    exam: {
      timeLimitMinutes: 20,
      startedAt: "",
      finishedAt: "",
      questionIds: [],
      answers: [],
      lastWrongIds: [],
      lastSummary: null
    }
  };
}

function createState() {
  return {
    activeCourseId: "course-1",
    courses: [
      {
        id: "course-1",
        name: "test course",
        questions: [
          choiceQuestion({ id: "wrong-only", stem: "wrong only", wrongCount: 1, correctCount: 0 }),
          choiceQuestion({ id: "wrong-then-correct", stem: "wrong then correct", wrongCount: 2, correctCount: 3 }),
          choiceQuestion({ id: "bookmarked", stem: "bookmarked", bookmarked: true, wrongCount: 0, correctCount: 0 }),
          choiceQuestion({ id: "unanswered", stem: "unanswered", wrongCount: 0, correctCount: 0 }),
          choiceQuestion({
            id: "mastered-wrong",
            stem: "mastered wrong",
            wrongCount: 3,
            correctCount: 2,
            review: { masteredAt: "2026-01-02T00:00:00.000Z", consecutiveCorrect: 2 }
          }),
          choiceQuestion({ id: "correct-only", stem: "correct only", wrongCount: 0, correctCount: 4 })
        ],
        practice: emptyPractice(),
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

function choiceQuestion(overrides) {
  return {
    type: "choice",
    options: [
      { key: "A", text: "Alpha" },
      { key: "B", text: "Beta" }
    ],
    answer: ["Alpha"],
    review: {},
    ...overrides
  };
}

function createLargeExamState(total = 40) {
  const questions = Array.from({ length: total }, (_, index) => choiceQuestion({
    id: `q-${index + 1}`,
    stem: `question ${index + 1}`,
    wrongCount: index < 5 ? 1 : 0,
    correctCount: 0
  }));
  questions[10].bookmarked = true;

  return {
    activeCourseId: "course-large",
    courses: [
      {
        id: "course-large",
        name: "large course",
        questions,
        practice: emptyPractice(),
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

class MemoryRepository {
  constructor(state) {
    this.state = clone(state);
  }

  async getState() {
    return clone(this.state);
  }

  async update(mutator) {
    const draft = clone(this.state);
    await mutator(draft);
    this.state = draft;
    return this.getState();
  }

  getActiveCourse(state) {
    return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
  }

  createCourse(name) {
    return {
      id: `course-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name,
      questions: [],
      practice: emptyPractice(),
      createdAt: new Date().toISOString()
    };
  }

  updateQuestion(state, questionId, data) {
    const course = state.courses.find((item) => item.questions.some((question) => question.id === questionId));
    if (!course) return null;
    const index = course.questions.findIndex((question) => question.id === questionId);
    course.questions[index] = {
      ...course.questions[index],
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))
    };
    return course.questions[index];
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function postPractice(path, body) {
  const repository = new MemoryRepository(createState());
  const router = createRouter({ repository, aiService: {} });
  const server = http.createServer(router);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    return payload;
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function withServer(state, callback) {
  const repository = new MemoryRepository(state);
  const router = createRouter({ repository, aiService: {} });
  const server = http.createServer(router);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;
    const request = async (path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    return await callback(request, repository, baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("wrong reset-round includes pending wrong questions only", async () => {
  const payload = await postPractice("/api/practice/reset-round", { mode: "wrong" });

  assert.deepEqual([...payload.practice.remainingIds].sort(), ["wrong-only", "wrong-then-correct"]);
});

test("wrong next prioritizes pending wrong questions", async () => {
  const { practice } = await postPractice("/api/practice/next", { mode: "wrong" });
  const roundIds = [practice.currentQuestionId, ...practice.remainingIds].filter(Boolean);

  assert.deepEqual(roundIds, ["wrong-then-correct", "wrong-only"]);
});

test("practice endpoints return a practice patch instead of the full state", async () => {
  const payload = await postPractice("/api/practice/next", { mode: "all" });

  assert.equal(payload.courseId, "course-1");
  assert.ok(payload.practice.currentQuestionId);
  assert.equal(payload.courses, undefined);
});

test("wrong answer resets review progress and clears mastered flag", async () => {
  const payload = await postPractice("/api/practice/answer", {
    questionId: "mastered-wrong",
    selectedAnswers: ["Beta"]
  });
  const question = payload.question;

  assert.equal(payload.answerResult.correct, false);
  assert.equal(question.wrongCount, 4);
  assert.equal(question.review.consecutiveCorrect, 0);
  assert.equal(question.review.masteredAt, "");
  assert.deepEqual(question.review.lastSelectedAnswers, ["Beta"]);
  assert.ok(question.review.lastWrongAt);
});

test("wrong question becomes mastered after two consecutive correct answers", async () => {
  const state = createState();
  const question = state.courses[0].questions.find((item) => item.id === "wrong-only");
  question.review = { consecutiveCorrect: 1 };
  const repository = new MemoryRepository(state);
  const router = createRouter({ repository, aiService: {} });
  const server = http.createServer(router);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/practice/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId: "wrong-only", selectedAnswers: ["Alpha"] })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));
    const updated = payload.question;

    assert.equal(payload.answerResult.correct, true);
    assert.equal(updated.correctCount, 1);
    assert.equal(updated.review.consecutiveCorrect, 2);
    assert.ok(updated.review.masteredAt);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("memoryTip survives normalization and update route", async () => {
  const normalized = normalizeQuestion(choiceQuestion({
    id: "memory",
    stem: "memory tip question",
    explanation: "short explanation",
    memoryTip: "quick cue"
  }));

  assert.equal(normalized.memoryTip, "quick cue");

  await withServer(createState(), async (request) => {
    const state = await request("/api/questions/update", {
      questionId: "wrong-only",
      explanation: "updated explanation",
      memoryTip: "updated cue"
    });
    const question = state.courses[0].questions.find((item) => item.id === "wrong-only");

    assert.equal(question.explanation, "updated explanation");
    assert.equal(question.memoryTip, "updated cue");
  });
});

test("study note generator creates explanation and memory tip", () => {
  const fillBlank = normalizeQuestion({
    id: "fill",
    type: "fill-blank",
    stem: "全面推进依法治国的总抓手是（）。",
    options: [],
    answer: ["建设中国特色社会主义法治体系"]
  });
  const multi = normalizeQuestion(choiceQuestion({
    id: "multi",
    stem: "多选题考察并列要点",
    answer: ["Alpha", "Beta"]
  }));

  const fillNotes = buildStudyNotes(fillBlank, "法治");
  const multiNotes = buildStudyNotes(multi, "测试");

  assert.match(fillNotes.explanation, /建设中国特色社会主义法治体系/);
  assert.doesNotMatch(fillNotes.memoryTip, /^速记[：:]/);
  assert.match(multiNotes.explanation, /多选/);
  assert.match(multiNotes.memoryTip, /Alpha\+Beta/);
});

test("study note generator strips duplicated memory labels and expands short cues", () => {
  assert.equal(stripMemoryTipLabel("速记：速记：保证 -> 作风优良"), "保证 -> 作风优良");
  assert.equal(stripRenderedMemoryTipLabel("速记：速记：保证 -> 作风优良"), "保证 -> 作风优良");

  const notes = buildStudyNotes(normalizeQuestion({
    id: "short-cue",
    type: "fill-blank",
    stem: "党在新时代的强军目标中，（）是保证。",
    options: [],
    answer: ["作风优良"]
  }), "习思想");

  assert.doesNotMatch(notes.memoryTip, /^速记[：:]/);
  assert.doesNotMatch(notes.memoryTip, /速记[：:]\s*速记[：:]/);
  assert.match(notes.memoryTip, /是保证/);
});

test("exam reset prioritizes pending wrong questions", async () => {
  const { practice } = await postPractice("/api/practice/reset-round", { mode: "exam", count: 3, timeLimitMinutes: 20 });
  const roundIds = practice.exam.questionIds;

  assert.equal(practice.mode, "exam");
  assert.deepEqual(roundIds.slice(0, 2), ["wrong-then-correct", "wrong-only"]);
  assert.equal(roundIds.length, 3);
  assert.equal(practice.exam.timeLimitMinutes, 20);
});

test("exam reset creates 30 unique question ids when enough questions exist", async () => {
  await withServer(createLargeExamState(40), async (request) => {
    const payload = await request("/api/practice/reset-round", { mode: "exam", count: 30, timeLimitMinutes: 20 });
    const questionIds = payload.practice.exam.questionIds;

    assert.equal(questionIds.length, 30);
    assert.equal(new Set(questionIds).size, 30);
    assert.deepEqual(questionIds.slice(0, 5), ["q-1", "q-2", "q-3", "q-4", "q-5"]);
  });
});

test("exam next consumes one server question per call without early exhaustion", async () => {
  await withServer(createLargeExamState(40), async (request) => {
    await request("/api/practice/reset-round", { mode: "exam", count: 30, timeLimitMinutes: 20 });

    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      const payload = await request("/api/practice/next", { mode: "exam", count: 30, timeLimitMinutes: 20 });
      const practice = payload.practice;
      assert.ok(practice.currentQuestionId, `missing current question at step ${i + 1}`);
      seen.push(practice.currentQuestionId);
      assert.equal(examQuestionTotal(practice, 30), 30);
    }

    assert.equal(new Set(seen).size, 30);

    const exhausted = await request("/api/practice/next", { mode: "exam", count: 30, timeLimitMinutes: 20 });
    const practice = exhausted.practice;
    assert.equal(practice.currentQuestionId, null);
    assert.equal(practice.remainingIds.length, 0);
    assert.equal(examQuestionTotal(practice, 30), 30);
  });
});

test("auto next is disabled on the final question", () => {
  assert.equal(shouldAutoNextAfterSubmit({
    correct: true,
    autoNext: true,
    practice: { remainingIds: [] }
  }), false);

  assert.equal(shouldAutoNextAfterSubmit({
    correct: true,
    autoNext: true,
    practice: { remainingIds: ["next-id"] }
  }), true);
});

test("practice round helpers distinguish reset start from submitted finish", () => {
  const resetStart = {
    mode: "exam",
    count: 2,
    remainingIds: ["q-1", "q-2"],
    answeredInRound: 0,
    currentQuestionId: null,
    lastAnswer: null,
    exam: { questionIds: ["q-1", "q-2"] }
  };
  assert.equal(roundQuestionTotal(resetStart, 2), 2);
  assert.equal(roundRemainingCount(resetStart, 2), 2);
  assert.equal(isPracticeRoundComplete(resetStart, 2), false);

  const submittedFinish = {
    mode: "count",
    count: 2,
    remainingIds: [],
    answeredInRound: 2,
    currentQuestionId: "q-2",
    lastAnswer: { questionId: "q-2", correct: true }
  };
  assert.equal(roundQuestionTotal(submittedFinish, 2), 2);
  assert.equal(roundRemainingCount(submittedFinish, 2), 0);
  assert.equal(isPracticeRoundComplete(submittedFinish, 2), true);
});

test("local practice config stages mode changes without carrying old round state", () => {
  const practice = {
    mode: "all",
    count: 10,
    remainingIds: ["old-next"],
    answeredInRound: 4,
    correctInRound: 3,
    currentQuestionId: "old-current",
    lastAnswer: { questionId: "old-current", correct: true },
    exam: {
      timeLimitMinutes: 20,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "",
      questionIds: ["old-current", "old-next"],
      answers: [{ questionId: "old-current", correct: true }],
      lastWrongIds: ["last-wrong"],
      lastSummary: { wrongIds: ["last-wrong"] }
    }
  };

  applyLocalPracticeConfig(practice, { mode: "exam", count: 30, timeLimitMinutes: 15 });

  assert.equal(practice.mode, "exam");
  assert.equal(practice.count, 30);
  assert.deepEqual(practice.remainingIds, []);
  assert.equal(practice.answeredInRound, 0);
  assert.equal(practice.correctInRound, 0);
  assert.equal(practice.currentQuestionId, null);
  assert.equal(practice.lastAnswer, null);
  assert.equal(practice.exam.timeLimitMinutes, 15);
  assert.equal(practice.exam.startedAt, "");
  assert.deepEqual(practice.exam.questionIds, []);
  assert.deepEqual(practice.exam.answers, []);
  assert.deepEqual(practice.exam.lastWrongIds, ["last-wrong"]);

  applyLocalPracticeConfig(practice, { mode: "all", count: 30, timeLimitMinutes: 15 });
  assert.equal(practice.mode, "all");
  assert.equal(practice.count, 0);
});

test("finish-exam returns summary and exam-wrong uses last wrong ids", async () => {
  await withServer(createState(), async (request) => {
    const reset = await request("/api/practice/reset-round", { mode: "exam", count: 3, timeLimitMinutes: 20 });
    const roundIds = reset.practice.exam.questionIds;

    await request("/api/practice/answer", {
      questionId: roundIds[0],
      selectedAnswers: ["Alpha"]
    });
    const finished = await request("/api/practice/finish-exam", {});
    const summary = finished.summary;

    assert.equal(summary.total, 3);
    assert.equal(summary.answered, 1);
    assert.equal(summary.correct, 1);
    assert.equal(summary.wrong, 2);
    assert.deepEqual([...summary.wrongIds].sort(), [...roundIds.slice(1)].sort());

    const review = await request("/api/practice/reset-round", { mode: "exam-wrong" });
    assert.deepEqual([...review.practice.remainingIds].sort(), [...summary.wrongIds].sort());
  });
});

test("bookmark toggles on and off", async () => {
  await withServer(createState(), async (request) => {
    const added = await request("/api/questions/bookmark", { questionId: "unanswered" });
    assert.equal(added.question.id, "unanswered");
    assert.equal(added.question.bookmarked, true);

    const removed = await request("/api/questions/bookmark", { questionId: "unanswered" });
    assert.equal(removed.question.bookmarked, false);
  });
});

test("switching practice mode starts a fresh round instead of reusing old ids", async () => {
  const state = createState();
  state.courses[0].practice.mode = "all";
  state.courses[0].practice.remainingIds = ["unanswered", "bookmarked"];

  await withServer(state, async (request) => {
    const wrong = await request("/api/practice/next", { mode: "wrong" });
    assert.equal(wrong.practice.mode, "wrong");
    assert.equal(wrong.practice.currentQuestionId, "wrong-then-correct");
    assert.deepEqual(wrong.practice.remainingIds, ["wrong-only"]);

    const exam = await request("/api/practice/next", { mode: "exam", count: 3, timeLimitMinutes: 20 });
    assert.equal(exam.practice.mode, "exam");
    assert.ok(exam.practice.exam.startedAt);
    assert.equal(exam.practice.exam.questionIds.length, 3);
    assert.ok(exam.practice.exam.questionIds.includes(exam.practice.currentQuestionId));
  });
});

test("duplicate answer is rejected without changing counters", async () => {
  await withServer(createState(), async (request) => {
    const first = await request("/api/practice/answer", { questionId: "unanswered", selectedAnswers: ["Alpha"] });
    assert.equal(first.answerResult.accepted, true);

    const second = await request("/api/practice/answer", { questionId: "unanswered", selectedAnswers: ["Alpha"] });
    assert.equal(second.answerResult.accepted, false);
    assert.equal(second.practice.totalAnswered, first.practice.totalAnswered);
    assert.equal(second.question, undefined);
  });
});

test("delete question clears round references", async () => {
  const state = createState();
  const practice = state.courses[0].practice;
  practice.remainingIds = ["unanswered", "wrong-only"];
  practice.currentQuestionId = "unanswered";

  await withServer(state, async (request) => {
    const result = await request("/api/questions/delete", { questionId: "unanswered" });
    const course = result.courses[0];

    assert.equal(course.questions.some((question) => question.id === "unanswered"), false);
    assert.deepEqual(course.practice.remainingIds, ["wrong-only"]);
    assert.equal(course.practice.currentQuestionId, null);
  });
});

test("courses can be added and deleted, last course is kept", async () => {
  await withServer(createState(), async (request) => {
    const added = await request("/api/courses", { name: "第二门课" });
    assert.equal(added.courses.length, 2);
    assert.equal(added.activeCourseId, added.courses[1].id);

    const deleted = await request("/api/courses/delete", { courseId: added.courses[1].id });
    assert.equal(deleted.courses.length, 1);

    const refused = await request("/api/courses/delete", { courseId: deleted.courses[0].id });
    assert.equal(refused.courses.length, 1);
  });
});

test("study notes generation fills explanation and memory tip", async () => {
  await withServer(createState(), async (request) => {
    const result = await request("/api/study-notes/generate", {});
    const question = result.state.courses[0].questions.find((item) => item.id === "wrong-only");

    assert.equal(result.result.scanned, 6);
    assert.ok(result.result.explanationAdded > 0);
    assert.ok(question.explanation);
    assert.ok(question.memoryTip);
  });
});

test("invalid json body returns 400", async () => {
  await withServer(createState(), async (request, repository, baseUrl) => {
    const response = await fetch(`${baseUrl}/api/courses`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ 这不是合法 JSON"
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /JSON/);
  });
});

test("malformed url path returns 400 instead of rejecting", async () => {
  await withServer(createState(), async (request, repository, baseUrl) => {
    const response = await fetch(`${baseUrl}/%ZZ`);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.match(payload.error, /请求路径/);
  });
});

test("state response is gzip compressed and static files support etag", async () => {
  await withServer(createLargeExamState(40), async (request, repository, baseUrl) => {
    const state = await fetch(`${baseUrl}/api/state`);
    assert.equal(state.status, 200);
    assert.equal(state.headers.get("content-encoding"), "gzip");
    assert.equal(state.headers.get("cache-control"), "no-store");
    assert.ok((await state.json()).courses.length);

    const asset = await fetch(`${baseUrl}/src/main.js`);
    assert.equal(asset.status, 200);
    const etag = asset.headers.get("etag");
    assert.ok(etag);
    assert.match(asset.headers.get("content-type"), /javascript/);

    const cached = await fetch(`${baseUrl}/src/main.js`, { headers: { "if-none-match": etag } });
    assert.equal(cached.status, 304);
  });
});

test("oversized request body returns 413", async () => {
  await withServer(createState(), async (request, repository, baseUrl) => {
    const response = await fetch(`${baseUrl}/api/questions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questions: [] }).padEnd(21 * 1024 * 1024, " ")
    });
    const payload = await response.json();

    assert.equal(response.status, 413);
    assert.match(payload.error, /超过大小上限/);
  });
});
