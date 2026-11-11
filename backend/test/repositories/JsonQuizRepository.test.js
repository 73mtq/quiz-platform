import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { JsonQuizRepository } from "../../src/repositories/JsonQuizRepository.js";
import { normalizeQuestion } from "../../src/utils.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../..");
const tempRoot = path.join(repoRoot, ".test-tmp", `json-repo-${process.pid}-${Date.now()}`);

after(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function makeRepository() {
  await fs.mkdir(tempRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(tempRoot, "case-"));
  const file = path.join(dir, "quiz-data.json");
  return { dir, file, repository: new JsonQuizRepository(file) };
}

function newQuestion(id) {
  return normalizeQuestion({
    id,
    stem: `题干 ${id}`,
    options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
    answer: ["甲"]
  });
}

test("并发 update 全部生效，不丢更新", async () => {
  const { dir, file, repository } = await makeRepository();
  await repository.getState();

  const total = 20;
  await Promise.all(Array.from({ length: total }, (_, index) => (
    repository.update((draft) => {
      draft.courses[0].questions.push(newQuestion(`q-${index}`));
    }, { skipBackup: true })
  )));

  const state = await repository.getState();
  const ids = state.courses[0].questions.map((question) => question.id);
  assert.equal(ids.length, total);
  assert.equal(new Set(ids).size, total);
  await assert.rejects(fs.stat(path.join(dir, "quiz-data.json.tmp")));
  assert.ok(JSON.parse(await fs.readFile(file, "utf8")).courses);
});

test("损坏的题库文件直接抛出，原文件保持原样", async () => {
  const { file, repository } = await makeRepository();
  await repository.getState();
  const broken = "{ 这不是合法 JSON";
  await fs.writeFile(file, broken, "utf8");

  await assert.rejects(() => repository.getState(), /题库文件解析失败/);
  assert.equal(await fs.readFile(file, "utf8"), broken);
});

test("外部修改题库文件后缓存失效", async () => {
  const { file, repository } = await makeRepository();
  const initial = await repository.getState();
  assert.equal(initial.courses.length, 1);

  const external = {
    activeCourseId: "external-course",
    courses: [{ id: "external-course", name: "外部课程", questions: [], practice: {}, createdAt: "2026-01-01T00:00:00.000Z" }]
  };
  await fs.writeFile(file, `${JSON.stringify(external, null, 2)}\n`, "utf8");

  const reloaded = await repository.getState();
  assert.equal(reloaded.activeCourseId, "external-course");
  assert.equal(reloaded.courses[0].name, "外部课程");
});

test("练习更新跳过备份，内容更新生成备份", async () => {
  const { dir, repository } = await makeRepository();
  const backupDir = path.join(dir, "backups");

  await repository.update((draft) => { draft.courses[0].practice.totalAnswered = 1; }, { skipBackup: true });
  await repository.update((draft) => { draft.courses[0].practice.totalAnswered = 2; }, { skipBackup: true });
  await assert.rejects(fs.readdir(backupDir));

  await repository.update((draft) => { draft.courses[0].name = "改名后的课程"; });
  const backups = await fs.readdir(backupDir);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^quiz-data\..+\.json$/);

  const before = await fs.readdir(backupDir);
  await repository.update((draft) => { draft.courses[0].practice.correctInRound = 5; }, { skipBackup: true });
  assert.deepEqual(await fs.readdir(backupDir), before);
});

test("返回 false 的更新不写文件也不生成备份", async () => {
  const { dir, file, repository } = await makeRepository();
  await repository.update((draft) => { draft.courses[0].name = "保持不变"; }, { skipBackup: true });
  const before = await fs.stat(file);

  const state = await repository.update(() => false);

  const after = await fs.stat(file);
  assert.equal(state.courses[0].name, "保持不变");
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
  await assert.rejects(fs.readdir(path.join(dir, "backups")));
});
