import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRouter } from "./routes.js";
import { buildStudyNotes } from "./services/StudyNoteGenerator.js";
import { normalizeQuestion } from "./utils.js";

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
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      return payload;
    };
    return await callback(request, repository);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("wrong reset-round includes pending wrong questions only", async () => {
  const state = await postPractice("/api/practice/reset-round", { mode: "wrong" });
  const [course] = state.courses;

  assert.deepEqual([...course.practice.remainingIds].sort(), ["wrong-only", "wrong-then-correct"]);
});

test("wrong next prioritizes pending wrong questions", async () => {
  const state = await postPractice("/api/practice/next", { mode: "wrong" });
  const [course] = state.courses;
  const roundIds = [course.practice.currentQuestionId, ...course.practice.remainingIds]
    .filter(Boolean);

  assert.deepEqual(roundIds, ["wrong-then-correct", "wrong-only"]);
});

test("wrong answer resets review progress and clears mastered flag", async () => {
  const payload = await postPractice("/api/practice/answer", {
    questionId: "mastered-wrong",
    selectedAnswers: ["Beta"]
  });
  const [course] = payload.state.courses;
  const question = course.questions.find((item) => item.id === "mastered-wrong");

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
    const updated = payload.state.courses[0].questions.find((item) => item.id === "wrong-only");

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
  assert.match(fillNotes.memoryTip, /速记/);
  assert.match(multiNotes.explanation, /多选/);
  assert.match(multiNotes.memoryTip, /Alpha\+Beta/);
});

test("exam reset prioritizes pending wrong questions", async () => {
  const state = await postPractice("/api/practice/reset-round", { mode: "exam", count: 3, timeLimitMinutes: 20 });
  const [course] = state.courses;
  const roundIds = course.practice.exam.questionIds;

  assert.equal(course.practice.mode, "exam");
  assert.deepEqual(roundIds.slice(0, 2), ["wrong-then-correct", "wrong-only"]);
  assert.equal(roundIds.length, 3);
  assert.equal(course.practice.exam.timeLimitMinutes, 20);
});

test("finish-exam returns summary and exam-wrong uses last wrong ids", async () => {
  await withServer(createState(), async (request) => {
    const reset = await request("/api/practice/reset-round", { mode: "exam", count: 3, timeLimitMinutes: 20 });
    const roundIds = reset.courses[0].practice.exam.questionIds;

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
    assert.deepEqual([...review.courses[0].practice.remainingIds].sort(), [...summary.wrongIds].sort());
  });
});
