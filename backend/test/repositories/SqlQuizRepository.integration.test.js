import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { SqlQuizRepository } from "../../src/repositories/SqlQuizRepository.js";
import { normalizeState } from "../../src/repositories/StateShape.js";
import { restoreSnapshot } from "../../src/services/QuizDataRestore.js";

const adminUrl = process.env.TEST_DATABASE_URL;
const skip = adminUrl ? false : "设置 TEST_DATABASE_URL（指向 postgres 数据库）后运行";

function sampleState() {
  return normalizeState({
    activeCourseId: "c1",
    courses: [
      {
        id: "c1",
        name: "课程一",
        createdAt: "2026-01-01T00:00:00.000Z",
        practice: {
          roundNo: 2,
          remainingIds: ["q2", "q3"],
          answeredInRound: 1,
          correctInRound: 1,
          totalAnswered: 1,
          totalCorrect: 1,
          currentQuestionId: "q1",
          lastAnswer: { questionId: "q1", selectedAnswers: ["甲"], correct: true },
          mode: "all",
          count: 0,
          exam: { questionIds: [], answers: [], lastWrongIds: [] }
        },
        questions: [
          {
            id: "q1",
            type: "choice",
            stem: "第一题",
            options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
            answer: ["甲"],
            wrongCount: 1,
            correctCount: 2,
            bookmarked: true,
            review: {
              lastAnsweredAt: "2026-01-01T00:00:00.000Z",
              lastCorrectAt: "2026-01-01T00:00:00.000Z",
              consecutiveCorrect: 1,
              lastSelectedAnswers: ["甲"]
            }
          },
          {
            id: "q2",
            type: "choice",
            stem: "第二题",
            options: [{ key: "A", text: "甲" }, { key: "B", text: "乙" }],
            answer: ["乙"]
          }
        ]
      },
      {
        id: "c2",
        name: "课程二",
        practice: { mode: "wrong", remainingIds: ["q3"] },
        questions: [
          {
            id: "q3",
            type: "fill-blank",
            stem: "第三题",
            options: [],
            answer: ["北京"],
            wrongCount: 2,
            review: { lastWrongAt: "2026-01-02T00:00:00.000Z" }
          }
        ]
      }
    ]
  });
}

test("SQL 仓库迁移、高频写入、缓存失效与恢复", { skip }, async () => {
  const dbName = `quiz_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Pool({ connectionString: adminUrl });
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const dbUrl = url.toString();
  let pool;
  let repository;

  try {
    await admin.query(`CREATE DATABASE ${dbName}`);
    pool = new pg.Pool({ connectionString: dbUrl });
    await pool.query("DROP TABLE IF EXISTS quiz_data_backups");
    await pool.query("DROP TABLE IF EXISTS quiz_data");
    await pool.query(`
      CREATE TABLE quiz_data (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const state = sampleState();
    await pool.query("INSERT INTO quiz_data (id, data) VALUES (1, $1)", [JSON.stringify(state)]);

    repository = new SqlQuizRepository(dbUrl);
    const migrated = await repository.getState();
    assert.deepStrictEqual(migrated, state);
    assert.equal(repository.getRevision(), 1);

    const columns = await pool.query("SELECT practice, stats, schema_version, revision FROM quiz_data WHERE id = 1");
    assert.equal(columns.rows[0].schema_version, 2);
    assert.equal(columns.rows[0].practice.activeCourseId, "c1");
    assert.deepEqual(Object.keys(columns.rows[0].stats).sort(), ["q1", "q3"]);
    const backup = await pool.query("SELECT count(*)::int AS count FROM quiz_data_backups");
    assert.equal(backup.rows[0].count, 1);

    const next = await repository.updatePractice("c1", (view) => {
      const course = repository.getActiveCourse(view);
      course.practice.currentQuestionId = "q2";
      course.practice.remainingIds = ["q3"];
      course.practice.historyIds = ["q1"];
      course.practice.lastAnswer = null;
    }, { operationId: "op-next" });
    assert.equal(next.practice.currentQuestionId, "q2");

    const answered = await repository.updateAnswer("c1", "q2", (view) => {
      const course = repository.getActiveCourse(view);
      const question = course.questions.find((item) => item.id === "q2");
      question.wrongCount = 1;
      question.review = {
        lastAnsweredAt: "2026-03-01T00:00:00.000Z",
        lastWrongAt: "2026-03-01T00:00:00.000Z",
        lastSelectedAnswers: ["甲"]
      };
      course.practice.answeredIds = ["q2"];
      course.practice.answeredInRound = 2;
      course.practice.lastAnswer = {
        questionId: "q2",
        selectedAnswers: ["甲"],
        correct: false,
        answeredAt: "2026-03-01T00:00:00.000Z"
      };
    }, { operationId: "op-answer" });
    assert.equal(answered.question.wrongCount, 1);

    const duplicate = await repository.updateAnswer("c1", "q2", () => {
      throw new Error("重复操作不应执行 mutator");
    }, { operationId: "op-answer" });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.question.id, "q2");

    const second = new SqlQuizRepository(dbUrl);
    const loaded = await second.getState();
    const c1 = loaded.courses.find((course) => course.id === "c1");
    assert.equal(c1.practice.currentQuestionId, "q2");
    assert.deepEqual(c1.practice.remainingIds, ["q3"]);
    assert.deepEqual(c1.practice.historyIds, ["q1"]);
    assert.equal(c1.questions.find((question) => question.id === "q2").wrongCount, 1);

    const switched = await second.setActiveCourse("c2");
    assert.equal(switched.activeCourseId, "c2");
    assert.equal(switched.course.id, "c2");
    assert.equal((await second.getState()).activeCourseId, "c2");

    const restored = await restoreSnapshot(pool);
    assert.equal(restored.revision > 0, true);
    const restoredRow = await pool.query("SELECT data, practice, stats, schema_version FROM quiz_data WHERE id = 1");
    assert.equal(restoredRow.rows[0].practice, null);
    assert.equal(restoredRow.rows[0].stats, null);
    assert.equal(restoredRow.rows[0].schema_version, 1);
    assert.equal(restoredRow.rows[0].data.courses.length, 2);
    assert.equal(restoredRow.rows[0].data.courses[0].practice.roundNo, 2);

    await second.close();
    await repository.close();
    repository = null;
  } finally {
    if (repository) await repository.close().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await admin.end();
  }
});
