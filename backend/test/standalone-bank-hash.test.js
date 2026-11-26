import test from "node:test";
import assert from "node:assert/strict";
import { computeBankHash, computeCoreHash } from "../src/services/StandaloneBankHash.js";

function sampleCourses() {
  return [{
    id: "course-1",
    name: "国家安全教育",
    questions: [{
      id: "q1",
      type: "choice",
      stem: "题干( )。",
      options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
      answer: ["甲"],
      explanation: "旧解析",
      memoryTip: "旧速记"
    }]
  }];
}

test("核心哈希忽略解析和速记，完整哈希包含它们", () => {
  const courses = sampleCourses();
  const coreBefore = computeCoreHash(courses);
  const bankBefore = computeBankHash(courses);

  courses[0].questions[0].explanation = "新解析";
  courses[0].questions[0].memoryTip = "新速记";

  assert.equal(computeCoreHash(courses), coreBefore);
  assert.notEqual(computeBankHash(courses), bankBefore);
});

test("题干、选项或答案变化会改变核心哈希", () => {
  const courses = sampleCourses();
  const coreBefore = computeCoreHash(courses);

  courses[0].questions[0].answer = ["乙"];
  assert.notEqual(computeCoreHash(courses), coreBefore);
});
