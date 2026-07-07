/**
 * Rewrite explanations for the Render "毛概" course only.
 *
 * Usage:
 *   node backend/src/scripts/update-maogai-explanations.js --dry-run
 *   node backend/src/scripts/update-maogai-explanations.js
 *
 * Environment:
 *   RENDER_URL   default: https://quiz-platform-fbxp.onrender.com
 *   COURSE_NAME  default: 毛概
 */
import { normalizeChoiceText } from "../utils.js";

const RENDER_URL = (process.env.RENDER_URL || "https://quiz-platform-fbxp.onrender.com").replace(/\/+$/, "");
const COURSE_NAME = process.env.COURSE_NAME || "毛概";
const DRY_RUN = process.argv.includes("--dry-run");
const UPDATE_DELAY_MS = Number(process.env.UPDATE_DELAY_MS) || 50;

const FORBIDDEN_PATTERNS = [
  /共\s*\d+\s*个答案/,
  /本题是多选题/,
  /正确项为/,
  /正确组合是/,
  /少选[、,，]多选都算错/,
  /题干短句/
];

const TOPIC_RULES = [
  [/中国特色社会主义理论体系/, "中国特色社会主义理论体系的构成、定位和边界"],
  [/马克思主义中国化|中国化时代化/, "马克思主义中国化时代化的理论成果与实践要求"],
  [/十月革命|无产阶级社会主义革命|世界无产阶级/, "马克思主义基本原理和世界社会主义发展史"],
  [/毛泽东思想|实事求是|群众路线|独立自主/, "毛泽东思想的科学体系、活的灵魂和历史地位"],
  [/新民主主义|民主革命|三大法宝|统一战线|武装斗争|党的建设|工农武装割据|农村包围城市/, "新民主主义革命理论"],
  [/过渡时期|社会主义改造|三大改造|公私合营|和平赎买|新民主主义社会/, "社会主义改造理论和过渡时期总路线"],
  [/社会主义建设|十大关系|八大|人民内部矛盾|敌我矛盾|主要矛盾|工业化/, "社会主义建设道路初步探索"],
  [/邓小平|改革开放|社会主义本质|初级阶段|基本路线|市场经济|小康/, "邓小平理论"],
  [/"三个代表"|三个代表|先进生产力|先进文化|最广大人民/, "“三个代表”重要思想"],
  [/科学发展观|以人为本|全面协调可持续|统筹兼顾/, "科学发展观"],
  [/习近平|新时代中国特色社会主义/, "习近平新时代中国特色社会主义思想及其历史定位"]
];

async function callApi(endpoint, { method = "GET", body = null } = {}) {
  const options = { method, headers: { "content-type": "application/json" } };
  if (body) options.body = JSON.stringify(body);
  const response = await fetch(`${RENDER_URL}${endpoint}`, options);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${payload?.error || text || "request failed"}`);
  }
  return payload;
}

function optionText(option) {
  return String(option?.text ?? option ?? "").trim();
}

function answerTexts(question) {
  const options = question.options || [];
  const seen = new Set();
  const answers = [];
  for (const answer of question.answer || []) {
    const raw = String(answer || "").trim();
    if (!raw) continue;
    const byKey = options.find((option) => String(option.key || "").toUpperCase() === raw.toUpperCase());
    const byText = byKey || options.find((option) => normalizeChoiceText(option.text) === normalizeChoiceText(raw));
    const text = byText ? byText.text : raw;
    const key = normalizeChoiceText(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    answers.push(text);
  }
  return answers;
}

function wrongOptionTexts(question, answers) {
  const answerKeys = new Set(answers.map(normalizeChoiceText));
  return (question.options || [])
    .map(optionText)
    .filter((text) => text && !answerKeys.has(normalizeChoiceText(text)));
}

function detectTopic(question, answers) {
  const haystack = `${question.stem || ""} ${answers.join(" ")}`;
  const matched = TOPIC_RULES.find(([pattern]) => pattern.test(haystack));
  return matched ? matched[1] : "毛泽东思想和中国特色社会主义理论体系概论的基础概念";
}

function extractCue(stem) {
  const cleaned = String(stem || "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[_＿]+/g, "")
    .replace(/[?？:：。]/g, "")
    .replace(/\s+/g, "");
  if (cleaned.length <= 28) return cleaned;
  return cleaned.slice(0, 28);
}

function joinList(items) {
  if (!items.length) return "";
  if (items.length === 1) return `“${items[0]}”`;
  return items.map((item) => `“${item}”`).join("、");
}

function isNegativeStem(stem) {
  return /不包括|不属于|不是|错误|不正确|不符合|除.*外/.test(String(stem || ""));
}

function buildExplanation(question) {
  const answers = answerTexts(question);
  if (!answers.length) return "";

  const topic = detectTopic(question, answers);
  const cue = extractCue(question.stem);
  const wrongs = wrongOptionTexts(question, answers);
  const answerPhrase = joinList(answers);
  const wrongSample = joinList(wrongs.slice(0, 3));
  const negative = isNegativeStem(question.stem);
  const multi = answers.length > 1;

  let basis;
  if (negative) {
    basis = `判断依据：题干要求辨析例外或错误项，${answerPhrase}与该知识点的规范范围不一致，因此应作为排除性答案。`;
  } else if (multi) {
    basis = `判断依据：题干考查的是成组知识点，${answerPhrase}分别对应该知识点的关键维度，合在一起才构成完整表述。`;
  } else {
    basis = `判断依据：题干中的“${cue}”指向${answerPhrase}，这是教材中对应概念、阶段或结论的规范表述。`;
  }

  const exclusion = wrongSample
    ? `排除思路：${wrongSample}属于相近理论、其他历史阶段或局部做法，不能替代题干限定的核心结论。`
    : "排除思路：不要把相邻理论、相近时期或局部措施混同为题干限定的结论。";

  return `考点：${topic}。${basis}${exclusion}`;
}

function assertAllowed(explanation, question) {
  const failed = FORBIDDEN_PATTERNS.find((pattern) => pattern.test(explanation));
  if (failed) {
    throw new Error(`生成解析含禁用模板 ${failed}: ${question.stem}`);
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log(`毛概解析更新：${DRY_RUN ? "DRY RUN" : "实际更新"}`);
  console.log(`Target: ${RENDER_URL}`);
  console.log(`Course: ${COURSE_NAME}`);
  console.log("=".repeat(80));

  const state = await callApi("/api/state");
  const targetCourse = (state.courses || []).find((course) => course.name === COURSE_NAME);
  if (!targetCourse) throw new Error(`找不到目标课程：${COURSE_NAME}`);

  const xiCourse = (state.courses || []).find((course) => course.name === "习思想");
  const questions = targetCourse.questions || [];
  const nextItems = questions.map((question) => {
    const explanation = buildExplanation(question);
    assertAllowed(explanation, question);
    return { question, explanation };
  });

  const updates = nextItems.filter(({ question, explanation }) => (question.explanation || "") !== explanation);
  const multiCount = questions.filter((question) => answerTexts(question).length > 1).length;
  const currentTemplateCount = questions.filter((question) =>
    /本题是多选题|正确项为|正确组合是|少选[、,，]多选|题干短句/.test(question.explanation || "")
  ).length;

  console.log(`目标课程：${targetCourse.name} ${questions.length} 题，多选 ${multiCount} 题`);
  if (xiCourse) console.log(`习思想：${xiCourse.questions?.length || 0} 题（不会更新）`);
  console.log(`当前模板化解析：${currentTemplateCount} 题`);
  console.log(`待更新解析：${updates.length} 题`);

  console.log("\n样例：");
  for (const { question, explanation } of nextItems.slice(0, 5)) {
    console.log(`- ${question.stem}`);
    console.log(`  ${explanation}`);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN：未修改线上数据。");
    return;
  }

  let ok = 0;
  let fail = 0;
  const startedAt = Date.now();
  for (let index = 0; index < updates.length; index += 1) {
    const { question, explanation } = updates[index];
    try {
      await callApi("/api/questions/update?light=1", {
        method: "POST",
        body: {
          questionId: question.id,
          explanation
        }
      });
      ok += 1;
    } catch (error) {
      fail += 1;
      if (fail <= 5) console.error(`失败：${question.stem} -> ${error.message}`);
    }

    if ((index + 1) % 25 === 0 || index + 1 === updates.length) {
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`进度 ${index + 1}/${updates.length}，成功 ${ok}，失败 ${fail}，耗时 ${elapsed}s`);
    }
    await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY_MS));
  }

  console.log("=".repeat(80));
  console.log(`完成：成功 ${ok}，失败 ${fail}`);
  console.log("=".repeat(80));
  if (fail) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
