/**
 * 把本地 data/quiz-data.json 里"修复后的多选题 answer"推送到 Render
 *
 * 策略：
 *   1. 拉 Render 当前 state（GET /api/state）
 *   2. 读本地 state
 *   3. 对 Render 上每道题，用 stem 在本地任意课里找匹配
 *   4. 如果本地版 answer 长度 > Render 版（即 Render 被错识别），调
 *      POST /api/questions/update 改 answer
 *   5. 报告
 *
 * 用法：
 *   node backend/src/scripts/push-to-render.js --dry-run   # 预览
 *   node backend/src/scripts/push-to-render.js             # 实际推送
 *   RENDER_URL=https://your-app.onrender.com node backend/src/scripts/push-to-render.js
 */
import fs from "node:fs";
import path from "node:path";

const RENDER_URL = process.env.RENDER_URL || "https://quiz-platform-fbxp.onrender.com";
const LOCAL_DB = path.resolve("data/quiz-data.json");
const DRY_RUN = process.argv.includes("--dry-run");

async function callApi(endpoint, body = null, method = "POST") {
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(RENDER_URL + endpoint, opts);
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Push-to-Render: 本地多选题修复 → Render");
  console.log("=".repeat(80));
  console.log(`Target: ${RENDER_URL}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "实际推送"}`);

  // 1. 拉 Render state
  console.log("\nStep 1: 拉 Render 当前 state...");
  const remote = await callApi("/api/state", null, "GET");
  if (!remote.ok) throw new Error(`拉 Render state 失败: status=${remote.status} body=${JSON.stringify(remote.data)}`);
  console.log(`  Render 有 ${remote.data.courses.length} 门课程，共 ${remote.data.courses.reduce((s, c) => s + c.questions.length, 0)} 题`);
  for (const c of remote.data.courses) {
    console.log(`    - ${c.name} (${c.questions.length} 题)`);
  }

  // 2. 读本地 state
  console.log("\nStep 2: 读本地 state...");
  const local = JSON.parse(fs.readFileSync(LOCAL_DB, "utf8").replace(/^\uFEFF/, ""));
  const localStemMap = new Map();
  for (const c of local.courses) {
    for (const q of c.questions) {
      if (!localStemMap.has(q.stem)) localStemMap.set(q.stem, q);
    }
  }
  console.log(`  本地有 ${local.courses.length} 门课程，${localStemMap.size} 唯一 stem`);

  // 3. 找需要修复的题
  console.log("\nStep 3: 找需要修复的题...");
  const fixes = [];
  let matched = 0, renderOnly = 0;
  for (const rc of remote.data.courses) {
    if (rc.questions.length === 0) continue;
    for (const rq of rc.questions) {
      const lq = localStemMap.get(rq.stem);
      if (!lq) { renderOnly++; continue; }
      matched++;
      const remoteAnsLen = (rq.answer || []).length;
      const localAnsLen = (lq.answer || []).length;
      if (localAnsLen > 1 && remoteAnsLen === 1) {
        fixes.push({
          courseName: rc.name,
          questionId: rq.id,
          oldAnswer: [...(rq.answer || [])],
          newAnswer: lq.answer,
          stem: rq.stem.slice(0, 50)
        });
      }
    }
  }
  console.log(`  Render 习题能匹配本地 stem: ${matched}`);
  console.log(`  Render 独有（本地无）: ${renderOnly}`);
  console.log(`  需要修复（Render单选+本地多选）: ${fixes.length}`);

  if (fixes.length > 0) {
    console.log("\n前 5 个修复样本：");
    for (const f of fixes.slice(0, 5)) {
      console.log(`  [${f.courseName}] ${JSON.stringify(f.oldAnswer)} → ${JSON.stringify(f.newAnswer)} | ${f.stem}...`);
    }

    // 按课程统计
    const perCourse = {};
    for (const f of fixes) perCourse[f.courseName] = (perCourse[f.courseName] || 0) + 1;
    console.log("\n按课程统计：");
    for (const [c, n] of Object.entries(perCourse).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c.padEnd(8)}: ${n} 道`);
    }
  }

  if (DRY_RUN) {
    console.log("\n" + "=".repeat(80));
    console.log("DRY RUN：没改任何东西。去掉 --dry-run 实际推送");
    console.log("=".repeat(80));
    process.exit(0);
  }

  // 4. 推送
  console.log("\nStep 4: 推送修复...");
  let ok = 0, fail = 0;
  const startTime = Date.now();
  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i];
    const res = await callApi("/api/questions/update", {
      questionId: f.questionId,
      answer: f.newAnswer
    });
    if (res.ok) ok++;
    else {
      fail++;
      if (fail <= 3) console.error(`  ❌ [${f.courseName}] ${f.stem}: ${JSON.stringify(res.data)}`);
    }
    if ((i + 1) % 50 === 0 || i + 1 === fixes.length) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`  进度: ${i + 1}/${fixes.length}  成功 ${ok} 失败 ${fail}  耗时 ${elapsed}s`);
    }
    // 小延迟避免 Render 限流
    await new Promise(r => setTimeout(r, 50));
  }

  console.log("\n" + "=".repeat(80));
  console.log(`完成！成功 ${ok}  失败 ${fail}`);
  if (fail > 0) console.log("失败的题：可能是 ID 在 Render 重启后变了（PostgreSQL UUID），需重拉 state 重试");
  console.log("刷新网站验证：https://" + RENDER_URL.replace(/^https?:\/\//, ""));
  console.log("=".repeat(80));
}

main().catch(e => { console.error("Error:", e.message); process.exit(1); });
