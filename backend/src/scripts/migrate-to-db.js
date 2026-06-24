/**
 * 数据迁移脚本：将本地 JSON 文件数据导入 PostgreSQL 数据库
 *
 * 用法：
 *   DATABASE_URL="postgresql://..." node backend/src/scripts/migrate-to-db.js
 *
 * 可选环境变量：
 *   SOURCE_FILE  自定义源文件路径（默认 data/quiz-data.json）
 */

import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { rootDir } from "../config.js";

const { Pool } = pg;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ 请设置 DATABASE_URL 环境变量");
    console.error("   DATABASE_URL=\"postgresql://...\" node backend/src/scripts/migrate-to-db.js");
    process.exit(1);
  }

  // 读取源文件
  const sourceFile = process.env.SOURCE_FILE || path.join(rootDir, "data", "quiz-data.json");
  console.log(`📖 读取源文件: ${sourceFile}`);

  let data;
  try {
    const content = (await fs.readFile(sourceFile, "utf8")).replace(/^﻿/, "");
    data = JSON.parse(content);
  } catch (error) {
    console.error(`❌ 无法读取源文件: ${error.message}`);
    process.exit(1);
  }

  // 统计数据
  const courses = data.courses || [];
  const totalQuestions = courses.reduce((sum, c) => sum + (c.questions || []).length, 0);
  console.log(`📊 数据统计: ${courses.length} 个课程, ${totalQuestions} 道题目`);

  // 连接数据库
  console.log("🔗 连接数据库...");
  const pool = new Pool({ connectionString: databaseUrl });

  try {
    // 创建表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_data (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("✅ 数据库表已就绪");

    // 插入数据
    await pool.query(
      `INSERT INTO quiz_data (id, data, updated_at) VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = NOW()`,
      [JSON.stringify(data)]
    );
    console.log("✅ 数据已写入数据库");

    // 验证
    const result = await pool.query("SELECT data FROM quiz_data WHERE id = 1");
    const saved = result.rows[0]?.data;
    const savedCourses = saved?.courses?.length || 0;
    const savedQuestions = (saved?.courses || []).reduce((sum, c) => sum + (c.questions || []).length, 0);
    console.log(`🔍 验证: ${savedCourses} 个课程, ${savedQuestions} 道题目`);

    if (savedCourses === courses.length && savedQuestions === totalQuestions) {
      console.log("🎉 迁移完成！数据完全一致");
    } else {
      console.log("⚠️  数据数量不一致，请检查");
    }
  } catch (error) {
    console.error(`❌ 数据库操作失败: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
