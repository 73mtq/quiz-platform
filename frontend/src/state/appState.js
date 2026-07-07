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
  examCount: Number(localStorage.getItem("quiz-platform-exam-count")) || 30,
  examTimeLimitMinutes: Number(localStorage.getItem("quiz-platform-exam-minutes")) || 20,
  examTimerId: null,
  finishingExam: false,
  bankShowWrongOnly: false,
  bankShowBookmarkedOnly: false,
  questionHistory: [] // 上一题历史栈
};

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
