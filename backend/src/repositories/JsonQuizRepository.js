import fs from "node:fs/promises";
import path from "node:path";
import { createId, normalizeQuestion, validateQuestion } from "../utils.js";

function emptyPractice() {
  return {
    roundNo: 1,
    remainingIds: [],
    answeredInRound: 0,
    correctInRound: 0,
    totalAnswered: 0,
    totalCorrect: 0,
    currentQuestionId: null,
    lastAnswer: null,
    mode: "all",
    count: 0,
    exam: emptyExam()
  };
}

function emptyExam() {
  return {
    timeLimitMinutes: 20,
    startedAt: "",
    finishedAt: "",
    questionIds: [],
    answers: [],
    lastWrongIds: [],
    lastSummary: null
  };
}

function createCourse(name) {
  return {
    id: createId("course"),
    name,
    questions: [],
    practice: emptyPractice(),
    createdAt: new Date().toISOString()
  };
}

export class JsonQuizRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.backupLimit = 80;
  }

  async getState() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const content = (await fs.readFile(this.filePath, "utf8")).replace(/^\uFEFF/, "");
      const parsed = JSON.parse(content);
      return this.normalizeState(parsed);
    } catch {
      const state = this.normalizeState({});
      await this.saveState(state);
      return state;
    }
  }

  async saveState(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const normalized = this.normalizeState(state);
    const nextContent = `${JSON.stringify(normalized, null, 2)}\n`;
    await this.backupExistingFile(nextContent);
    await fs.writeFile(this.filePath, nextContent, "utf8");
  }

  async update(mutator) {
    const state = await this.getState();
    await mutator(state);
    await this.saveState(state);
    return this.getState();
  }

  normalizeState(state) {
    let courses = Array.isArray(state.courses) ? state.courses : [];
    if (!courses.length) courses = [createCourse("默认课程")];

    courses = courses.map((course) => ({
      id: course.id || createId("course"),
      name: course.name || "未命名课程",
      questions: (course.questions || course.bank || [])
        .map(normalizeQuestion)
        .filter((question) => !validateQuestion(question)),
      practice: normalizePractice(course.practice || course.round?.stats || {}),
      createdAt: course.createdAt || new Date().toISOString()
    }));

    const activeCourseId = courses.some((course) => course.id === state.activeCourseId)
      ? state.activeCourseId
      : courses[0].id;

    return { activeCourseId, courses };
  }

  getActiveCourse(state) {
    return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
  }

  createCourse(name) {
    return createCourse(name);
  }

  updateQuestion(state, questionId, data) {
    const course = state.courses.find((item) => item.questions.some((q) => q.id === questionId));
    if (!course) return null;
    const question = course.questions.find((q) => q.id === questionId);

    const merged = { ...question, id: questionId, createdAt: question.createdAt };
    if (data.type !== undefined) merged.type = data.type;
    if (data.stem !== undefined) merged.stem = data.stem;
    if (data.options !== undefined) merged.options = data.options;
    if (data.answer !== undefined) merged.answer = data.answer;
    if (data.explanation !== undefined) merged.explanation = data.explanation;
    if (data.memoryTip !== undefined) merged.memoryTip = data.memoryTip;

    const normalized = normalizeQuestion(merged);
    normalized.updatedAt = new Date().toISOString();

    const index = course.questions.findIndex((q) => q.id === questionId);
    course.questions[index] = normalized;
    return normalized;
  }

  emptyPractice() {
    return emptyPractice();
  }

  async listBackups() {
    const backupDir = path.join(path.dirname(this.filePath), "backups");
    const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
    const backups = [];

    for (const entry of entries) {
      if (!entry.isFile() || !/^quiz-data\..+\.json$/.test(entry.name)) continue;
      const file = path.join(backupDir, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) continue;

      let questionCount = 0;
      try {
        const parsed = JSON.parse(await fs.readFile(file, "utf8"));
        questionCount = (parsed.courses || [])
          .reduce((sum, course) => sum + (course.questions || course.bank || []).length, 0);
      } catch {
        questionCount = 0;
      }

      backups.push({
        name: entry.name,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
        questionCount
      });
    }

    return backups.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async backupExistingFile(nextContent) {
    let currentContent = "";
    try {
      currentContent = await fs.readFile(this.filePath, "utf8");
    } catch {
      return;
    }

    if (!currentContent.trim() || currentContent === nextContent) return;

    const backupDir = path.join(path.dirname(this.filePath), "backups");
    await fs.mkdir(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = path.join(backupDir, `quiz-data.${timestamp}.json`);
    await fs.writeFile(backupPath, currentContent, "utf8");
    await this.pruneBackups(backupDir);
  }

  async pruneBackups(backupDir) {
    const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch(() => []);
    const backups = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^quiz-data\..+\.json$/.test(entry.name)) continue;
      const file = path.join(backupDir, entry.name);
      const stat = await fs.stat(file).catch(() => null);
      if (stat) backups.push({ file, mtimeMs: stat.mtimeMs });
    }

    backups
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(this.backupLimit)
      .forEach((backup) => {
        fs.unlink(backup.file).catch(() => {});
      });
  }
}

function normalizePractice(practice = {}) {
  const base = {
    ...emptyPractice(),
    ...practice
  };
  return {
    ...base,
    exam: {
      ...emptyExam(),
      ...(practice.exam || {})
    }
  };
}
