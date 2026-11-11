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
    this._cache = null;
    this._writeQueue = Promise.resolve();
  }

  /** 读取状态；命中缓存时只复制内存对象 */
  async getState() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const stat = await fs.stat(this.filePath).catch(() => null);
    if (stat && this._cache && this._cache.mtimeMs === stat.mtimeMs && this._cache.size === stat.size) {
      return structuredClone(this._cache.state);
    }

    let content;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const state = this.normalizeState({});
      await this._writeState(state, { skipBackup: true });
      return structuredClone(state);
    }

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(`题库文件解析失败，原文件保持原样：${this.filePath}（${error.message}）`);
    }

    const state = this.normalizeState(parsed);
    this._cache = { mtimeMs: stat.mtimeMs, size: stat.size, state };
    return structuredClone(state);
  }

  async saveState(state, { skipBackup = false } = {}) {
    const normalized = this.normalizeState(state);
    await this._writeState(normalized, { skipBackup });
  }

  /** 串行执行 读取 → 修改 → 保存，避免并发覆盖 */
  async update(mutator, { skipBackup = false } = {}) {
    const run = this._writeQueue.then(async () => {
      const state = await this.getState();
      await mutator(state);
      const normalized = this.normalizeState(state);
      await this._writeState(normalized, { skipBackup });
      return normalized;
    });
    this._writeQueue = run.then(() => undefined, () => undefined);
    return run;
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

  /** 写入主文件：先写临时文件再替换，保证中断时旧文件完整 */
  async _writeState(state, { skipBackup = false } = {}) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const nextContent = `${JSON.stringify(state, null, 2)}\n`;
    if (!skipBackup) await this.backupExistingFile(nextContent);
    const tempPath = `${this.filePath}.tmp`;
    await fs.writeFile(tempPath, nextContent, "utf8");
    await fs.rename(tempPath, this.filePath);
    const stat = await fs.stat(this.filePath);
    this._cache = { mtimeMs: stat.mtimeMs, size: stat.size, state };
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
