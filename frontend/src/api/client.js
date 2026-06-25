async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

export const api = {
  state: () => request("/api/state"),
  addCourse: (name) => request("/api/courses", { method: "POST", body: JSON.stringify({ name }) }),
  setActiveCourse: (courseId) => request("/api/courses/active", { method: "POST", body: JSON.stringify({ courseId }) }),
  deleteCourse: (courseId) => request("/api/courses/delete", { method: "POST", body: JSON.stringify({ courseId }) }),
  addQuestions: (questions) => request("/api/questions", { method: "POST", body: JSON.stringify({ questions }) }),
  deleteQuestion: (questionId) => request("/api/questions/delete", { method: "POST", body: JSON.stringify({ questionId }) }),
  updateQuestion: (questionId, data) => request("/api/questions/update", { method: "POST", body: JSON.stringify({ questionId, ...data }) }),
  bookmarkQuestion: (questionId) => request("/api/questions/bookmark", { method: "POST", body: JSON.stringify({ questionId }) }),
  nextQuestion: (mode, count) => request("/api/practice/next", { method: "POST", body: JSON.stringify({ mode, count }) }),
  submitAnswer: (questionId, selectedAnswers) => request("/api/practice/answer", {
    method: "POST",
    body: JSON.stringify({ questionId, selectedAnswers })
  }),
  resetRound: (mode, count) => request("/api/practice/reset-round", { method: "POST", body: JSON.stringify({ mode, count }) }),
  recognizeImage: (imageDataUrl) => request("/api/recognize-image", {
    method: "POST",
    body: JSON.stringify({ imageDataUrl })
  })
};
