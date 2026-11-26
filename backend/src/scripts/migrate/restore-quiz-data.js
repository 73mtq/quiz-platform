import pg from "pg";
import { restoreSnapshot } from "../../services/QuizDataRestore.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("请设置 DATABASE_URL 环境变量");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const result = await restoreSnapshot(pool);
  console.log(`已恢复迁移快照，布局 = ${result.layout}，revision = ${result.revision}`);
  if (result.layout === "v1") {
    console.log("旧版 data 已写回，practice 与 stats 置空，schema_version = 1");
  } else {
    console.log("三列布局已写回，schema_version = 2");
  }
} catch (error) {
  console.error(`恢复失败：${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
