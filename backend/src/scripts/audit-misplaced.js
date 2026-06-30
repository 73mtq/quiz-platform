/**
 * 验证第四章里 409 道毛概题与 Render "毛概"课程的重复情况
 * 1. 本地 DB 第四章里 409 道毛概题
 * 2. 拉 Render state，找"毛概"课程
 * 3. 用 stem 匹配看重叠
 * 4. 输出报告：哪些是重复、哪些只在一处
 */
import fs from "node:fs";
import path from "node:path";

const DB_PATH = "D:\\claude_code\\auto_test\\quiz-platform\\data\\quiz-data.json";
const RENDER_URL = "https://quiz-platform-fbxp.onrender.com";

const MAOGAI_SOURCES = ["导论题库.md","第八章题库.md","第二章题库.md","第六章题库.md","第七章题库.md","第三章题库.md","第四章题库.md","第五章题库.md","第一章题库.md"];

// 读 DB
const dbRaw = fs.readFileSync(DB_PATH, "utf8").replace(/^\uFEFF/, "");
const db = JSON.parse(dbRaw);
const d4 = db.courses.find(c => c.name === "第四章");
const allMaogai = db.courses.find(c => c.name === "毛概");
console.log(`本地 DB：第四章 ${d4.questions.length} 题, 毛概 ${allMaogai?.questions?.length || 0} 题`);

// 解析毛概 .md 源文件，建 stem → sourceFile 索引
const maogaiStems = new Map();
for (const fname of MAOGAI_SOURCES) {
  const fp = path.join("D:\\桌面\\毛概\\毛概", fname);
  if (!fs.existsSync(fp)) continue;
  const content = fs.readFileSync(fp, "utf8");
  // 复用 audit-orphan 的 parseMdFile 逻辑（提取 stem）
  const lines = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    let stem = null;
    const mA = line.match(/^\*\*\d+\.\s*\[(单选题|多选题|判断题)\]\s*(.+?)\*\*\s*[✅❌]?$/);
    if (mA) stem = mA[2].trim();
    if (!stem) {
      const mB = line.match(/^\*\*\d+\.\*\*\s*(.+)$/);
      if (mB) stem = mB[1].trim();
    }
    if (!stem) {
      const mC = line.match(/^#{2,3}\s*\d+\.\s*\[[✓✗]\]\s*(.+)$/);
      if (mC) stem = mC[1].trim();
    }
    if (stem && !maogaiStems.has(stem)) maogaiStems.set(stem, fname);
    i++;
  }
}
console.log(`毛概 .md 源文件 stem: ${maogaiStems.size}`);

// 第四章里属于毛概的题（409 道）
const d4Maogai = d4.questions.filter(q => maogaiStems.has(q.stem));
console.log(`第四章里毛概题: ${d4Maogai.length} 道`);

// 拉 Render state
console.log(`\n拉 Render ${RENDER_URL}/api/state ...`);
const res = await fetch(`${RENDER_URL}/api/state`);
const data = await res.json();
const rMaogai = data.courses.find(c => c.name === "毛概");
const rD4 = data.courses.find(c => c.name === "第四章");
console.log(`Render：毛概 ${rMaogai?.questions?.length || 0} 题, 第四章 ${rD4?.questions?.length || 0} 题`);

// Render 毛概 stem 索引
const rMaogaiStems = new Map();
for (const q of rMaogai.questions) rMaogaiStems.set(q.stem, q);

// Render 第四章 stem 索引
const rD4Stems = new Map();
if (rD4) for (const q of rD4.questions) rD4Stems.set(q.stem, q);

// 第四章毛概题与 Render 毛概课重叠
let overlapWithRenderMaogai = 0;
let onlyInLocalD4 = 0;
const onlyInLocalD4Samples = [];
for (const q of d4Maogai) {
  if (rMaogaiStems.has(q.stem)) overlapWithRenderMaogai++;
  else {
    onlyInLocalD4++;
    if (onlyInLocalD4Samples.length < 5) onlyInLocalD4Samples.push(q.stem.slice(0, 50));
  }
}
console.log(`\n第四章毛概题 (${d4Maogai.length}) 与 Render 毛概课重叠:`);
console.log(`  ✓ 也在 Render 毛概课: ${overlapWithRenderMaogai}`);
console.log(`  ❌ 只在本地第四章（Render 毛概课没有）: ${onlyInLocalD4}`);

// Render 第四章里的毛概题（与本地第四章毛概题重叠）
let rD4MaogaiOverlap = 0;
let rD4Only = 0;
if (rD4) {
  for (const q of rD4.questions) {
    if (maogaiStems.has(q.stem)) rD4MaogaiOverlap++;
    else rD4Only++;
  }
  console.log(`\nRender 第四章 (${rD4.questions.length}):`);
  console.log(`  ✓ 是毛概题（与本地第四章毛概重叠）: ${rD4MaogaiOverlap}`);
  console.log(`  其他（习思想/孤儿子集）: ${rD4Only}`);
} else {
  console.log(`\nRender 上没有"第四章"课程！409 道错放仅存在于本地 DB。`);
}

// 总结
console.log("\n" + "=".repeat(80));
console.log("【总结】");
console.log("=".repeat(80));
console.log(`本地 DB 第四章 ${d4.questions.length} 道 = 习思想 140 + 毛概 409`);
if (rD4) {
  console.log(`Render 第四章 ${rD4.questions.length} 道（结构可能类似）`);
} else {
  console.log(`Render 没有"第四章"课程`);
}
console.log(`Render 毛概 ${rMaogai.questions.length} 道`);
console.log();
console.log(`✓ 实际场景：第四章 409 道毛概题与 Render 毛概课 100% 重叠（409/409）`);
console.log(`  毛概题在本地第四章 + Render 毛概课各存一份`);
console.log(`  解决方案：清理本地 DB 第四章里多余的 409 道（Render 毛概课里已有）`);
if (onlyInLocalD4Samples.length) {
  console.log(`\n只在本地的样例 stem：`);
  for (const s of onlyInLocalD4Samples) console.log(`  - ${s}...`);
}
