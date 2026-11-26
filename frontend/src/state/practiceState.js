export function courseQuestionCount(course) {
  return Number(course?.questionCount ?? course?.questions?.length ?? 0);
}

export function activeCourseOf(state) {
  if (!state?.courses?.length) return null;
  return state.courses.find((course) => course.id === state.activeCourseId) || state.courses[0];
}

export function hydrateStatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("服务器没有返回题库状态");
  }

  if (payload.course && Array.isArray(payload.courses)) {
    const active = payload.course;
    const activeCount = Array.isArray(active.questions) ? active.questions.length : 0;
    return {
      activeCourseId: payload.activeCourseId,
      revision: Number(payload.revision) || 0,
      courses: payload.courses.map((meta) => {
        if (meta.id === active.id) {
          return {
            ...meta,
            ...active,
            questionCount: activeCount
          };
        }
        return {
          ...meta,
          questionCount: courseQuestionCount(meta),
          questions: [],
          practice: null
        };
      })
    };
  }

  if (Array.isArray(payload.courses)) {
    return {
      ...payload,
      revision: Number(payload.revision) || 0,
      courses: payload.courses.map((course) => ({
        ...course,
        questionCount: courseQuestionCount(course),
        questions: Array.isArray(course.questions) ? course.questions : []
      }))
    };
  }

  throw new Error("无法识别的题库状态响应");
}

export function applyPracticeStats(state, payload) {
  const course = findCourse(state, payload?.courseId);
  if (!course || !course.practice || !payload?.practice) return false;
  const server = payload.practice;
  const practice = course.practice;

  for (const key of ["roundNo", "answeredInRound", "correctInRound", "totalAnswered", "totalCorrect", "roundTotal", "mode", "count"]) {
    if (server[key] !== undefined) practice[key] = server[key];
  }
  if (server.exam !== undefined) practice.exam = server.exam;
  if (Array.isArray(server.answeredIds)) practice.answeredIds = server.answeredIds;
  if (Array.isArray(server.historyIds)) practice.historyIds = server.historyIds;
  if (Array.isArray(server.recentOperationIds)) practice.recentOperationIds = server.recentOperationIds;

  applyQuestionPayload(state, payload);
  return true;
}

export function applyPracticePayload(state, payload) {
  const course = findCourse(state, payload?.courseId);
  if (!course || !payload?.practice) return false;
  course.practice = payload.practice;
  applyQuestionPayload(state, payload);
  return true;
}


export function applyExplanations(state, payload) {
  const course = findCourse(state, payload?.courseId);
  if (!course || !payload?.explanations) return false;
  for (const question of course.questions || []) {
    const note = payload.explanations[question.id];
    if (!note) continue;
    question.explanation = note.explanation || "";
    question.memoryTip = note.memoryTip || "";
  }
  return true;
}

export function applyQuestionPayload(state, payload) {
  if (!payload?.question?.id) return false;
  const course = findCourse(state, payload.courseId);
  if (!course) return false;
  const question = (course.questions || []).find((item) => item.id === payload.question.id);
  if (!question) return false;
  Object.assign(question, payload.question);
  return true;
}

export function applyCoursePayload(state, payload) {
  const active = payload?.course;
  if (!active?.id || !Array.isArray(active.questions)) return false;

  for (const course of state.courses) {
    if (course.id === active.id) continue;
    if (course.questions?.length) course.questionCount = course.questions.length;
    course.questions = [];
    course.practice = null;
  }

  const next = {
    ...active,
    questionCount: active.questions.length
  };
  const index = state.courses.findIndex((course) => course.id === active.id);
  if (index === -1) state.courses.push(next);
  else state.courses[index] = { ...state.courses[index], ...next };

  state.activeCourseId = payload.activeCourseId || active.id;
  return true;
}

function findCourse(state, courseId) {
  if (!state?.courses || !courseId) return null;
  return state.courses.find((course) => course.id === courseId) || null;
}
