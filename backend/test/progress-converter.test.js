import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const converter = path.join(repoRoot, "backend/src/scripts/migrate/export-standalone-progress.js");
const tmpDir = path.join(repoRoot, ".test-tmp");

test("旧服务器进度可以转换成静态题库进度", () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const contentFile = path.join(tmpDir, "progress-content.json");
  const stateFile = path.join(tmpDir, "progress-state.json");
  const outputFile = path.join(tmpDir, "progress-output.json");
  const question = {
    id: "q1",
    type: "choice",
    stem: "测试题( )。",
    options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
    answer: ["甲"],
    explanation: "正确答案：甲\n为什么对：测试。\n干扰项分析：乙不对。\n记忆：测试。\n依据：教材表述。",
    memoryTip: "测试"
  };
  fs.writeFileSync(contentFile, JSON.stringify({
    activeCourseId: "course-test",
    courses: [{ id: "course-test", name: "国家安全教育", questions: [question] }]
  }), "utf8");
  fs.writeFileSync(stateFile, JSON.stringify({
    activeCourseId: "course-test",
    courses: [{
      id: "course-test",
      name: "国家安全教育",
      questions: [{ ...question, wrongCount: 3, correctCount: 1, bookmarked: true, review: { consecutiveCorrect: 1 } }],
      practice: { mode: "wrong", remainingIds: ["q1"], answeredInRound: 1, correctInRound: 0 }
    }]
  }), "utf8");

  execFileSync(process.execPath, [
    converter,
    "--state", stateFile,
    "--content", contentFile,
    "--course", "国家安全教育",
    "--output", outputFile
  ], { cwd: repoRoot, stdio: "pipe" });

  const output = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(output.activeCourseId, "course-test");
  assert.equal(output.questionProgress.q1.wrongCount, 3);
  assert.equal(output.questionProgress.q1.bookmarked, true);
  assert.equal(output.practices["course-test"].remainingIds[0], "q1");
  assert.ok(output.coreHash);
  assert.ok(output.bankHash);
  fs.rmSync(contentFile, { force: true });
  fs.rmSync(stateFile, { force: true });
  fs.rmSync(outputFile, { force: true });
});
