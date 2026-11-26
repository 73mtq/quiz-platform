import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { rootDir } from "../../config.js";
import { mergeState, normalizeState, splitState } from "../../repositories/StateShape.js";

const { Pool } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("请设置 DATABASE_URL 环境变量");
    console.error("DATABASE_URL=\"postgresql://...\" node backend/src/scripts/migrate/migrate-to-db.js");
    process.exit(1);
  }

  const sourceFile = process.env.SOURCE_FILE || path.join(rootDir, "data", "quiz-data.json");
  console.log(`读取源文件: ${sourceFile}`);

  let data;
  try {
    const content = (await fs.readFile(sourceFile, "utf8")).replace(/^\uFEFF/, "");
    data = JSON.parse(content);
  } catch (error) {
    console.error(`无法读取源文件: ${error.message}`);
    process.exit(1);
  }

  const normalized = normalizeState(data);
  const { data: bank, practice, stats } = splitState(normalized);
  const totalQuestions = normalized.courses.reduce((sum, course) => sum + course.questions.length, 0);
  console.log(`数据统计: ${normalized.courses.length} 个课程, ${totalQuestions} 道题目`);

  console.log("连接数据库...");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_data (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        practice JSONB,
        stats JSONB,
        revision BIGINT NOT NULL DEFAULT 0,
        schema_version INT NOT NULL DEFAULT 1,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS practice JSONB");
    await pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS stats JSONB");
    await pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_data_backups (
        id INT PRIMARY KEY,
        snapshot JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      INSERT INTO quiz_data_backups (id, snapshot, created_at)
      SELECT 1, to_jsonb(q), NOW() FROM quiz_data q WHERE q.id = 1
      ON CONFLICT (id) DO UPDATE
      SET snapshot = EXCLUDED.snapshot, created_at = EXCLUDED.created_at
    `);
    console.log("数据库表已就绪，当前行已写入迁移快照");

    await pool.query(
      `INSERT INTO quiz_data (id, data, practice, stats, revision, schema_version, updated_at)
       VALUES (1, $1, $2, $3, 1, 2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         data = EXCLUDED.data,
         practice = EXCLUDED.practice,
         stats = EXCLUDED.stats,
         revision = quiz_data.revision + 1,
         schema_version = 2,
         updated_at = NOW()`,
      [JSON.stringify(bank), JSON.stringify(practice), JSON.stringify(stats)]
    );
    console.log("数据已写入数据库");

    const result = await pool.query("SELECT data, practice, stats, revision FROM quiz_data WHERE id = 1");
    const record = result.rows[0];
    const merged = mergeState(record.data, record.practice, record.stats);
    assert.deepStrictEqual(merged, normalized);

    console.log(`验证: ${merged.courses.length} 个课程, ${totalQuestions} 道题目, revision = ${record.revision}`);
    console.log("数据完全一致，迁移完成");
  } catch (error) {
    console.error(`数据库操作失败: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
