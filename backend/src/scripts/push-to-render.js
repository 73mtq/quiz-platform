/**
 * 用完整 ocs-answerer-wrapper 题库把 Render 上的答案修成"选项内容"。
 *
 * 用法：
 *   node backend/src/scripts/push-to-render.js --dry-run
 *   node backend/src/scripts/push-to-render.js
 *
 * 可选环境变量：
 *   RENDER_URL    默认 https://quiz-platform-fbxp.onrender.com
 *   WRAPPER_PATH  默认 D:\桌面\习思想\习思题库\ocs-answerer-wrapper.json
 *   TARGET_COURSE 默认 习思想，设为空字符串可扫描全部课程
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeChoiceText, normalizeQuestion } from "../utils.js";

const RENDER_URL = (process.env.RENDER_URL || "https://quiz-platform-fbxp.onrender.com").replace(/\/+$/, "");
const WRAPPER_PATH = process.env.WRAPPER_PATH || "D:\\桌面\\习思想\\习思题库\\ocs-answerer-wrapper.json";
const TARGET_COURSE = process.env.TARGET_COURSE === undefined ? "习思想" : process.env.TARGET_COURSE;
const DRY_RUN = process.argv.includes("--dry-run");

async function callApi(endpoint, body = null, method = "POST") {
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(RENDER_URL + endpoint, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function parseWrapperBank(filePath) {
  const wrapper = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const handler = wrapper?.[0]?.handler || "";
  const marker = "const bank = JSON.parse(\"";
  const start = handler.indexOf(marker);
  if (start === -1) throw new Error("未在 wrapper handler 中找到题库 JSON");
  const from = start + marker.length;
  const end = handler.indexOf("\");", from);
  if (end === -1) throw new Error("wrapper handler 中的题库 JSON 未闭合");

  const escapedJson = handler.slice(from, end);
  const jsonText = JSON.parse(`"${escapedJson}"`);
  return JSON.parse(jsonText);
}

function uniqueSetKey(values) {
  return [...new Set((values || []).map(normalizeChoiceText).filter(Boolean))].sort().join("|");
}

function optionSetKey(options) {
  return uniqueSetKey((options || []).map((option) => option.text ?? option));
}

function stemKey(value) {
  return normalizeChoiceText(String(value || "").replace(/&nbsp;/g, ""));
}

function fullQuestionKey(stem, options) {
  return `${stemKey(stem)}::${optionSetKey(options)}`;
}

function buildWrapperIndexes(bank) {
  const byFull = new Map();
  const byStem = new Map();
  for (const item of bank) {
    const answerTexts = Array.isArray(item.t) ? item.t : String(item.a || "").split("#").filter(Boolean);
    const normalized = {
      stem: item.q || "",
      key: item.k || item.q || "",
      options: item.o || [],
      answerTexts
    };
    const full = `${stemKey(normalized.key)}::${uniqueSetKey(normalized.options)}`;
    if (!byFull.has(full)) byFull.set(full, []);
    byFull.get(full).push(normalized);

    const stem = stemKey(normalized.key);
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(normalized);
  }
  return { byFull, byStem };
}

function resolveAnswerTexts(question, wrapperAnswers) {
  return wrapperAnswers.map((answer) => {
    const matched = question.options.find((option) => normalizeChoiceText(option.text) === normalizeChoiceText(answer));
    return matched ? matched.text : answer;
  }).filter(Boolean);
}

function findWrapperCandidate(question, indexes) {
  const full = fullQuestionKey(question.stem, question.options);
  const fullMatches = indexes.byFull.get(full) || [];
  if (fullMatches.length) return { matchType: "full", candidates: fullMatches };

  const stemMatches = indexes.byStem.get(stemKey(question.stem)) || [];
  if (stemMatches.length === 1) return { matchType: "stem", candidates: stemMatches };

  return { matchType: "none", candidates: [] };
}

function collectFixes(remoteState, indexes) {
  const fixes = [];
  const skipped = [];
  let matched = 0;
  let legacyAnswerCount = 0;
  let choiceQuestionCount = 0;

  for (const course of remoteState.courses || []) {
    if (TARGET_COURSE && course.name !== TARGET_COURSE) continue;

    for (const rawQuestion of course.questions || []) {
      if (rawQuestion.type === "fill-blank") continue;
      choiceQuestionCount += 1;

      const normalized = normalizeQuestion(rawQuestion);
      const answerLooksLegacy = (rawQuestion.answer || []).some((answer) =>
        rawQuestion.options?.some((option) => String(option.key || "").toUpperCase() === String(answer || "").toUpperCase())
      );
      if (answerLooksLegacy) legacyAnswerCount += 1;

      const { matchType, candidates } = findWrapperCandidate(normalized, indexes);
      if (!candidates.length) {
        if (skipped.length < 10) {
          skipped.push({
            course: course.name,
            reason: "完整题库中未匹配",
            stem: normalized.stem.slice(0, 80)
          });
        }
        continue;
      }
      matched += 1;

      const currentKey = uniqueSetKey(normalized.answer);
      const candidate = candidates.find((item) => uniqueSetKey(item.answerTexts) !== currentKey) || candidates[0];
      const nextAnswer = resolveAnswerTexts(normalized, candidate.answerTexts);
      const nextKey = uniqueSetKey(nextAnswer);
      if (!nextKey || nextKey === currentKey) continue;

      fixes.push({
        courseName: course.name,
        questionId: rawQuestion.id,
        matchType,
        oldAnswer: normalized.answer,
        newAnswer: nextAnswer,
        stem: normalized.stem.slice(0, 100)
      });
    }
  }

  return { fixes, skipped, matched, legacyAnswerCount, choiceQuestionCount };
}

async function main() {
  console.log("=".repeat(80));
  console.log("Push-to-Render: 答案内容绑定修复");
  console.log("=".repeat(80));
  console.log(`Target: ${RENDER_URL}`);
  console.log(`Wrapper: ${path.resolve(WRAPPER_PATH)}`);
  console.log(`Course: ${TARGET_COURSE || "全部课程"}`);
  console.log(`Mode: ${DRY_RUN ? "DRY RUN" : "实际推送"}`);

  const bank = parseWrapperBank(WRAPPER_PATH);
  const indexes = buildWrapperIndexes(bank);
  console.log(`完整题库：${bank.length} 题`);

  const remote = await callApi("/api/state", null, "GET");
  if (!remote.ok) {
    throw new Error(`拉 Render state 失败: status=${remote.status} body=${JSON.stringify(remote.data)}`);
  }

  const remoteCount = (remote.data.courses || []).reduce((sum, course) => sum + (course.questions || []).length, 0);
  console.log(`Render：${remote.data.courses.length} 门课程，${remoteCount} 题`);

  const { fixes, skipped, matched, legacyAnswerCount, choiceQuestionCount } = collectFixes(remote.data, indexes);
  console.log(`匹配完整题库：${matched} 题`);
  console.log(`疑似仍按字母返回答案：${legacyAnswerCount}/${choiceQuestionCount} 题`);
  console.log(`需要修复答案内容：${fixes.length} 题`);

  if (fixes.length) {
    console.log("\n修复样本（前 10）：");
    for (const fix of fixes.slice(0, 10)) {
      console.log(`  [${fix.courseName}] ${JSON.stringify(fix.oldAnswer)} -> ${JSON.stringify(fix.newAnswer)} | ${fix.stem}`);
    }
  }

  if (skipped.length) {
    console.log("\n跳过样本（前 10）：");
    for (const item of skipped) {
      console.log(`  [${item.course}] ${item.reason}: ${item.stem}`);
    }
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN：未修改线上数据。");
    return;
  }

  if (legacyAnswerCount > choiceQuestionCount * 0.75) {
    throw new Error("Render 仍大量返回字母答案，说明新代码可能尚未部署完成；请稍后重试。");
  }

  let ok = 0;
  let fail = 0;
  const startedAt = Date.now();
  for (let index = 0; index < fixes.length; index += 1) {
    const fix = fixes[index];
    const res = await callApi("/api/questions/update", {
      questionId: fix.questionId,
      answer: fix.newAnswer
    });
    if (res.ok) {
      ok += 1;
    } else {
      fail += 1;
      if (fail <= 5) console.error(`  失败 [${fix.courseName}] ${fix.stem}: ${JSON.stringify(res.data)}`);
    }
    if ((index + 1) % 25 === 0 || index + 1 === fixes.length) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`  进度 ${index + 1}/${fixes.length} 成功 ${ok} 失败 ${fail} 耗时 ${elapsed}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log("\n" + "=".repeat(80));
  console.log(`完成：成功 ${ok}，失败 ${fail}`);
  console.log(`刷新验证：${RENDER_URL}`);
  console.log("=".repeat(80));
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
