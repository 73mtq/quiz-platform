import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLocalPracticeConfig,
  isQuestionAnsweredInRound,
  roundQuestionTotal
} from "../src/utils/practiceFlow.js";

test("roundQuestionTotal uses the fixed round total", () => {
  const practice = {
    roundTotal: 10,
    answeredInRound: 3,
    remainingIds: ["q4", "q5"],
    currentQuestionId: "q3",
    lastAnswer: null,
    count: 10
  };
  assert.equal(roundQuestionTotal(practice, 10), 10);
});

test("previous question does not grow the round total", () => {
  const practice = {
    roundTotal: 10,
    answeredInRound: 3,
    remainingIds: ["q4", "q5"],
    currentQuestionId: "q3",
    lastAnswer: null
  };
  const before = roundQuestionTotal(practice, 10);
  practice.currentQuestionId = "q2";
  practice.remainingIds.unshift("q3");
  const after = roundQuestionTotal(practice, 10);
  assert.equal(before, 10);
  assert.equal(after, 10);
});

test("answeredIds blocks a repeated count", () => {
  assert.equal(isQuestionAnsweredInRound({ answeredIds: ["q1"] }, "q1"), true);
  assert.equal(isQuestionAnsweredInRound({ answeredIds: ["q1"] }, "q2"), false);
  assert.equal(isQuestionAnsweredInRound({}, "q1"), false);
});

test("applyLocalPracticeConfig clears round markers", () => {
  const practice = {
    mode: "all",
    count: 0,
    remainingIds: ["q1"],
    answeredInRound: 1,
    correctInRound: 1,
    currentQuestionId: "q1",
    lastAnswer: { questionId: "q1" },
    roundTotal: 5,
    answeredIds: ["q1"],
    historyIds: ["q0"],
    exam: { lastWrongIds: ["q1"], lastSummary: { total: 1 } }
  };
  applyLocalPracticeConfig(practice, { mode: "count", count: 10, timeLimitMinutes: 20 });
  assert.equal(practice.roundTotal, 0);
  assert.deepEqual(practice.answeredIds, []);
  assert.deepEqual(practice.historyIds, []);
});
