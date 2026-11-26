export async function restoreSnapshot(pool) {
  const result = await pool.query("SELECT snapshot FROM quiz_data_backups WHERE id = 1");
  if (!result.rows.length) throw new Error("没有可用的迁移快照");
  const snapshot = result.rows[0].snapshot;
  if (!snapshot || typeof snapshot !== "object" || !snapshot.data) {
    throw new Error("迁移快照缺少 data 字段");
  }

  const hasThreeColumns = snapshot.practice !== null
    && snapshot.practice !== undefined
    && snapshot.stats !== null
    && snapshot.stats !== undefined;
  const updated = hasThreeColumns
    ? await pool.query(
      `UPDATE quiz_data
       SET data = $1, practice = $2, stats = $3, schema_version = 2,
           revision = revision + 1, updated_at = NOW()
       WHERE id = 1 RETURNING revision`,
      [snapshot.data, snapshot.practice, snapshot.stats]
    )
    : await pool.query(
      `UPDATE quiz_data
       SET data = $1, practice = NULL, stats = NULL, schema_version = 1,
           revision = revision + 1, updated_at = NOW()
       WHERE id = 1 RETURNING revision`,
      [snapshot.data]
    );

  if (!updated.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
  return {
    restored: true,
    layout: hasThreeColumns ? "v2" : "v1",
    revision: Number(updated.rows[0].revision)
  };
}
