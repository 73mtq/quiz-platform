import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dataFile } from "../config.js";
import { JsonQuizRepository } from "../repositories/JsonQuizRepository.js";
import { normalizeQuestion, validateQuestion } from "../utils.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const defaultSource = path.resolve(currentDir, "../../../../quiz-maker/data/quiz-data.json");
const sourceFile = process.argv[2] ? path.resolve(process.argv[2]) : defaultSource;

const source = JSON.parse(await fs.readFile(sourceFile, "utf8"));
const repository = new JsonQuizRepository(dataFile);
const current = await repository.getState();
const backupFile = `${dataFile}.${timestamp()}.bak`;

await fs.mkdir(path.dirname(dataFile), { recursive: true });
await fs.copyFile(dataFile, backupFile).catch(async () => {
  await fs.writeFile(backupFile, `${JSON.stringify(current, null, 2)}\n`, "utf8");
});

const result = mergeState(current, source, repository);
await repository.saveState(result.state);

console.log(`Source: ${sourceFile}`);
console.log(`Target: ${dataFile}`);
console.log(`Backup: ${backupFile}`);
console.log(`Imported courses: ${result.importedCourses}`);
console.log(`Imported questions: ${result.importedQuestions}`);
console.log(`Skipped duplicates: ${result.skippedDuplicates}`);
console.log(`Skipped invalid: ${result.skippedInvalid}`);

function mergeState(currentState, sourceState, repo) {
  let importedCourses = 0;
  let importedQuestions = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;
  const target = repo.normalizeState(currentState);

  for (const sourceCourse of sourceState.courses || []) {
    const sourceQuestions = sourceCourse.questions || sourceCourse.bank || [];
    let targetCourse = findMatchingCourse(target, sourceCourse);
    if (!targetCourse) {
      targetCourse = {
        id: sourceCourse.id || repo.createCourse(sourceCourse.name || "导入课程").id,
        name: sourceCourse.name || "导入课程",
        questions: [],
        practice: repo.emptyPractice(),
        createdAt: sourceCourse.createdAt || new Date().toISOString()
      };
      target.courses.push(targetCourse);
      importedCourses += 1;
    }

    const existingKeys = new Set(targetCourse.questions.map(questionKey));
    for (const rawQuestion of sourceQuestions) {
      const question = normalizeQuestion(rawQuestion);
      const reason = validateQuestion(question);
      if (reason) {
        skippedInvalid += 1;
        continue;
      }
      const key = questionKey(question);
      if (existingKeys.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      targetCourse.questions.push(question);
      existingKeys.add(key);
      importedQuestions += 1;
    }
  }

  if (!target.courses.some((course) => course.id === target.activeCourseId)) {
    target.activeCourseId = target.courses[0]?.id || "";
  }

  return { state: target, importedCourses, importedQuestions, skippedDuplicates, skippedInvalid };
}

function findMatchingCourse(state, sourceCourse) {
  return state.courses.find((course) => course.id === sourceCourse.id)
    || state.courses.find((course) => course.name === sourceCourse.name);
}

function questionKey(question) {
  return question.id || `${question.stem}::${question.answer.join(",")}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
