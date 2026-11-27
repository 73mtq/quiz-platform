import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLocalPracticeConfig,
  isQuestionAnsweredInRound,
  resolveAnswerFeedback,
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

test("answered questions in remaining ids do not inflate the round total", () => {
  const practice = {
    roundTotal: 0,
    answeredInRound: 8,
    correctInRound: 4,
    remainingIds: ["answered-a", "unanswered-b"],
    currentQuestionId: "answered-c",
    lastAnswer: null,
    answeredIds: ["answered-a", "answered-c"]
  };

  assert.equal(roundQuestionTotal(practice, 10), 9);
});

test("answeredIds blocks a repeated count", () => {
  assert.equal(isQuestionAnsweredInRound({ answeredIds: ["q1"] }, "q1"), true);
  assert.equal(isQuestionAnsweredInRound({ answeredIds: ["q1"] }, "q2"), false);
  assert.equal(isQuestionAnsweredInRound({}, "q1"), false);
});

function choiceRecord(selectedAnswers) {
  return {
    id: "q-choice",
    type: "choice",
    options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
    answer: ["甲"],
    review: { lastSelectedAnswers: selectedAnswers }
  };
}

test("resolveAnswerFeedback ignores questions not answered in this round", () => {
  const question = choiceRecord(["甲"]);
  const practice = { answeredIds: [], exam: { answers: [] } };

  assert.equal(resolveAnswerFeedback({ question, practice }), null);
});

test("resolveAnswerFeedback prefers the live feedback", () => {
  const question = choiceRecord(["甲"]);
  const liveFeedback = { questionId: "q-choice", selectedAnswers: ["甲"], correct: true };

  assert.equal(resolveAnswerFeedback({ question, practice: { answeredIds: ["q-choice"] }, liveFeedback }), liveFeedback);
});

test("resolveAnswerFeedback rebuilds a recorded choice answer", () => {
  const question = choiceRecord(["乙"]);
  const practice = { answeredIds: ["q-choice"], exam: { answers: [] }, answeredInRound: 1 };

  assert.deepEqual(resolveAnswerFeedback({ question, practice }), {
    questionId: "q-choice",
    selectedAnswers: ["乙"],
    correct: false
  });
});

test("resolveAnswerFeedback falls back to exam answers", () => {
  const question = choiceRecord([]);
  const practice = {
    answeredIds: ["q-choice"],
    exam: { answers: [{ questionId: "q-choice", selectedAnswers: ["甲"], correct: true }] }
  };

  assert.deepEqual(resolveAnswerFeedback({ question, practice }), {
    questionId: "q-choice",
    selectedAnswers: ["甲"],
    correct: true
  });
});

test("resolveAnswerFeedback judges fill-blank answers with separators", () => {
  const question = {
    id: "q-blank",
    type: "fill-blank",
    answer: ["北京；首都", "上海"],
    review: { lastSelectedAnswers: ["首都", "上海"] }
  };
  const practice = { answeredIds: ["q-blank"], exam: { answers: [] } };

  assert.deepEqual(resolveAnswerFeedback({ question, practice }), {
    questionId: "q-blank",
    selectedAnswers: ["首都", "上海"],
    correct: true
  });
});

test("resolveAnswerFeedback keeps the round progress untouched", () => {
  const question = choiceRecord(["甲"]);
  const practice = {
    roundTotal: 10,
    answeredInRound: 4,
    correctInRound: 3,
    answeredIds: ["q-choice"],
    remainingIds: ["q-next"],
    currentQuestionId: "q-choice",
    exam: { answers: [] }
  };
  const snapshot = JSON.parse(JSON.stringify(practice));

  resolveAnswerFeedback({ question, practice });
  assert.deepEqual(practice, snapshot);
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
