import fs from "node:fs/promises";
import path from "node:path";
import { normalizeQuestion } from "../utils.js";
import {
  createCourse as createCourseShape,
  emptyPractice as emptyPracticeShape,
  getActiveCourse as getActiveCourseShape,
  normalizePractice,
  normalizeState as normalizeStateShape
} from "./StateShape.js";

export class JsonQuizRepository {
  constructor(filePath) {
    this.filePath = filePath;
    this.backupLimit = 80;
    this._cache = null;
    this._revision = 0;
    this._writeQueue = Promise.resolve();
  }

  /** 读取只读状态引用；调用方不得修改返回值 */
  async readState() {
    return this._loadState();
  }

  /** 读取状态副本；脚本与测试使用 */
  async getState() {
    const state = await this._loadState();
    return structuredClone(state);
  }

  async saveState(state, { skipBackup = false } = {}) {
    const normalized = this.normalizeState(state);
    await this._writeState(normalized, { skipBackup });
  }

  getRevision() {
    return Number(this._revision) || 0;
  }

  /** 串行执行 读取 → 修改 → 保存；mutator 返回 false 表示没有变化，跳过写盘 */
  async update(mutator, { skipBackup = false } = {}) {
    const run = this._writeQueue.then(async () => {
      const state = await this.getState();
      const changed = await mutator(state);
      if (changed === false) return state;
      const normalized = this.normalizeState(state, { normalizeQuestions: false });
      await this._writeState(normalized, { skipBackup });
      return normalized;
    });
    this._writeQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  /** 只修改指定课程的练习状态；本地文件模式仍整文件写入 */
  async updatePractice(courseId, mutator, { operationId = "" } = {}) {
    return this._updateCourse(courseId, mutator, { operationId });
  }

  /** 修改指定题目的统计与练习状态；本地文件模式仍整文件写入 */
  async updateAnswer(courseId, questionId, mutator, { operationId = "" } = {}) {
    return this._updateCourse(courseId, mutator, { operationId, questionId });
  }

  async updateStats(courseId, questionId, mutator, { operationId = "" } = {}) {
    return this._updateCourse(courseId, mutator, { operationId, questionId });
  }

  async setActiveCourse(courseId) {
    let target = null;
    await this.update((draft) => {
      const course = draft.courses.find((item) => item.id === courseId);
      if (!course) return false;
      target = course;
      if (draft.activeCourseId === courseId) return false;
      draft.activeCourseId = courseId;
    }, { skipBackup: true });

    if (!target) return null;
    const state = await this.readState();
    const course = getActiveCourseShape(state);
    return {
      activeCourseId: course.id,
      course,
      revision: this.getRevision()
    };
  }

  normalizeState(state, options) {
    return normalizeStateShape(state, options);
  }

  getActiveCourse(state) {
    return getActiveCourseShape(state);
  }

  createCourse(name) {
    return createCourseShape(name);
  }

  emptyPractice() {
    return emptyPracticeShape();
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

  updateQuestion(state, questionId, data) {
    const course = state.courses.find((item) => item.questions.some((question) => question.id === questionId));
    if (!course) return null;
    const question = course.questions.find((item) => item.id === questionId);

    const merged = { ...question, id: questionId, createdAt: question.createdAt };
    if (data.type !== undefined) merged.type = data.type;
    if (data.stem !== undefined) merged.stem = data.stem;
    if (data.options !== undefined) merged.options = data.options;
    if (data.answer !== undefined) merged.answer = data.answer;
    if (data.explanation !== undefined) merged.explanation = data.explanation;
    if (data.memoryTip !== undefined) merged.memoryTip = data.memoryTip;

    const normalized = normalizeQuestion(merged);
    normalized.updatedAt = new Date().toISOString();

    const index = course.questions.findIndex((item) => item.id === questionId);
    course.questions[index] = normalized;
    return normalized;
  }

  async _loadState() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const stat = await fs.stat(this.filePath).catch(() => null);
    if (stat && this._cache && this._cache.mtimeMs === stat.mtimeMs && this._cache.size === stat.size) {
      this._revision = stat.mtimeMs;
      return this._cache.state;
    }

    let content;
    try {
      content = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const state = this.normalizeState({});
      await this._writeState(state, { skipBackup: true });
      return this._cache.state;
    }

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(`题库文件解析失败，原文件保持原样：${this.filePath}（${error.message}）`);
    }

    const state = this.normalizeState(parsed);
    this._cache = { mtimeMs: stat.mtimeMs, size: stat.size, state };
    this._revision = stat.mtimeMs;
    return state;
  }

  async _updateCourse(courseId, mutator, { questionId = null, operationId = "" } = {}) {
    let result = null;
    let missingQuestion = false;

    await this.update(async (draft) => {
      const course = draft.courses.find((item) => item.id === (courseId || draft.activeCourseId));
      if (!course) return false;
      if (questionId && !course.questions.some((question) => question.id === questionId)) {
        missingQuestion = true;
        return false;
      }

      const currentPractice = normalizePractice(course.practice);
      const opId = String(operationId || "").trim();
      if (opId && currentPractice.recentOperationIds.includes(opId)) {
        result = {
          courseId: course.id,
          practice: currentPractice,
          question: questionId ? course.questions.find((question) => question.id === questionId) : null,
          duplicate: true
        };
        return false;
      }

      const originalPractice = normalizePractice(currentPractice);
      course.practice = normalizePractice(currentPractice);
      const view = {
        activeCourseId: course.id,
        courses: [{ ...course, practice: course.practice }]
      };

      const changed = await mutator(view);
      if (changed === false) {
        result = {
          courseId: course.id,
          practice: originalPractice,
          question: questionId ? course.questions.find((question) => question.id === questionId) : null,
          duplicate: false
        };
        return false;
      }

      const nextPractice = normalizePractice(course.practice);
      if (opId) {
        nextPractice.recentOperationIds = [opId, ...nextPractice.recentOperationIds.filter((id) => id !== opId)].slice(0, 50);
      }
      course.practice = nextPractice;
      result = {
        courseId: course.id,
        practice: nextPractice,
        question: questionId ? course.questions.find((question) => question.id === questionId) : null,
        duplicate: false
      };
    }, { skipBackup: true });

    if (missingQuestion) return { missingQuestion: true };
    if (!result) return null;
    result.revision = this.getRevision();
    return result;
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
    this._revision = stat.mtimeMs;
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
