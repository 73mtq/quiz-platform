import {
  createId,
  normalizeQuestion,
  normalizeReviewState,
  restoreAnsweredIds,
  restoreHistoryIds,
  validateQuestion
} from "../utils.js";

export function emptyExam() {
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

export function emptyPractice() {
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
    roundTotal: 0,
    answeredIds: [],
    historyIds: [],
    recentOperationIds: [],
    exam: emptyExam()
  };
}

export function createCourse(name) {
  return {
    id: createId("course"),
    name,
    questions: [],
    practice: emptyPractice(),
    createdAt: new Date().toISOString()
  };
}

export function normalizePractice(practice = {}) {
  const source = practice && typeof practice === "object" ? practice : {};
  const base = { ...emptyPractice(), ...source };
  const answeredIds = toStringArray(base.answeredIds);
  if (!answeredIds.length && base.lastAnswer?.questionId) {
    answeredIds.push(String(base.lastAnswer.questionId));
  }
  const examAnswers = Array.isArray(source.exam?.answers) ? source.exam.answers : [];
  if (isExamMode(base.mode)) {
    for (const answer of examAnswers) {
      if (answer?.questionId && !answeredIds.includes(String(answer.questionId))) {
        answeredIds.push(String(answer.questionId));
      }
    }
  }
  return {
    ...base,
    roundNo: Number(base.roundNo) || 1,
    remainingIds: toStringArray(base.remainingIds),
    answeredInRound: Number(base.answeredInRound) || 0,
    correctInRound: Number(base.correctInRound) || 0,
    totalAnswered: Number(base.totalAnswered) || 0,
    totalCorrect: Number(base.totalCorrect) || 0,
    currentQuestionId: base.currentQuestionId || null,
    lastAnswer: base.lastAnswer || null,
    mode: base.mode || "all",
    count: Number(base.count) || 0,
    roundTotal: Number(base.roundTotal) || 0,
    answeredIds,
    historyIds: toStringArray(base.historyIds),
    recentOperationIds: toStringArray(base.recentOperationIds).slice(0, 50),
    exam: {
      ...emptyExam(),
      ...(source.exam || {}),
      timeLimitMinutes: Number(source.exam?.timeLimitMinutes) || 20,
      startedAt: source.exam?.startedAt || "",
      finishedAt: source.exam?.finishedAt || "",
      questionIds: toStringArray(source.exam?.questionIds),
      answers: examAnswers,
      lastWrongIds: toStringArray(source.exam?.lastWrongIds),
      lastSummary: source.exam?.lastSummary || null
    }
  };
}

function isExamMode(mode) {
  return mode === "exam" || mode === "exam-wrong";
}

export function normalizeState(state = {}, { normalizeQuestions = true } = {}) {
  let courses = Array.isArray(state.courses) ? state.courses : [];
  if (!courses.length) courses = [createCourse("默认课程")];

  courses = courses.map((course) => ({
    id: course.id || createId("course"),
    name: course.name || "未命名课程",
    questions: normalizeQuestions
      ? (course.questions || course.bank || [])
        .map(normalizeQuestion)
        .filter((question) => !validateQuestion(question))
      : (Array.isArray(course.questions) ? course.questions : []),
    practice: normalizePractice(course.practice || course.round?.stats || {}),
    createdAt: course.createdAt || new Date().toISOString()
  }));

  const activeCourseId = courses.some((course) => course.id === state.activeCourseId)
    ? state.activeCourseId
    : courses[0].id;

  return { activeCourseId, courses };
}

export function getActiveCourse(state) {
  return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
}

export function splitState(state, { normalizeQuestions = false } = {}) {
  const normalized = normalizeState(state, { normalizeQuestions });
  const data = {
    courses: normalized.courses.map((course) => ({
      id: course.id,
      name: course.name,
      createdAt: course.createdAt,
      questions: course.questions.map(stripQuestionStats)
    }))
  };
  const practice = {
    activeCourseId: normalized.activeCourseId,
    practices: {}
  };
  const stats = {};

  for (const course of normalized.courses) {
    practice.practices[course.id] = normalizePractice(course.practice);
    for (const question of course.questions) {
      const patch = statsPatchForQuestion(question);
      if (!isDefaultStats(patch)) stats[question.id] = patch;
    }
  }

  return { data, practice, stats };
}

export function mergeState(data, practice, stats) {
  const sourceCourses = Array.isArray(data?.courses) ? data.courses : [];
  let courses = sourceCourses.map((course) => ({
    id: course.id || createId("course"),
    name: course.name || "未命名课程",
    createdAt: course.createdAt || new Date().toISOString(),
    questions: (Array.isArray(course.questions) ? course.questions : []).map((question) => {
      const patch = stats?.[question.id] || {};
      return {
        ...question,
        wrongCount: Number(patch.wrongCount) || 0,
        correctCount: Number(patch.correctCount) || 0,
        bookmarked: Boolean(patch.bookmarked),
        review: normalizeReviewState(patch.review)
      };
    }),
    practice: normalizePractice(practice?.practices?.[course.id] || {})
  }));

  if (!courses.length) {
    const course = createCourse("默认课程");
    course.practice = normalizePractice(practice?.practices?.[course.id] || {});
    courses = [course];
  }

  const activeCourseId = courses.some((course) => course.id === practice?.activeCourseId)
    ? practice.activeCourseId
    : courses[0].id;

  return { activeCourseId, courses };
}

export function compactStatePayload(state, revision = 0) {
  const active = withRestoredAnsweredIds(getActiveCourse(state));
  const keepExplanationIds = new Set([
    active.practice?.currentQuestionId,
    active.practice?.lastAnswer?.questionId
  ].filter(Boolean));
  const course = {
    ...active,
    questions: active.questions.map((question) => (
      keepExplanationIds.has(question.id) ? question : withoutExplanation(question)
    ))
  };
  return {
    revision,
    activeCourseId: state.activeCourseId,
    courses: state.courses.map((item) => ({
      id: item.id,
      name: item.name,
      questionCount: item.questions.length,
      createdAt: item.createdAt
    })),
    course
  };
}

export function compactCoursePayload(course, revision = 0) {
  return {
    revision,
    activeCourseId: course.id,
    course: withRestoredAnsweredIds(course)
  };
}

function withRestoredAnsweredIds(course) {
  const practice = course.practice || {};
  const answeredIds = restoreAnsweredIds(practice, course.questions || []);
  const repaired = { ...practice, answeredIds };
  return {
    ...course,
    practice: {
      ...repaired,
      historyIds: restoreHistoryIds(repaired, course.questions || [])
    }
  };
}

export function statsPatchForQuestion(question) {
  return {
    wrongCount: Number(question.wrongCount) || 0,
    correctCount: Number(question.correctCount) || 0,
    bookmarked: Boolean(question.bookmarked),
    review: normalizeReviewState(question.review)
  };
}

export function isDefaultStats(patch) {
  if (!patch) return true;
  if (Number(patch.wrongCount) || Number(patch.correctCount) || patch.bookmarked) return false;
  const review = normalizeReviewState(patch.review);
  return !review.lastAnsweredAt
    && !review.lastWrongAt
    && !review.lastCorrectAt
    && !review.masteredAt
    && !review.consecutiveCorrect
    && !review.lastSelectedAnswers.length;
}

function stripQuestionStats(question) {
  const {
    wrongCount,
    correctCount,
    bookmarked,
    review,
    ...content
  } = question;
  return content;
}

function withoutExplanation(question) {
  const {
    explanation,
    memoryTip,
    ...content
  } = question;
  return content;
}

function toStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
