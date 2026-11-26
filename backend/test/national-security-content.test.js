import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");
const validator = path.join(repoRoot, "backend/src/scripts/generate/validate-national-security-content.js");
const content = path.join(repoRoot, "content/national-security/course.json");

test("国家安全教育内容校验通过", () => {
  const output = execFileSync(process.execPath, [validator, content], { cwd: repoRoot, encoding: "utf8" });
  assert.match(output, /校验通过/);
  assert.match(output, /题目：290/);
  assert.match(output, /解析：290/);
});
