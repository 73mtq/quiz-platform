import assert from "node:assert/strict";
import test from "node:test";
import {
  areChoiceAnswerSetsEqual,
  areFillBlankAnswersCorrect,
  getChoiceAnswerTexts as getServerChoiceAnswerTexts,
  updateQuestionReview
} from "./utils.js";
import {
  getChoiceAnswerTexts as getClientChoiceAnswerTexts,
  isChoiceAnswerCorrect,
  isFillBlankAnswerCorrect
} from "../../frontend/src/utils/answers.js";
import { applyQuestionReview } from "../../frontend/src/utils/review.js";
import { stripMemoryTipLabel as stripClientMemoryTipLabel } from "../../frontend/src/utils/practiceFlow.js";
import { stripMemoryTipLabel as stripServerMemoryTipLabel } from "./services/StudyNoteGenerator.js";

const choiceQuestion = {
  type: "choice",
  stem: "题干",
  options: [
    { key: "A", text: "Alpha" },
    { key: "B", text: "Beta" },
    { key: "C", text: "Ｇａｍｍａ" }
  ],
  answer: ["Beta", "Ｇａｍｍａ"]
};

const choiceSelections = [
  [],
  ["A"],
  ["a"],
  ["Alpha"],
  ["Alpha", "Beta"],
  ["Beta", "Gamma"],
  ["Beta", "Ｇａｍｍａ"],
  ["B", "C"],
  ["C", "B"],
  ["Beta"],
  ["Beta", "Beta"],
  ["  beta  "],
  ["Beta", "Ｇａｍｍａ", "A"],
  ["Delta"]
];

test("选择题判定前后端一致", () => {
  for (const selected of choiceSelections) {
    assert.equal(
      isChoiceAnswerCorrect(choiceQuestion, selected),
      areChoiceAnswerSetsEqual(choiceQuestion, selected),
      `选中 ${JSON.stringify(selected)} 时判定不一致`
    );
  }
});

const keylessOptionQuestion = {
  type: "choice",
  stem: "题干",
  options: [
    { key: "", text: "Alpha" },
    { text: "Beta" },
    { key: "C", text: "Gamma" }
  ],
  answer: ["Beta"]
};

const keylessSelections = [
  [],
  ["Beta"],
  ["Alpha"],
  ["B"],
  ["Gamma"],
  ["C"],
  [""],
  ["Delta"]
];

test("缺少 key 的选项答案解析前后端一致", () => {
  for (const selected of keylessSelections) {
    assert.doesNotThrow(() => getServerChoiceAnswerTexts(keylessOptionQuestion, selected));
    assert.deepEqual(
      getServerChoiceAnswerTexts(keylessOptionQuestion, selected),
      getClientChoiceAnswerTexts(keylessOptionQuestion, selected),
      `选中 ${JSON.stringify(selected)} 时解析不一致`
    );
  }
});

const fillQuestions = [
  { type: "fill-blank", answer: ["北京"] },
  { type: "fill-blank", answer: ["作风优良；纪律严明"] },
  { type: "fill-blank", answer: ["甲", "乙丙"] },
  { type: "fill-blank", answer: ["对"] }
];

const fillSelections = [
  [],
  ["北京"],
  ["北京 "],
  [" 北京 "],
  ["beijing"],
  ["北京", ""],
  ["作风优良"],
  ["纪律严明"],
  ["作风优良", "纪律严明"],
  ["甲", "乙丙"],
  ["甲", "乙"],
  ["", ""],
  ["对"]
];

test("填空题判定前后端一致", () => {
  for (const question of fillQuestions) {
    for (const selected of fillSelections) {
      assert.equal(
        isFillBlankAnswerCorrect(question, selected),
        areFillBlankAnswersCorrect(question, selected),
        `答案 ${JSON.stringify(question.answer)} 选中 ${JSON.stringify(selected)} 时判定不一致`
      );
    }
  }
});

const reviewEvents = [
  { correct: false, selectedAnswers: ["Beta"], answeredAt: "2026-01-01T00:00:00.000Z" },
  { correct: true, selectedAnswers: ["Gamma"], answeredAt: "2026-01-02T00:00:00.000Z" },
  { correct: true, selectedAnswers: ["Gamma"], answeredAt: "2026-01-03T00:00:00.000Z" },
  { correct: false, selectedAnswers: ["Alpha"], answeredAt: "2026-01-04T00:00:00.000Z" },
  { correct: true, selectedAnswers: ["Beta"], answeredAt: "2026-01-05T00:00:00.000Z" },
  { correct: true, selectedAnswers: ["Beta"], answeredAt: "2026-01-06T00:00:00.000Z" }
];

test("复习进度更新前后端一致", () => {
  const baseQuestions = [
    { wrongCount: 0, correctCount: 0, review: {} },
    { wrongCount: 1, correctCount: 0, review: { consecutiveCorrect: 1 } },
    {
      wrongCount: 2,
      correctCount: 3,
      review: {
        consecutiveCorrect: 0,
        masteredAt: "2025-12-01T00:00:00.000Z",
        lastWrongAt: "2025-12-01T00:00:00.000Z"
      }
    }
  ];

  for (const base of baseQuestions) {
    const clientQuestion = structuredClone(base);
    const serverQuestion = structuredClone(base);
    for (const event of reviewEvents) {
      if (event.correct) {
        clientQuestion.correctCount += 1;
        serverQuestion.correctCount += 1;
      } else {
        clientQuestion.wrongCount += 1;
        serverQuestion.wrongCount += 1;
      }
      applyQuestionReview(clientQuestion, event);
      updateQuestionReview(serverQuestion, event);
      assert.deepEqual(clientQuestion.review, serverQuestion.review);
    }
  }
});

test("速记标签清理前后端一致", () => {
  const values = [
    "",
    "答案",
    "速记：答案",
    "速记：速记：速记：答案",
    "口诀:答案",
    "快速记忆 ： 答案",
    "记忆法：记忆法：答案",
    "速记：",
    "速记： 速记：速记：速记：x"
  ];

  for (const value of values) {
    assert.equal(stripClientMemoryTipLabel(value), stripServerMemoryTipLabel(value), `清理 ${JSON.stringify(value)} 时结果不一致`);
  }
});
