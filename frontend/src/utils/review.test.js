import assert from "node:assert/strict";
import test from "node:test";
import { analyzeReview, getQuestionTags } from "./review.js";

test("analyzeReview summarizes wrong questions and weak categories", () => {
  const course = {
    questions: [
      {
        id: "q1",
        stem: "总体国家安全观以（）为宗旨，坚持国家安全一切为了人民、一切依靠人民",
        options: [{ key: "A", text: "政治安全" }, { key: "B", text: "人民安全" }],
        answer: ["B"],
        wrongCount: 3,
        correctCount: 0
      },
      {
        id: "q2",
        stem: "建设美丽中国，要加快推动（）等调整优化",
        options: [{ key: "A", text: "资源结构" }, { key: "B", text: "产业结构" }, { key: "C", text: "能源结构" }],
        answer: ["B", "C"],
        wrongCount: 2,
        correctCount: 1
      },
      {
        id: "q3",
        stem: "已经掌握的题",
        options: [{ key: "A", text: "对" }, { key: "B", text: "错" }],
        answer: ["A"],
        wrongCount: 0,
        correctCount: 4
      }
    ]
  };

  const review = analyzeReview(course);

  assert.equal(review.totalQuestions, 3);
  assert.equal(review.wrongQuestions, 2);
  assert.equal(review.repeatedWrong, 2);
  assert.equal(review.multiWrong, 1);
  assert.equal(review.recoveredWrong, 1);
  assert.equal(review.priorityQuestions[0].id, "q1");
  assert.ok(review.categories.some((category) => category.name === "国家安全/强军"));
  assert.ok(review.categories.some((category) => category.name === "生态文明/美丽中国"));
  assert.ok(review.memoryCards.length > 0);
});

test("getQuestionTags labels repeated, multi, and concept questions", () => {
  const tags = getQuestionTags({
    stem: "（）年，党的十九大把精准脱贫作为三大攻坚战之一进行全面部署。",
    answer: ["A", "B"],
    wrongCount: 2,
    correctCount: 1
  });

  assert.ok(tags.includes("错 2"));
  assert.ok(tags.includes("对 1"));
  assert.ok(tags.includes("多选"));
  assert.ok(tags.includes("时间会议"));
  assert.ok(tags.includes("括号概念"));
});
