export const settings = {
  showAnswer: localStorage.getItem("quiz-platform-show-answer") !== "0",
  showExplanation: localStorage.getItem("quiz-platform-show-explanation") !== "0"
};

export const runtime = {
  state: null,
  selectedAnswers: [],
  submittedQuestionId: "",
  answerFeedback: null,
  bankSearch: "",
  editingQuestionId: null,
  creatingQuestion: false
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
}
