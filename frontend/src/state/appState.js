export const settings = {
  showAnswer: localStorage.getItem("quiz-platform-show-answer") !== "0",
  showExplanation: localStorage.getItem("quiz-platform-show-explanation") !== "0",
  autoNext: localStorage.getItem("quiz-platform-auto-next") === "1",
  shuffleOptions: localStorage.getItem("quiz-platform-shuffle-options") === "1"
};

export const runtime = {
  state: null,
  selectedAnswers: [],
  submittedQuestionId: "",
  answerFeedback: null,
  bankSearch: "",
  editingQuestionId: null,
  creatingQuestion: false,
  practiceMode: localStorage.getItem("quiz-platform-practice-mode") || "all",
  practiceCount: Number(localStorage.getItem("quiz-platform-practice-count")) || 10,
  bankShowWrongOnly: false,
  bankShowBookmarkedOnly: false,
  questionHistory: [] // 上一题历史栈
};

// 保存刷题进度到 localStorage
export function savePracticeProgress(courseId, practice) {
  const progress = {
    remainingIds: practice.remainingIds,
    currentQuestionId: practice.currentQuestionId,
    answeredInRound: practice.answeredInRound,
    correctInRound: practice.correctInRound,
    roundNo: practice.roundNo,
    mode: practice.mode,
    count: practice.count
  };
  localStorage.setItem(`quiz-platform-progress-${courseId}`, JSON.stringify(progress));
}

// 从 localStorage 恢复刷题进度
export function loadPracticeProgress(courseId) {
  try {
    const saved = localStorage.getItem(`quiz-platform-progress-${courseId}`);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

// 保存答题反馈
export function saveAnswerFeedback(courseId, feedback) {
  if (feedback) {
    localStorage.setItem(`quiz-platform-feedback-${courseId}`, JSON.stringify(feedback));
  } else {
    localStorage.removeItem(`quiz-platform-feedback-${courseId}`);
  }
}

// 加载答题反馈
export function loadAnswerFeedback(courseId) {
  try {
    const saved = localStorage.getItem(`quiz-platform-feedback-${courseId}`);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export function activeCourse() {
  return runtime.state.courses.find((course) => course.id === runtime.state.activeCourseId) || runtime.state.courses[0];
}

export function currentQuestion() {
  const course = activeCourse();
  return course.questions.find((question) => question.id === course.practice.currentQuestionId);
}

export function clearCurrentAnswer() {
  runtime.selectedAnswers = [];
  runtime.submittedQuestionId = "";
  runtime.answerFeedback = null;
}

export function persistFeedbackSettings() {
  localStorage.setItem("quiz-platform-show-answer", settings.showAnswer ? "1" : "0");
  localStorage.setItem("quiz-platform-show-explanation", settings.showExplanation ? "1" : "0");
  localStorage.setItem("quiz-platform-auto-next", settings.autoNext ? "1" : "0");
  localStorage.setItem("quiz-platform-shuffle-options", settings.shuffleOptions ? "1" : "0");
}
