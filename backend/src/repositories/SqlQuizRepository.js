import pg from "pg";
import { normalizeQuestion, validateQuestion, createId } from "../utils.js";

const { Pool } = pg;

/**
 * 基于 PostgreSQL 的题库仓库实现
 * 使用 JSONB 大字段存储整个 state，代码改动最小
 */
export class SqlQuizRepository {
  constructor(databaseUrl) {
    this.pool = new Pool({
      connectionString: databaseUrl,
      // 连接池配置
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    this._initialized = false;
  }

  /** 初始化数据库表 */
  async _ensureTable() {
    if (this._initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_data (
        id INT PRIMARY KEY DEFAULT 1,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // 确保有一行数据
    await this.pool.query(`
      INSERT INTO quiz_data (id, data) VALUES (1, '{"activeCourseId":"","courses":[]}')
      ON CONFLICT (id) DO NOTHING
    `);
    this._initialized = true;
  }

  /** 获取完整状态 */
  async getState() {
    await this._ensureTable();
    const result = await this.pool.query("SELECT data FROM quiz_data WHERE id = 1");
    const state = result.rows[0]?.data || {};
    return this.normalizeState(state);
  }

  /** 保存完整状态 */
  async saveState(state) {
    await this._ensureTable();
    const normalized = this.normalizeState(state);
    await this.pool.query(
      "UPDATE quiz_data SET data = $1, updated_at = NOW() WHERE id = 1",
      [JSON.stringify(normalized)]
    );
  }

  /** 原子更新：读取 → 修改 → 保存 */
  async update(mutator) {
    const state = await this.getState();
    await mutator(state);
    await this.saveState(state);
    return this.getState();
  }

  /** 规范化状态结构 */
  normalizeState(state) {
    let courses = Array.isArray(state.courses) ? state.courses : [];
    if (!courses.length) courses = [this.createCourse("默认课程")];

    courses = courses.map((course) => ({
      id: course.id || createId("course"),
      name: course.name || "未命名课程",
      questions: (course.questions || course.bank || [])
        .map(normalizeQuestion)
        .filter((question) => !validateQuestion(question)),
      practice: {
        ...this.emptyPractice(),
        ...(course.practice || course.round?.stats || {})
      },
      createdAt: course.createdAt || new Date().toISOString()
    }));

    const activeCourseId = courses.some((course) => course.id === state.activeCourseId)
      ? state.activeCourseId
      : courses[0].id;

    return { activeCourseId, courses };
  }

  /** 获取当前活跃课程 */
  getActiveCourse(state) {
    return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
  }

  /** 创建新课程对象 */
  createCourse(name) {
    return {
      id: createId("course"),
      name,
      questions: [],
      practice: this.emptyPractice(),
      createdAt: new Date().toISOString()
    };
  }

  /** 更新题目 */
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

    const normalized = normalizeQuestion(merged);
    normalized.updatedAt = new Date().toISOString();

    const index = course.questions.findIndex((q) => q.id === questionId);
    course.questions[index] = normalized;
    return normalized;
  }

  /** 空的练习状态 */
  emptyPractice() {
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
      count: 0
    };
  }

  /** 列出备份（数据库模式下返回空数组） */
  async listBackups() {
    // 数据库模式下不需要文件备份
    return [];
  }

  /** 关闭连接池 */
  async close() {
    await this.pool.end();
  }
}
