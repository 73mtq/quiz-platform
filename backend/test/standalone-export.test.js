import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const builder = path.join(repoRoot, "backend/src/scripts/generate/build-standalone-maogai-html.js");
const tmpDir = path.join(repoRoot, ".test-tmp");
const nsContent = path.join(repoRoot, "content/national-security/course.json");

function readEmbedded(file) {
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(/<script type="application\/json" id="quiz-data">([\s\S]*?)<\/script>/);
  assert.ok(match, "生成文件中应有题库 JSON");
  return { html, data: JSON.parse(match[1]) };
}

test("国家安全教育静态构建包含 290 题与解析", () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const output = path.join(tmpDir, "ns-standalone.html");
  execFileSync(process.execPath, [
    builder,
    "--source", nsContent,
    "--course", "国家安全教育",
    "--output", output,
    "--title", "国家安全教育题库",
    "--storage-key", "national-security-quiz-progress-v1",
    "--no-auto-notes",
    "--require-explanations"
  ], { cwd: repoRoot, stdio: "pipe" });

  const { html, data } = readEmbedded(output);
  assert.equal(data.courses.length, 1);
  assert.equal(data.courses[0].questions.length, 290);
  assert.equal(data.metadata.title, "国家安全教育题库");
  assert.equal(data.metadata.storageKey, "national-security-quiz-progress-v1");
  assert.equal(data.metadata.explanationCount, 290);
  assert.ok(data.courses[0].questions.every((question) => question.explanation.includes("为什么对：")));
  assert.equal(html.includes("毛概"), false);
  fs.rmSync(output, { force: true });
});

test("默认参数保留毛概标题、存储键和自动解析", () => {
  fs.mkdirSync(tmpDir, { recursive: true });
  const fixture = path.join(tmpDir, "maogai-fixture.json");
  const output = path.join(tmpDir, "maogai-standalone.html");
  fs.writeFileSync(fixture, JSON.stringify({
    activeCourseId: "course-maogai",
    courses: [{
      id: "course-maogai",
      name: "毛概",
      questions: [{
        id: "q-maogai-1",
        type: "choice",
        stem: "毛泽东思想活的灵魂是( )。",
        options: [
          { key: "A", text: "实事求是" },
          { key: "B", text: "群众路线" },
          { key: "C", text: "独立自主" },
          { key: "D", text: "统一战线" }
        ],
        answer: ["实事求是", "群众路线", "独立自主"]
      }]
    }]
  }), "utf8");

  execFileSync(process.execPath, [builder, "--source", fixture, "--output", output], { cwd: repoRoot, stdio: "pipe" });
  const { data } = readEmbedded(output);
  assert.equal(data.metadata.title, "毛概题库离线刷题");
  assert.equal(data.metadata.storageKey, "maogai-quiz-html-progress-maogai-only-v1");
  assert.equal(data.metadata.generatedNotes.explanationAdded, 1);
  assert.ok(data.courses[0].questions[0].explanation.length > 0);
  fs.rmSync(fixture, { force: true });
  fs.rmSync(output, { force: true });
});
