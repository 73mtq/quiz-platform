import assert from "node:assert/strict";
import pg from "pg";
import { normalizeQuestion, normalizeReviewState } from "../utils.js";
import {
  createCourse as createCourseShape,
  emptyPractice as emptyPracticeShape,
  getActiveCourse as getActiveCourseShape,
  isDefaultStats,
  mergeState,
  normalizePractice,
  normalizeState,
  splitState,
  statsPatchForQuestion
} from "./StateShape.js";

const { Pool } = pg;

export class SqlQuizRepository {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    this.pool.on("error", (error) => {
      console.error("[pg] 空闲连接错误:", error.message);
    });
    this._initialized = false;
    this._initPromise = null;
    this._layoutReady = false;
    this._layoutPromise = null;
    this._cache = null;
    this._data = null;
  }

  /** 初始化数据库表与列 */
  async _ensureTable() {
    if (this._initialized) return;
    if (!this._initPromise) {
      this._initPromise = (async () => {
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS quiz_data (
            id INT PRIMARY KEY DEFAULT 1,
            data JSONB NOT NULL,
            practice JSONB,
            stats JSONB,
            revision BIGINT NOT NULL DEFAULT 0,
            schema_version INT NOT NULL DEFAULT 1,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await this.pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS practice JSONB");
        await this.pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS stats JSONB");
        await this.pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0");
        await this.pool.query("ALTER TABLE quiz_data ADD COLUMN IF NOT EXISTS schema_version INT NOT NULL DEFAULT 1");
        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS quiz_data_backups (
            id INT PRIMARY KEY,
            snapshot JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        const initial = normalizeState({});
        const { data, practice, stats } = splitState(initial);
        await this.pool.query(
          `INSERT INTO quiz_data (id, data, practice, stats, revision, schema_version)
           VALUES (1, $1, $2, $3, 0, 2)
           ON CONFLICT (id) DO NOTHING`,
          [JSON.stringify(data), JSON.stringify(practice), JSON.stringify(stats)]
        );
        this._initialized = true;
      })().catch((error) => {
        this._initPromise = null;
        throw error;
      });
    }
    await this._initPromise;
  }

  async _ensureLayout() {
    await this._ensureTable();
    if (this._layoutReady) return;
    if (!this._layoutPromise) {
      this._layoutPromise = this._migrateLayout().catch((error) => {
        this._layoutPromise = null;
        throw error;
      });
    }
    await this._layoutPromise;
    this._layoutReady = true;
  }

  async _ensureReady() {
    await this._ensureLayout();
    if (!this._data) {
      const result = await this.pool.query("SELECT data FROM quiz_data WHERE id = 1");
      if (!result.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
      this._data = result.rows[0].data || { courses: [] };
    }
  }

  /** 读取只读状态引用；调用方不得修改返回值 */
  async readState() {
    await this._ensureReady();
    const version = await this.pool.query("SELECT revision FROM quiz_data WHERE id = 1");
    if (!version.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
    const revision = Number(version.rows[0].revision) || 0;
    if (this._cache && this._cache.revision === revision) return this._cache.state;

    const result = await this.pool.query("SELECT data, practice, stats, revision FROM quiz_data WHERE id = 1");
    const record = result.rows[0];
    if (!record) throw new Error("quiz_data 表缺少 id=1 的数据行");
    const state = mergeState(record.data, record.practice, record.stats);
    this._data = record.data;
    this._cache = { revision: Number(record.revision) || 0, state };
    return state;
  }

  async getState() {
    return structuredClone(await this.readState());
  }

  getRevision() {
    return Number(this._cache?.revision) || 0;
  }

  /** 保存完整状态；脚本使用 */
  async saveState(state) {
    await this._ensureReady();
    const normalized = normalizeState(state);
    const { data, practice, stats } = splitState(normalized);
    const updated = await this.pool.query(
      `UPDATE quiz_data
       SET data = $1, practice = $2, stats = $3, schema_version = 2,
           revision = revision + 1, updated_at = NOW()
       WHERE id = 1 RETURNING revision`,
      [JSON.stringify(data), JSON.stringify(practice), JSON.stringify(stats)]
    );
    if (!updated.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
    this._data = data;
    this._cache = {
      revision: Number(updated.rows[0].revision),
      state: mergeState(data, practice, stats)
    };
  }

  /** 事务内更新完整状态：题目、课程与练习进度 */
  async update(mutator, { skipBackup = false } = {}) {
    await this._ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT data, practice, stats, revision FROM quiz_data WHERE id = 1 FOR UPDATE");
      const record = result.rows[0];
      if (!record) throw new Error("quiz_data 表缺少 id=1 的数据行");

      const state = mergeState(record.data, record.practice, record.stats);
      const changed = await mutator(state);
      if (changed === false) {
        await client.query("COMMIT");
        return state;
      }

      const { data, practice, stats } = splitState(state, { normalizeQuestions: false });
      const updated = await client.query(
        `UPDATE quiz_data
         SET data = $1, practice = $2, stats = $3, schema_version = 2,
             revision = revision + 1, updated_at = NOW()
         WHERE id = 1 RETURNING revision`,
        [JSON.stringify(data), JSON.stringify(practice), JSON.stringify(stats)]
      );
      if (!updated.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
      await client.query("COMMIT");

      const merged = mergeState(data, practice, stats);
      this._data = data;
      this._cache = { revision: Number(updated.rows[0].revision), state: merged };
      return merged;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 连接已经断开时保留原始错误
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePractice(courseId, mutator, { operationId = "", needStats = true } = {}) {
    return this._updateProgress(courseId, null, mutator, { operationId, needStats });
  }

  async updateAnswer(courseId, questionId, mutator, { operationId = "" } = {}) {
    return this._updateProgress(courseId, questionId, mutator, { operationId, needStats: true });
  }

  async updateStats(courseId, questionId, mutator, { operationId = "" } = {}) {
    return this._updateProgress(courseId, questionId, mutator, { operationId, needStats: true });
  }

  /** 只修改 practice 列；questionId 存在时同时修改 stats 列 */
  async _updateProgress(courseId, questionId, mutator, { operationId = "", needStats = false } = {}) {
    await this._ensureReady();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query("SELECT revision FROM quiz_data WHERE id = 1 FOR UPDATE");
      if (!locked.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
      const currentRevision = Number(locked.rows[0].revision) || 0;

      const selectColumns = questionId || needStats
        ? "SELECT practice, stats, revision FROM quiz_data WHERE id = 1"
        : "SELECT practice, revision FROM quiz_data WHERE id = 1";
      const result = await client.query(selectColumns);
      const record = result.rows[0];
      const practiceColumn = record.practice || { activeCourseId: "", practices: {} };
      const statsColumn = record.stats || {};
      const resolvedCourseId = courseId || practiceColumn.activeCourseId;
      const courseSource = (this._data?.courses || []).find((course) => course.id === resolvedCourseId);
      if (!courseSource) {
        await client.query("ROLLBACK");
        return null;
      }

      const currentPractice = normalizePractice(practiceColumn.practices?.[resolvedCourseId] || {});
      const opId = String(operationId || "").trim();
      const question = questionId
        ? findQuestion(courseSource, statsColumn, questionId)
        : null;
      if (questionId && !question) {
        await client.query("ROLLBACK");
        return { missingQuestion: true };
      }

      if (opId && currentPractice.recentOperationIds.includes(opId)) {
        await client.query("COMMIT");
        return {
          duplicate: true,
          courseId: resolvedCourseId,
          practice: currentPractice,
          question,
          revision: currentRevision
        };
      }

      const questions = questionId || needStats
        ? courseSource.questions.map((item) => applyStats(item, statsColumn[item.id]))
        : courseSource.questions;
      const course = {
        ...courseSource,
        questions,
        practice: normalizePractice(currentPractice)
      };
      const view = { activeCourseId: resolvedCourseId, courses: [course] };

      const changed = await mutator(view);
      if (changed === false) {
        await client.query("COMMIT");
        return {
          duplicate: false,
          courseId: resolvedCourseId,
          practice: normalizePractice(currentPractice),
          question,
          revision: currentRevision
        };
      }

      const nextPractice = normalizePractice(course.practice);
      if (opId) {
        nextPractice.recentOperationIds = [opId, ...nextPractice.recentOperationIds.filter((id) => id !== opId)].slice(0, 50);
      }
      const nextPracticeColumn = {
        ...practiceColumn,
        practices: {
          ...(practiceColumn.practices || {}),
          [resolvedCourseId]: nextPractice
        }
      };

      const persistedQuestion = questionId
        ? (course.questions || []).find((item) => item.id === questionId)
        : null;
      let nextStatsColumn = statsColumn;
      if (questionId) {
        nextStatsColumn = { ...statsColumn };
        const patch = statsPatchForQuestion(persistedQuestion);
        if (isDefaultStats(patch)) delete nextStatsColumn[questionId];
        else nextStatsColumn[questionId] = patch;
      }

      const updated = questionId
        ? await client.query(
          `UPDATE quiz_data
           SET practice = $1, stats = $2, revision = revision + 1, updated_at = NOW()
           WHERE id = 1 RETURNING revision`,
          [JSON.stringify(nextPracticeColumn), JSON.stringify(nextStatsColumn)]
        )
        : await client.query(
          `UPDATE quiz_data
           SET practice = $1, revision = revision + 1, updated_at = NOW()
           WHERE id = 1 RETURNING revision`,
          [JSON.stringify(nextPracticeColumn)]
        );
      if (!updated.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
      await client.query("COMMIT");

      const newRevision = Number(updated.rows[0].revision);
      if (this._cache && this._cache.revision === currentRevision) {
        applyPatchToCachedState(this._cache.state, resolvedCourseId, nextPractice, questionId, persistedQuestion);
        this._cache.revision = newRevision;
      } else {
        this._cache = null;
      }

      return {
        duplicate: false,
        courseId: resolvedCourseId,
        practice: nextPractice,
        question: persistedQuestion,
        revision: newRevision
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 连接已经断开时保留原始错误
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async setActiveCourse(courseId, { includeCourse = true } = {}) {
    await this._ensureReady();
    const courseSource = (this._data?.courses || []).find((course) => course.id === courseId);
    if (!courseSource) return null;

    const client = await this.pool.connect();
    let revision = this.getRevision();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT practice, revision FROM quiz_data WHERE id = 1 FOR UPDATE");
      if (!result.rows.length) throw new Error("quiz_data 表缺少 id=1 的数据行");
      const record = result.rows[0];
      const practiceColumn = record.practice || { activeCourseId: "", practices: {} };
      revision = Number(record.revision) || 0;
      if (practiceColumn.activeCourseId !== courseId) {
        const updated = await client.query(
          `UPDATE quiz_data
           SET practice = $1, revision = revision + 1, updated_at = NOW()
           WHERE id = 1 RETURNING revision`,
          [JSON.stringify({ ...practiceColumn, activeCourseId: courseId })]
        );
        revision = Number(updated.rows[0].revision);
      }
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 连接已经断开时保留原始错误
      }
      throw error;
    } finally {
      client.release();
    }

    if (this._cache) {
      this._cache.state.activeCourseId = courseId;
      this._cache.revision = revision;
    }

    if (!includeCourse) {
      return { activeCourseId: courseId, course: null, revision };
    }
    const state = await this.readState();
    return {
      activeCourseId: courseId,
      course: getActiveCourseShape(state),
      revision: this.getRevision()
    };
  }

  normalizeState(state, options) {
    return normalizeState(state, options);
  }

  getActiveCourse(state) {
    return getActiveCourseShape(state);
  }

  createCourse(name) {
    return createCourseShape(name);
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

  emptyPractice() {
    return emptyPracticeShape();
  }

  normalizePractice(practice) {
    return normalizePractice(practice);
  }

  async listBackups() {
    return [];
  }

  async close() {
    await this.pool.end();
  }

  async _migrateLayout() {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT data, practice, stats, schema_version, revision FROM quiz_data WHERE id = 1 FOR UPDATE"
      );
      const record = result.rows[0];
      if (!record) throw new Error("quiz_data 表缺少 id=1 的数据行");

      if (record.practice !== null && record.stats !== null && Number(record.schema_version) >= 2) {
        this._data = record.data;
        await client.query("COMMIT");
        return;
      }

      const oldState = stateFromRow(record);
      const { data, practice, stats } = splitState(oldState, { normalizeQuestions: true });
      const merged = mergeState(data, practice, stats);
      assert.deepStrictEqual(merged, oldState);

      await client.query(
        `INSERT INTO quiz_data_backups (id, snapshot, created_at)
         SELECT 1, to_jsonb(q), NOW() FROM quiz_data q WHERE q.id = 1
         ON CONFLICT (id) DO UPDATE
         SET snapshot = EXCLUDED.snapshot, created_at = EXCLUDED.created_at`
      );

      const updated = await client.query(
        `UPDATE quiz_data
         SET data = $1, practice = $2, stats = $3, schema_version = 2,
             revision = revision + 1, updated_at = NOW()
         WHERE id = 1 RETURNING revision`,
        [JSON.stringify(data), JSON.stringify(practice), JSON.stringify(stats)]
      );
      await client.query("COMMIT");

      this._data = data;
      this._cache = {
        revision: Number(updated.rows[0].revision),
        state: merged
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // 连接已经断开时保留原始错误
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function stateFromRow(record) {
  const data = record.data || {};
  const hasEmbedded = (data.courses || []).some((course) => {
    if (course.practice) return true;
    return (course.questions || []).some((question) => (
      Object.prototype.hasOwnProperty.call(question, "wrongCount")
      || Object.prototype.hasOwnProperty.call(question, "correctCount")
      || Object.prototype.hasOwnProperty.call(question, "bookmarked")
      || Object.prototype.hasOwnProperty.call(question, "review")
    ));
  });

  if (hasEmbedded) return normalizeState(data);
  return mergeState(data, record.practice, record.stats);
}

function findQuestion(course, stats, questionId) {
  const question = (course.questions || []).find((item) => item.id === questionId);
  return question ? applyStats(question, stats[questionId]) : null;
}

function applyStats(question, patch) {
  return {
    ...question,
    wrongCount: Number(patch?.wrongCount) || 0,
    correctCount: Number(patch?.correctCount) || 0,
    bookmarked: Boolean(patch?.bookmarked),
    review: normalizeReviewState(patch?.review)
  };
}

function applyPatchToCachedState(state, courseId, practice, questionId, question) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  course.practice = practice;
  if (!questionId || !question) return;
  const target = course.questions.find((item) => item.id === questionId);
  if (!target) return;
  const patch = statsPatchForQuestion(question);
  target.wrongCount = patch.wrongCount;
  target.correctCount = patch.correctCount;
  target.bookmarked = patch.bookmarked;
  target.review = patch.review;
}
