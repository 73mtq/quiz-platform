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
          { id: "wrong-only", stem: "wrong only", wrongCount: 1, correctCount: 0 },
          { id: "wrong-then-correct", stem: "wrong then correct", wrongCount: 2, correctCount: 3 },
          { id: "correct-only", stem: "correct only", wrongCount: 0, correctCount: 4 }
        ],
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

test("wrong reset-round includes every question with wrongCount", async () => {
  const state = await postPractice("/api/practice/reset-round", { mode: "wrong" });
  const [course] = state.courses;

  assert.deepEqual([...course.practice.remainingIds].sort(), ["wrong-only", "wrong-then-correct"]);
});

test("wrong next includes previously corrected wrong questions", async () => {
  const state = await postPractice("/api/practice/next", { mode: "wrong" });
  const [course] = state.courses;
  const roundIds = [course.practice.currentQuestionId, ...course.practice.remainingIds]
    .filter(Boolean)
    .sort();

  assert.deepEqual(roundIds, ["wrong-only", "wrong-then-correct"]);
});
