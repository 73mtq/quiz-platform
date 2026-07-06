import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createRouter } from "./routes.js";

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
    count: 0
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
