import assert from "node:assert/strict";
import test from "node:test";
import {
  compactStatePayload,
  isDefaultStats,
  mergeState,
  normalizeState,
  splitState,
  statsPatchForQuestion
} from "../src/repositories/StateShape.js";

function sampleState() {
  return normalizeState({
    activeCourseId: "course-a",
    courses: [
      {
        id: "course-a",
        name: "课程甲",
        createdAt: "2026-01-01T00:00:00.000Z",
        practice: {
          roundNo: 2,
          remainingIds: ["q2", "q3"],
          answeredInRound: 1,
          correctInRound: 1,
          totalAnswered: 10,
          totalCorrect: 7,
          currentQuestionId: "q1",
          lastAnswer: { questionId: "q1", selectedAnswers: ["甲"], correct: true },
          mode: "all",
          count: 0,
          roundTotal: 3,
          answeredIds: ["q1"],
          historyIds: ["q0"],
          exam: { questionIds: ["q1"], answers: [], lastWrongIds: [] }
        },
        questions: [
          {
            id: "q1",
            type: "choice",
            stem: "第一题",
            options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
            answer: ["甲"],
            wrongCount: 2,
            correctCount: 3,
            bookmarked: true,
            explanation: "第一题解析",
            memoryTip: "第一题速记",
            review: {
              lastAnsweredAt: "2026-01-02T00:00:00.000Z",
              lastWrongAt: "2026-01-01T00:00:00.000Z",
              consecutiveCorrect: 1,
              lastSelectedAnswers: ["甲"]
            },
            createdAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "q2",
            type: "choice",
            stem: "第二题",
            options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
            answer: ["乙"],
            explanation: "第二题解析",
            createdAt: "2026-01-01T00:00:00.000Z"
          },
          {
            id: "q3",
            type: "fill-blank",
            stem: "第三题",
            options: [],
            answer: ["北京"],
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      },
      {
        id: "course-b",
        name: "课程乙",
        createdAt: "2026-01-01T00:00:00.000Z",
        practice: { mode: "wrong", remainingIds: ["q4"] },
        questions: [
          {
            id: "q4",
            type: "choice",
            stem: "第四题",
            options: [{ key: "A", text: "对" }, { key: "B", text: "错" }],
            answer: ["A"],
            wrongCount: 1,
            review: { lastWrongAt: "2026-01-02T00:00:00.000Z" },
            createdAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      }
    ]
  });
}

test("splitState and mergeState preserve the full state", () => {
  const state = sampleState();
  const { data, practice, stats } = splitState(state);
  const merged = mergeState(data, practice, stats);

  assert.deepEqual(merged, state);
  assert.equal(Object.keys(stats).length, 2);
  assert.equal(stats.q2, undefined);
  for (const course of data.courses) {
    for (const question of course.questions) {
      assert.equal("wrongCount" in question, false);
      assert.equal("review" in question, false);
      assert.equal("bookmarked" in question, false);
    }
  }
});

test("splitState drops orphan stats and defaults", () => {
  const state = sampleState();
  state.courses[0].questions.push({
    id: "q5",
    type: "choice",
    stem: "第五题",
    options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
    answer: ["甲"],
    wrongCount: 0,
    correctCount: 0,
    bookmarked: false,
    review: { lastSelectedAnswers: [] }
  });
  const { stats } = splitState(state);
  assert.equal(stats.q5, undefined);
  assert.equal(isDefaultStats(statsPatchForQuestion(state.courses[0].questions.find((item) => item.id === "q1"))), false);
});

test("compactStatePayload restores answered ids for legacy rounds", () => {
  const state = sampleState();
  const practice = state.courses[0].practice;
  practice.answeredIds = [];
  practice.answeredInRound = 1;
  practice.lastAnswer = null;

  const payload = compactStatePayload(state, 1);

  assert.deepEqual(payload.course.practice.answeredIds, ["q1"]);
  assert.deepEqual(practice.answeredIds, []);
});

test("compactStatePayload restores previous question history for legacy rounds", () => {
  const state = sampleState();
  const practice = state.courses[0].practice;
  practice.answeredIds = [];
  practice.answeredInRound = 1;
  practice.lastAnswer = null;
  practice.historyIds = [];
  practice.currentQuestionId = "q2";

  const payload = compactStatePayload(state, 1);

  assert.deepEqual(payload.course.practice.answeredIds, ["q1"]);
  assert.deepEqual(payload.course.practice.historyIds, ["q1"]);
  assert.deepEqual(practice.historyIds, []);
});

test("compactStatePayload contains only the active course questions", () => {
  const state = sampleState();
  const payload = compactStatePayload(state, 12);

  assert.equal(payload.revision, 12);
  assert.equal(payload.activeCourseId, "course-a");
  assert.equal(payload.course.questions.length, 3);
  const inactive = payload.courses.find((course) => course.id === "course-b");
  assert.equal(inactive.questionCount, 1);
  assert.equal(inactive.questions, undefined);
  assert.equal(JSON.stringify(payload).includes("第四题"), false);

  const current = payload.course.questions.find((question) => question.id === "q1");
  const other = payload.course.questions.find((question) => question.id === "q2");
  assert.equal(current.explanation, "第一题解析");
  assert.equal(current.memoryTip, "第一题速记");
  assert.equal(other.explanation, undefined);
  assert.equal(other.memoryTip, undefined);
});
