import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCoursePayload,
  applyExplanations,
  applyPracticePayload,
  applyPracticeStats,
  applyQuestionPayload,
  courseQuestionCount,
  hydrateStatePayload
} from "../src/state/practiceState.js";

function compactPayload() {
  return {
    revision: 5,
    activeCourseId: "course-a",
    courses: [
      { id: "course-a", name: "课程甲", questionCount: 2, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "course-b", name: "课程乙", questionCount: 1, createdAt: "2026-01-01T00:00:00.000Z" }
    ],
    course: {
      id: "course-a",
      name: "课程甲",
      createdAt: "2026-01-01T00:00:00.000Z",
      practice: {
        roundNo: 1,
        remainingIds: ["q2"],
        answeredInRound: 1,
        correctInRound: 1,
        totalAnswered: 1,
        totalCorrect: 1,
        currentQuestionId: "q1",
        lastAnswer: null,
        mode: "all",
        count: 0,
        roundTotal: 2,
        answeredIds: ["q1"],
        historyIds: [],
        recentOperationIds: [],
        exam: { startedAt: "", finishedAt: "", questionIds: [], answers: [], lastWrongIds: [], lastSummary: null }
      },
      questions: [
        { id: "q1", type: "choice", stem: "第一题", options: [], answer: ["甲"], wrongCount: 0, correctCount: 1, bookmarked: false, review: {} },
        { id: "q2", type: "choice", stem: "第二题", options: [], answer: ["乙"], wrongCount: 0, correctCount: 0, bookmarked: false, review: {} }
      ]
    }
  };
}

test("hydrateStatePayload keeps only the active course questions", () => {
  const state = hydrateStatePayload(compactPayload());
  assert.equal(state.activeCourseId, "course-a");
  assert.equal(state.courses.length, 2);
  assert.equal(state.courses[0].questions.length, 2);
  assert.equal(courseQuestionCount(state.courses[1]), 1);
  assert.equal(state.courses[1].questions.length, 0);
});

test("applyPracticeStats preserves navigation state and merges counters", () => {
  const state = hydrateStatePayload(compactPayload());
  const course = state.courses[0];
  course.practice.currentQuestionId = "q2";
  course.practice.remainingIds = [];

  const applied = applyPracticeStats(state, {
    courseId: "course-a",
    practice: {
      roundTotal: 2,
      answeredInRound: 2,
      correctInRound: 2,
      totalAnswered: 2,
      totalCorrect: 2,
      answeredIds: ["q1", "q2"],
      historyIds: ["q1"]
    }
  });

  assert.equal(applied, true);
  assert.equal(state.courses[0].practice.currentQuestionId, "q2");
  assert.deepEqual(state.courses[0].practice.remainingIds, []);
  assert.equal(state.courses[0].practice.answeredInRound, 2);
  assert.deepEqual(state.courses[0].practice.historyIds, ["q1"]);
});

test("applyPracticePayload replaces practice without dropping the course list", () => {
  const state = hydrateStatePayload(compactPayload());
  const applied = applyPracticePayload(state, {
    courseId: "course-a",
    practice: {
      roundNo: 2,
      remainingIds: ["q1", "q2"],
      answeredInRound: 0,
      correctInRound: 0,
      totalAnswered: 1,
      totalCorrect: 1,
      currentQuestionId: null,
      lastAnswer: null,
      mode: "wrong",
      count: 0,
      roundTotal: 0,
      answeredIds: [],
      historyIds: [],
      recentOperationIds: [],
      exam: { startedAt: "", finishedAt: "", questionIds: [], answers: [], lastWrongIds: [], lastSummary: null }
    }
  });

  assert.equal(applied, true);
  assert.equal(state.courses.length, 2);
  assert.equal(state.activeCourseId, "course-a");
  assert.equal(state.courses[0].practice.mode, "wrong");
});

test("applyCoursePayload drops previous course questions", () => {
  const state = hydrateStatePayload(compactPayload());
  const applied = applyCoursePayload(state, {
    revision: 6,
    activeCourseId: "course-b",
    course: {
      id: "course-b",
      name: "课程乙",
      createdAt: "2026-01-01T00:00:00.000Z",
      practice: { roundTotal: 0, answeredIds: [], historyIds: [], exam: {} },
      questions: [{ id: "q3", type: "choice", stem: "第三题", options: [], answer: ["甲"] }]
    }
  });

  assert.equal(applied, true);
  assert.equal(state.activeCourseId, "course-b");
  assert.equal(state.courses.find((course) => course.id === "course-a").questions.length, 0);
  assert.equal(state.courses.find((course) => course.id === "course-b").questions.length, 1);
});

test("applyPracticeStats ignores a course whose questions were unloaded", () => {
  const state = hydrateStatePayload(compactPayload());
  const applied = applyPracticeStats(state, {
    courseId: "course-b",
    practice: { answeredInRound: 1 }
  });
  assert.equal(applied, false);
});

test("applyExplanations merges notes into the active course", () => {
  const state = hydrateStatePayload(compactPayload());
  const applied = applyExplanations(state, {
    courseId: "course-a",
    explanations: {
      q1: { explanation: "解析一", memoryTip: "速记一" }
    }
  });
  assert.equal(applied, true);
  assert.equal(state.courses[0].questions.find((question) => question.id === "q1").explanation, "解析一");
});

test("applyQuestionPayload updates an existing question", () => {
  const state = hydrateStatePayload(compactPayload());
  const applied = applyQuestionPayload(state, {
    courseId: "course-a",
    question: { id: "q1", wrongCount: 2, correctCount: 1, bookmarked: true, review: { lastWrongAt: "x" } }
  });
  assert.equal(applied, true);
  assert.equal(state.courses[0].questions.find((question) => question.id === "q1").bookmarked, true);
});
