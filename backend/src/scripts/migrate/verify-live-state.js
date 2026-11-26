import fs from "node:fs/promises";
import { normalizeState } from "../../repositories/StateShape.js";

const args = process.argv.slice(2);
const baseUrl = String((args[1] ? args[0] : process.env.API_URL) || "").replace(/\/+$/, "");
const snapshotPath = args[1] || args[0];
if (!baseUrl || !snapshotPath) {
  console.error("用法：node backend/src/scripts/migrate/verify-live-state.js <baseUrl> <snapshot.json>");
  console.error("或：API_URL=<baseUrl> node backend/src/scripts/migrate/verify-live-state.js <snapshot.json>");
  process.exit(1);
}

const snapshot = normalizeState(JSON.parse(await fs.readFile(snapshotPath, "utf8")));
const response = await fetch(`${baseUrl}/api/state`);
if (!response.ok) {
  console.error(`读取线上状态失败：HTTP ${response.status}`);
  process.exit(1);
}
const live = normalizeState(await response.json());

const errors = [];
if (snapshot.activeCourseId !== live.activeCourseId) {
  errors.push(`activeCourseId 不一致：快照 ${snapshot.activeCourseId}，线上 ${live.activeCourseId}`);
}
if (snapshot.courses.length !== live.courses.length) {
  errors.push(`课程数量不一致：快照 ${snapshot.courses.length}，线上 ${live.courses.length}`);
}

const liveCourses = new Map(live.courses.map((course) => [course.id, course]));
for (const beforeCourse of snapshot.courses) {
  const afterCourse = liveCourses.get(beforeCourse.id);
  if (!afterCourse) {
    errors.push(`线上缺少课程：${beforeCourse.name}（${beforeCourse.id}）`);
    continue;
  }
  if (beforeCourse.name !== afterCourse.name) {
    errors.push(`课程名称不一致：${beforeCourse.id} 快照 ${beforeCourse.name}，线上 ${afterCourse.name}`);
  }
  if (beforeCourse.questions.length !== afterCourse.questions.length) {
    errors.push(`题数不一致：${beforeCourse.name} 快照 ${beforeCourse.questions.length}，线上 ${afterCourse.questions.length}`);
    continue;
  }
  if (JSON.stringify(beforeCourse.practice) !== JSON.stringify(afterCourse.practice)) {
    errors.push(`练习状态不一致：${beforeCourse.name}`);
  }

  const afterQuestions = new Map(afterCourse.questions.map((question) => [question.id, question]));
  for (const beforeQuestion of beforeCourse.questions) {
    const afterQuestion = afterQuestions.get(beforeQuestion.id);
    if (!afterQuestion) {
      errors.push(`线上缺少题目：${beforeCourse.name} / ${beforeQuestion.id}`);
      continue;
    }
    const beforeStats = {
      wrongCount: beforeQuestion.wrongCount,
      correctCount: beforeQuestion.correctCount,
      bookmarked: beforeQuestion.bookmarked,
      review: beforeQuestion.review
    };
    const afterStats = {
      wrongCount: afterQuestion.wrongCount,
      correctCount: afterQuestion.correctCount,
      bookmarked: afterQuestion.bookmarked,
      review: afterQuestion.review
    };
    if (JSON.stringify(beforeStats) !== JSON.stringify(afterStats)) {
      errors.push(`题目统计不一致：${beforeQuestion.id}（${beforeQuestion.stem.slice(0, 40)}）`);
    }
  }
}

if (errors.length) {
  console.error(`发现 ${errors.length} 处差异：`);
  for (const error of errors.slice(0, 50)) console.error(`- ${error}`);
  if (errors.length > 50) console.error(`还有 ${errors.length - 50} 处未显示`);
  process.exit(1);
}

console.log(`状态一致：${snapshot.courses.length} 门课程，${snapshot.courses.reduce((sum, course) => sum + course.questions.length, 0)} 道题`);
