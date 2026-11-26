function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(path, { timeoutMs = 30000, retries = 0, ...options } = {}) {
  let attempt = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(options.headers || {})
        },
        signal: controller.signal
      });
      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          throw new Error(`服务器返回了非 JSON 响应（HTTP ${response.status}）`);
        }
      }
      if (!response.ok) {
        const error = new Error(payload.error || `请求失败（HTTP ${response.status}）`);
        error.statusCode = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      const retryable = error.name !== "AbortError"
        ? error instanceof TypeError || Number(error.statusCode) >= 500
        : true;
      if (retryable && attempt < retries) {
        attempt += 1;
        await sleep(300 * attempt);
        continue;
      }
      if (error.name === "AbortError") {
        throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function practiceRequest(path, body) {
  return request(path, {
    method: "POST",
    body: JSON.stringify(body),
    timeoutMs: 20000,
    retries: 2
  });
}

export const api = {
  state: () => request("/api/state"),
  bootstrap: () => request("/api/bootstrap", { timeoutMs: 90000 }),
  explanations: (courseId) => request(`/api/explanations?courseId=${encodeURIComponent(courseId)}`),
  addCourse: (name) => request("/api/courses", { method: "POST", body: JSON.stringify({ name }) }),
  setActiveCourse: (courseId) => request("/api/courses/active", { method: "POST", body: JSON.stringify({ courseId }) }),
  deleteCourse: (courseId) => request("/api/courses/delete", { method: "POST", body: JSON.stringify({ courseId }) }),
  addQuestions: (questions) => request("/api/questions", { method: "POST", body: JSON.stringify({ questions }) }),
  deleteQuestion: (questionId) => request("/api/questions/delete", { method: "POST", body: JSON.stringify({ questionId }) }),
  updateQuestion: (questionId, data) => request("/api/questions/update", { method: "POST", body: JSON.stringify({ questionId, ...data }) }),
  bookmarkQuestion: (courseId, questionId, operationId) => practiceRequest("/api/questions/bookmark", { courseId, questionId, operationId }),
  nextQuestion: (courseId, mode, count, timeLimitMinutes, operationId) => practiceRequest("/api/practice/next", {
    courseId,
    mode,
    count,
    timeLimitMinutes,
    operationId
  }),
  submitAnswer: (courseId, questionId, selectedAnswers, operationId) => practiceRequest("/api/practice/answer", {
    courseId,
    questionId,
    selectedAnswers,
    operationId
  }),
  prevQuestion: (courseId, operationId) => practiceRequest("/api/practice/prev", { courseId, operationId }),
  resetRound: (courseId, mode, count, timeLimitMinutes, operationId) => practiceRequest("/api/practice/reset-round", {
    courseId,
    mode,
    count,
    timeLimitMinutes,
    operationId
  }),
  finishExam: (courseId, timedOut = false, operationId) => practiceRequest("/api/practice/finish-exam", {
    courseId,
    timedOut,
    operationId
  }),
  generateStudyNotes: (overwrite = false) => request("/api/study-notes/generate", {
    method: "POST",
    body: JSON.stringify({ overwrite })
  }),
  recognizeImage: (imageDataUrl) => request("/api/recognize-image", {
    method: "POST",
    body: JSON.stringify({ imageDataUrl }),
    timeoutMs: 180000
  })
};
