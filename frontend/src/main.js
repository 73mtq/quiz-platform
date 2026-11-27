import { api } from "./api/client.js";
import { activeCourse, clearCurrentAnswer, currentQuestion, persistFeedbackSettings, runtime, settings } from "./state/appState.js";
import {
  applyCoursePayload,
  applyExplanations as mergeExplanations,
  applyPracticePayload as mergePracticePayload,
  applyPracticeStats as mergePracticeStats,
  applyQuestionPayload as mergeQuestionPayload,
  hydrateStatePayload
} from "./state/practiceState.js";
import { clearAllOptionOrders, clearOptionOrder, renderApp, renderImportResult, updateBankListOnly, updatePracticeOnly } from "./ui/render.js";
import { getChoiceAnswerTexts, isChoiceAnswerCorrect, isFillBlankAnswerCorrect, normalizeChoiceText } from "./utils/answers.js";
import { escapeHtml, readFileAsDataUrl } from "./utils/format.js";
import { parseQuestions } from "./utils/parser.js";
import {
  applyLocalPracticeConfig,
  isPracticeRoundComplete,
  isQuestionAnsweredInRound,
  shouldAutoNextAfterSubmit
} from "./utils/practiceFlow.js";
import { applyQuestionReview } from "./utils/review.js";

const $ = (selector) => document.querySelector(selector);
const EXAM_MODES = new Set(["exam", "exam-wrong"]);
let activeCourseSync = Promise.resolve();
let activeCourseSwitchToken = 0;
let bankSearchRenderTimer = null;
let toastTimer = null;
let practiceSync = Promise.resolve();
let examFinishFailed = false;
let booted = false;
let bootPromise = null;
const practiceFailures = [];

const sample = `1. 下列哪项活动不是项目（）。
A. 开发操作系统
B. 准备大运会比赛用场馆
C. 生产汽车轮胎
D. 策划野餐活动
答案：C
解析：生产汽车轮胎属于运营活动。`;

function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 4000);
}

function showAppStatus(message, { tone = "info", action = null } = {}) {
  const target = $("#appStatus");
  if (!target) return;
  target.hidden = false;
  target.dataset.tone = tone;
  target.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button" id="appStatusAction">${escapeHtml(action.label)}</button>` : ""}<a href="/national-security.html">打开国家安全教育静态题库</a>`;
  if (action) {
    const button = $("#appStatusAction");
    if (button) button.onclick = action.onClick;
  }
}

function hideAppStatus() {
  const target = $("#appStatus");
  if (!target) return;
  target.hidden = true;
  target.innerHTML = "";
}

async function request(action, failureMessage) {
  try {
    return { ok: true, value: await action() };
  } catch (error) {
    showToast(`${failureMessage}：${error.message || "请求失败"}`);
    return { ok: false, value: null };
  }
}

function createOperationId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `op-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function enqueuePracticeSync(task) {
  const run = practiceSync.then(task, task);
  practiceSync = run.then(() => undefined, () => undefined);
  return run;
}

function acceptRevision(payload) {
  const revision = Number(payload?.revision);
  if (!Number.isFinite(revision)) return true;
  if (revision < Number(runtime.revision || 0)) return false;
  runtime.revision = revision;
  return true;
}

function applyPracticeStats(payload) {
  if (!acceptRevision(payload)) return false;
  return mergePracticeStats(runtime.state, payload);
}

function applyPracticePayload(payload) {
  if (!acceptRevision(payload)) return false;
  return mergePracticePayload(runtime.state, payload);
}

function applyQuestionPayload(payload) {
  if (!acceptRevision(payload)) return false;
  return mergeQuestionPayload(runtime.state, payload);
}

function hydrateAndApplyState(payload) {
  if (!acceptRevision(payload)) return false;
  runtime.state = hydrateStatePayload(payload);
  runtime.explanationsLoaded = new Set();
  return true;
}

function applyActiveCoursePayload(payload) {
  if (!acceptRevision(payload)) return false;
  if (!applyCoursePayload(runtime.state, payload)) return false;
  runtime.explanationsLoaded = new Set();
  runtime.questionHistory = activeCourse()?.practice?.historyIds || [];
  return true;
}

function updateSyncBanner() {
  const banner = $("#syncStatus");
  if (!banner) return;
  if (!practiceFailures.length) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = `<span>有 ${practiceFailures.length} 项练习进度未同步。</span><button id="retryPracticeSyncBtn" type="button">重试</button>`;
  const button = $("#retryPracticeSyncBtn");
  if (button) button.onclick = retryPracticeFailures;
}

function registerPracticeFailure(label, task, apply = applyPracticeStats) {
  practiceFailures.push({ label, task, apply });
  updateSyncBanner();
}

async function retryPracticeFailures() {
  const failures = practiceFailures.splice(0, practiceFailures.length);
  for (const failure of failures) {
    try {
      const payload = await failure.task();
      failure.apply(payload);
    } catch (error) {
      practiceFailures.push(failure);
      showToast(`${failure.label}重试失败：${error.message || "请求失败"}`);
    }
  }
  updateSyncBanner();
}

function handleAnswerPayload(payload, rollback = null) {
  if (!payload?.answerResult) return;
  if (payload.answerResult.accepted === false) {
    if (rollback) rollback();
    if (payload.answerResult.questionId) {
      runtime.answerFeedback = {
        questionId: payload.answerResult.questionId,
        selectedAnswers: payload.answerResult.selectedAnswers || [],
        correct: Boolean(payload.answerResult.correct)
      };
      runtime.selectedAnswers = runtime.answerFeedback.selectedAnswers;
    } else {
      runtime.answerFeedback = null;
      runtime.selectedAnswers = [];
    }
    updatePracticeOnly();
    showToast(payload.answerResult.message || "答题结果未接受");
  }
}

async function ensureExplanationsLoaded() {
  const course = activeCourse();
  if (!course || runtime.explanationsLoaded.has(course.id)) return;
  const result = await request(() => api.explanations(course.id), "加载解析失败");
  if (!result.ok) return;
  if (!acceptRevision(result.value)) return;
  mergeExplanations(runtime.state, result.value);
  runtime.explanationsLoaded.add(course.id);
  if ($("#bankPanel")?.classList.contains("active")) renderApp();
}

function findForm(formId) {
  return Array.from(document.querySelectorAll("[data-form-id]"))
    .find((element) => element.dataset.formId === formId) || null;
}

function bind() {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tabs button,.panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.tab}`)?.classList.add("active");
      if (button.dataset.tab === "bankPanel") {
        renderApp();
        ensureExplanationsLoaded();
      } else if (button.dataset.tab === "reviewPanel") {
        renderApp();
      }
    });
  });

  const sampleBtn = $("#sampleBtn");
  if (sampleBtn) sampleBtn.addEventListener("click", () => { $("#sourceText").value = sample; });

  const showAnswerToggle = $("#showAnswerToggle");
  const showExplanationToggle = $("#showExplanationToggle");
  const autoNextToggle = $("#autoNextToggle");
  const shuffleOptionsToggle = $("#shuffleOptionsToggle");

  if (showAnswerToggle) {
    showAnswerToggle.checked = settings.showAnswer;
    showAnswerToggle.addEventListener("change", (event) => {
      settings.showAnswer = event.target.checked;
      persistFeedbackSettings();
      renderApp();
    });
  }
  if (showExplanationToggle) {
    showExplanationToggle.checked = settings.showExplanation;
    showExplanationToggle.addEventListener("change", (event) => {
      settings.showExplanation = event.target.checked;
      persistFeedbackSettings();
      renderApp();
    });
  }
  if (autoNextToggle) {
    autoNextToggle.checked = settings.autoNext;
    autoNextToggle.addEventListener("change", (event) => {
      settings.autoNext = event.target.checked;
      persistFeedbackSettings();
    });
  }
  if (shuffleOptionsToggle) {
    shuffleOptionsToggle.checked = settings.shuffleOptions;
    shuffleOptionsToggle.addEventListener("change", (event) => {
      settings.shuffleOptions = event.target.checked;
      persistFeedbackSettings();
      clearAllOptionOrders();
      renderApp();
    });
  }

  const importTextBtn = $("#importTextBtn");
  const aiBtn = $("#aiBtn");
  const imageInput = $("#imageInput");
  const imagePickText = document.querySelector(".file-pick-text");
  const courseSelect = $("#courseSelect");
  const addCourseBtn = $("#addCourseBtn");
  const deleteCourseBtn = $("#deleteCourseBtn");
  const resetRoundBtn = $("#resetRoundBtn");
  const bankList = $("#bankList");
  const bankToolbar = $("#bankToolbar");
  const reviewPanel = $("#reviewPanel");
  const quizCard = $("#quizCard");
  const submitBtn = $("#submitBtn");
  const prevBtn = $("#prevBtn");
  const nextBtn = $("#nextBtn");
  const finishExamBtn = $("#finishExamBtn");

  if (importTextBtn) importTextBtn.addEventListener("click", importText);
  if (aiBtn) aiBtn.addEventListener("click", recognizeImage);
  if (imageInput && imagePickText) {
    imageInput.addEventListener("change", () => {
      imagePickText.textContent = imageInput.files?.[0]?.name || "选择图片";
    });
  }
  if (courseSelect) courseSelect.addEventListener("change", setActiveCourse);
  if (addCourseBtn) addCourseBtn.addEventListener("click", addCourse);
  if (deleteCourseBtn) deleteCourseBtn.addEventListener("click", deleteCourse);
  if (resetRoundBtn) resetRoundBtn.addEventListener("click", resetRound);
  if (submitBtn) submitBtn.addEventListener("click", submitAnswer);
  if (prevBtn) prevBtn.addEventListener("click", prevQuestion);
  if (nextBtn) nextBtn.addEventListener("click", nextQuestion);
  if (finishExamBtn) finishExamBtn.addEventListener("click", () => finishExam(false));
  if (bankList) {
    bankList.addEventListener("click", deleteQuestion);
    bankList.addEventListener("click", handleBankActions);
    bankList.addEventListener("input", handleBankFormInput);
  }
  if (bankToolbar) {
    bankToolbar.addEventListener("click", handleBankToolbar);
    bankToolbar.addEventListener("input", handleBankSearch);
  }
  if (reviewPanel) {
    reviewPanel.addEventListener("click", handleReviewActions);
  }

  if (quizCard) {
    quizCard.addEventListener("click", (event) => {
      const target = event.target;
      if (target.closest("[data-bookmark]")) handleBookmarkClick(event);
      if (target.closest("[data-exam-action]")) handleExamAction(event);
      if (target.closest("[data-round-action]")) handleRoundAction(event);
    });
  }

  document.querySelectorAll("input[name='practiceMode']").forEach((radio) => {
    radio.addEventListener("change", (event) => {
      runtime.practiceMode = event.target.value;
      localStorage.setItem("quiz-platform-practice-mode", runtime.practiceMode);
      syncPracticeInputs();
      resetRound();
    });
  });

  const countInput = $("#practiceCountInput");
  if (countInput) {
    countInput.addEventListener("input", (event) => {
      const value = Math.max(1, Number(event.target.value) || 1);
      if (runtime.practiceMode === "exam") {
        runtime.examCount = value;
        localStorage.setItem("quiz-platform-exam-count", String(runtime.examCount));
      } else {
        runtime.practiceCount = value;
        localStorage.setItem("quiz-platform-practice-count", String(runtime.practiceCount));
      }
    });
    countInput.addEventListener("change", () => {
      const value = Math.max(1, Number(countInput.value) || 1);
      if (runtime.practiceMode === "exam") {
        runtime.examCount = value;
        localStorage.setItem("quiz-platform-exam-count", String(runtime.examCount));
      } else {
        runtime.practiceCount = value;
        localStorage.setItem("quiz-platform-practice-count", String(runtime.practiceCount));
      }
      if (runtime.practiceMode === "count" || runtime.practiceMode === "exam") {
        resetRound();
      }
    });
  }

  const examMinutesInput = $("#examMinutesInput");
  if (examMinutesInput) {
    examMinutesInput.value = runtime.examTimeLimitMinutes;
    examMinutesInput.addEventListener("input", (event) => {
      runtime.examTimeLimitMinutes = Math.max(1, Number(event.target.value) || 1);
      localStorage.setItem("quiz-platform-exam-minutes", String(runtime.examTimeLimitMinutes));
    });
    examMinutesInput.addEventListener("change", () => {
      runtime.examTimeLimitMinutes = Math.max(1, Number(examMinutesInput.value) || 1);
      localStorage.setItem("quiz-platform-exam-minutes", String(runtime.examTimeLimitMinutes));
      if (runtime.practiceMode === "exam") {
        resetRound();
      }
    });
  }

  syncPracticeInputs();
}

function switchTab(tabId) {
  document.querySelectorAll(".tabs button,.panel").forEach((item) => item.classList.remove("active"));
  const button = document.querySelector(`.tabs button[data-tab='${tabId}']`);
  const panel = $(`#${tabId}`);
  if (button) button.classList.add("active");
  if (panel) panel.classList.add("active");
}

function isExamMode(mode = runtime.practiceMode) {
  return EXAM_MODES.has(mode);
}

function activePracticeCount() {
  return runtime.practiceMode === "exam" ? runtime.examCount : runtime.practiceCount;
}

async function ensureActiveCourseSynced() {
  try {
    await activeCourseSync;
  } catch {
    // 课程切换失败时由切换函数显示提示
  }
  return !runtime.pendingCourseId;
}

function syncPracticeInputs() {
  const countInput = $("#practiceCountInput");
  const countHint = $("#practiceCountHint");
  const examTimeControls = $("#examTimeControls");
  const examMinutesInput = $("#examMinutesInput");
  const showCount = runtime.practiceMode === "count" || runtime.practiceMode === "exam";

  if (countInput) {
    countInput.style.display = showCount ? "" : "none";
    countInput.value = runtime.practiceMode === "exam" ? runtime.examCount : runtime.practiceCount;
  }
  if (countHint) countHint.style.display = showCount ? "" : "none";
  if (examTimeControls) examTimeControls.style.display = runtime.practiceMode === "exam" ? "" : "none";
  if (examMinutesInput) examMinutesInput.value = runtime.examTimeLimitMinutes;
}

function stageLocalPracticeRound() {
  const course = activeCourse();
  if (!course) return;
  applyLocalPracticeConfig(course.practice, {
    mode: runtime.practiceMode,
    count: activePracticeCount(),
    timeLimitMinutes: runtime.examTimeLimitMinutes
  });
  runtime.questionHistory = [];
  clearCurrentAnswer();
  examFinishFailed = false;
  renderApp();
  updatePrevBtn();
  setupExamTimer();
}

async function importText() {
  const parsed = parseQuestions($("#sourceText").value);
  if (!parsed.length) return alert("未识别到完整题目。选择题请确认包含题干、至少 2 个选项和答案；填空题请确认包含题干和答案。");

  if (!(await ensureActiveCourseSynced())) return;
  const result = await request(() => api.addQuestions(parsed), "文本导入失败");
  if (!result.ok) return;
  if (!hydrateAndApplyState(result.value)) return;
  $("#status").textContent = `文本导入完成：成功 ${result.value.importResult.accepted.length} 道，失败 ${result.value.importResult.rejected.length} 道。`;
  renderImportResult(result.value.importResult, "文本导入");
  clearAllOptionOrders();
  renderApp();
  updatePrevBtn();
}

async function setActiveCourse(event) {
  const nextCourseId = event.target.value;
  const previousCourseId = runtime.state.activeCourseId;
  if (nextCourseId === previousCourseId) return;
  if (runtime.pendingCourseId) {
    event.target.value = previousCourseId;
    return;
  }

  const token = ++activeCourseSwitchToken;
  runtime.pendingCourseId = nextCourseId;
  showAppStatus("正在加载课程…");
  const task = api.setActiveCourse(nextCourseId);
  activeCourseSync = task.then(() => undefined, () => undefined);
  try {
    const payload = await task;
    if (token !== activeCourseSwitchToken) return;
    if (!applyActiveCoursePayload(payload)) throw new Error("服务器没有返回目标课程");
    clearCurrentAnswer();
    runtime.practiceMode = activeCourse().practice.mode || runtime.practiceMode;
    syncPracticeInputs();
    hideAppStatus();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  } catch (error) {
    if (token !== activeCourseSwitchToken) return;
    const select = $("#courseSelect");
    if (select) select.value = previousCourseId;
    hideAppStatus();
    showToast(`课程切换失败：${error.message || "请求失败"}`);
    renderApp();
  } finally {
    if (token === activeCourseSwitchToken) runtime.pendingCourseId = null;
  }
}

async function addCourse() {
  const result = await request(() => api.addCourse($("#courseName").value.trim() || "新课程"), "新增课程失败");
  if (!result.ok) return;
  if (!hydrateAndApplyState(result.value)) return;
  $("#courseName").value = "";
  clearCurrentAnswer();
  runtime.questionHistory = [];
  runtime.practiceMode = activeCourse().practice.mode || runtime.practiceMode;
  syncPracticeInputs();
  clearAllOptionOrders();
  renderApp();
  updatePrevBtn();
  setupExamTimer();
}

async function deleteCourse() {
  if (!confirm("确认删除当前课程？该课程下的题目也会删除。")) return;
  if (!(await ensureActiveCourseSynced())) return;
  const result = await request(() => api.deleteCourse(activeCourse().id), "删除课程失败");
  if (!result.ok) return;
  if (!hydrateAndApplyState(result.value)) return;
  clearCurrentAnswer();
  runtime.questionHistory = [];
  runtime.practiceMode = activeCourse().practice.mode || "all";
  syncPracticeInputs();
  clearAllOptionOrders();
  renderApp();
  updatePrevBtn();
  setupExamTimer();
}

async function nextQuestion() {
  if (runtime.pendingCourseId) return;
  if (!(await ensureActiveCourseSynced())) return;
  const course = activeCourse();
  if (!course) return;
  const prevId = course.practice.currentQuestionId;
  const mode = course.practice.mode || runtime.practiceMode;
  const courseId = course.id;
  const count = mode === "exam" ? runtime.examCount : runtime.practiceCount;
  const timeLimitMinutes = runtime.examTimeLimitMinutes;
  const operationId = createOperationId();

  if (isExamMode(mode) && isPracticeRoundComplete(course.practice, mode === "exam" ? runtime.examCount : runtime.practiceCount)) {
    await finishExam(false);
    return;
  }

  if (isExamMode(mode)) {
    const task = () => api.nextQuestion(courseId, mode, count, timeLimitMinutes, operationId);
    const result = await request(() => enqueuePracticeSync(task), "加载下一题失败");
    if (!result.ok) {
      registerPracticeFailure("加载下一题", task, applyNextPayload);
      return;
    }
    applyNextPayload(result.value);
    return;
  }

  if (!course.practice.remainingIds.length) {
    const task = () => api.nextQuestion(courseId, mode, count, timeLimitMinutes, operationId);
    const result = await request(() => enqueuePracticeSync(task), "加载下一题失败");
    if (!result.ok) {
      registerPracticeFailure("加载下一题", task, applyNextPayload);
      return;
    }
    applyNextPayload(result.value);
    return;
  }

  if (prevId) {
    course.practice.historyIds = [...(course.practice.historyIds || []), prevId];
  }
  course.practice.currentQuestionId = course.practice.remainingIds.shift() || null;
  course.practice.lastAnswer = null;
  runtime.questionHistory = course.practice.historyIds;
  clearCurrentAnswer();
  updatePracticeOnly();
  updatePrevBtn();

  const task = () => api.nextQuestion(courseId, mode, count, timeLimitMinutes, operationId);
  enqueuePracticeSync(task)
    .then((payload) => {
      if (!applyPracticeStats(payload)) return;
      runtime.questionHistory = activeCourse().practice.historyIds || [];
      updatePrevBtn();
      setupExamTimer();
    })
    .catch((error) => {
      registerPracticeFailure("同步下一题", task, (payload) => {
        applyPracticeStats(payload);
        runtime.questionHistory = activeCourse().practice.historyIds || [];
        updatePrevBtn();
      });
      showToast(`进度同步失败：${error.message || "请求失败"}`);
    });
}

async function prevQuestion() {
  if (runtime.pendingCourseId) return;
  if (!(await ensureActiveCourseSynced())) return;
  const course = activeCourse();
  if (!course) return;
  const courseId = course.id;
  const operationId = createOperationId();
  const task = () => api.prevQuestion(courseId, operationId);
  const result = await request(() => enqueuePracticeSync(task), "加载上一题失败");
  if (!result.ok) {
    registerPracticeFailure("加载上一题", task, (payload) => {
      if (!applyPracticePayload(payload)) return;
      clearCurrentAnswer();
      runtime.questionHistory = activeCourse().practice.historyIds || [];
      updatePracticeOnly();
      updatePrevBtn();
    });
    return;
  }
  if (!applyPracticePayload(result.value)) return;
  clearCurrentAnswer();
  runtime.questionHistory = activeCourse().practice.historyIds || [];
  updatePracticeOnly();
  updatePrevBtn();
}

function updatePrevBtn() {
  const button = $("#prevBtn");
  if (!button) return;
  const course = activeCourse();
  const history = course?.practice?.historyIds || [];
  button.style.display = history.length ? "" : "none";
}

async function submitAnswer() {
  if (runtime.pendingCourseId) return;
  if (!(await ensureActiveCourseSynced())) return;
  const course = activeCourse();
  const question = currentQuestion();
  if (!course || !question) return alert("请先点击下一题。");

  if (isQuestionAnsweredInRound(course.practice, question.id) || runtime.answerFeedback?.questionId === question.id) {
    return alert("这道题本轮已经作答。");
  }

  const isFillBlank = question.type === "fill-blank";
  if (isFillBlank) {
    const inputs = document.querySelectorAll(".fill-blank-input");
    runtime.selectedAnswers = Array.from(inputs).map((element) => element.value.trim());
    if (runtime.selectedAnswers.every((value) => !value)) return alert("请填写答案。");
  } else {
    if (!runtime.selectedAnswers.length) return alert("请选择答案。");
    runtime.selectedAnswers = getChoiceAnswerTexts(question, runtime.selectedAnswers);
  }

  let correct;
  if (isFillBlank) {
    correct = isFillBlankAnswerCorrect(question, runtime.selectedAnswers);
  } else {
    correct = isChoiceAnswerCorrect(question, runtime.selectedAnswers);
  }

  const statsBefore = {
    wrongCount: Number(question.wrongCount) || 0,
    correctCount: Number(question.correctCount) || 0,
    review: { ...(question.review || {}) }
  };
  const rollbackStats = () => {
    question.wrongCount = statsBefore.wrongCount;
    question.correctCount = statsBefore.correctCount;
    question.review = statsBefore.review;
    if (course.practice.lastAnswer?.questionId === question.id) {
      course.practice.lastAnswer = null;
    }
  };

  runtime.answerFeedback = {
    questionId: question.id,
    selectedAnswers: runtime.selectedAnswers,
    correct
  };

  course.practice.answeredInRound += 1;
  course.practice.totalAnswered += 1;
  const answeredAt = new Date().toISOString();
  if (correct) {
    course.practice.correctInRound += 1;
    course.practice.totalCorrect += 1;
    question.correctCount = (question.correctCount || 0) + 1;
  } else {
    question.wrongCount = (question.wrongCount || 0) + 1;
  }
  applyQuestionReview(question, { correct, selectedAnswers: runtime.selectedAnswers, answeredAt });
  course.practice.lastAnswer = runtime.answerFeedback;
  updatePracticeOnly();

  const willAutoNext = shouldAutoNextAfterSubmit({
    correct,
    autoNext: settings.autoNext,
    practice: course.practice
  });

  if (!willAutoNext) {
    const actions = document.querySelector(".actions");
    if (actions) actions.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const courseId = course.id;
  const questionId = question.id;
  const selectedAnswers = [...runtime.selectedAnswers];
  const operationId = createOperationId();
  const task = () => api.submitAnswer(courseId, questionId, selectedAnswers, operationId);

  enqueuePracticeSync(task)
    .then((payload) => {
      if (!applyPracticeStats(payload)) return;
      handleAnswerPayload(payload, rollbackStats);
      setupExamTimer();
    })
    .catch((error) => {
      registerPracticeFailure("同步答题", task, (payload) => {
        if (!applyPracticeStats(payload)) return;
        handleAnswerPayload(payload, rollbackStats);
      });
      showToast(`答题结果同步失败：${error.message || "请求失败"}`);
    });

  if (willAutoNext) {
    setTimeout(() => { nextQuestion(); }, 200);
  }
}

function applyNextPayload(payload) {
  if (!applyPracticePayload(payload)) return;
  clearCurrentAnswer();
  runtime.questionHistory = activeCourse().practice.historyIds || [];
  updatePracticeOnly();
  updatePrevBtn();
  setupExamTimer();
}

function applyResetPayload(payload) {
  if (!applyPracticePayload(payload)) return;
  clearCurrentAnswer();
  runtime.questionHistory = activeCourse().practice.historyIds || [];
  renderApp();
  updatePrevBtn();
  setupExamTimer();
}

function applyFinishPayload(payload) {
  if (!applyPracticePayload(payload)) return;
  clearCurrentAnswer();
  runtime.questionHistory = [];
  examFinishFailed = false;
  renderApp();
  updatePrevBtn();
}

async function resetRound() {
  if (runtime.pendingCourseId) return;
  if (!(await ensureActiveCourseSynced())) return;
  const course = activeCourse();
  if (!course) return;
  const courseId = course.id;
  const mode = runtime.practiceMode;
  const count = activePracticeCount();
  const timeLimitMinutes = runtime.examTimeLimitMinutes;
  const operationId = createOperationId();

  stageLocalPracticeRound();
  const task = () => api.resetRound(courseId, mode, count, timeLimitMinutes, operationId);
  const result = await request(() => enqueuePracticeSync(task), "重置本轮失败");
  if (!result.ok) {
    registerPracticeFailure("重置本轮", task, applyResetPayload);
    return;
  }
  applyResetPayload(result.value);
}

async function finishExam(timedOut = false) {
  if (!isExamMode()) return;
  if (runtime.finishingExam) return;
  runtime.finishingExam = true;
  if (!timedOut) examFinishFailed = false;
  try {
    if (!(await ensureActiveCourseSynced())) return;
    const course = activeCourse();
    if (!course) return;
    const courseId = course.id;
    const operationId = createOperationId();
    const task = () => api.finishExam(courseId, timedOut, operationId);
    const result = await request(() => enqueuePracticeSync(task), "结束模拟失败");
    if (!result.ok) {
      if (timedOut) examFinishFailed = true;
      registerPracticeFailure("结束模拟", task, applyFinishPayload);
      return;
    }
    applyFinishPayload(result.value);
  } finally {
    runtime.finishingExam = false;
    setupExamTimer();
  }
}

async function handleExamAction(event) {
  const action = event.target.closest("[data-exam-action]")?.dataset.examAction;
  if (!action) return;

  if (action === "review-wrong") {
    runtime.practiceMode = "exam-wrong";
    localStorage.setItem("quiz-platform-practice-mode", runtime.practiceMode);
    switchTab("practicePanel");
    await resetRound();
    return;
  }

  if (action === "finish") {
    await finishExam(false);
  }
}

async function handleRoundAction(event) {
  const action = event.target.closest("[data-round-action]")?.dataset.roundAction;
  if (!action) return;

  if (action === "next-round") {
    await nextQuestion();
  }
}

function setupExamTimer() {
  if (runtime.examTimerId) {
    clearInterval(runtime.examTimerId);
    runtime.examTimerId = null;
  }
  updateExamTimerText();
  const course = activeCourse();
  const practice = course?.practice;
  const exam = practice?.exam;
  if (!practice || !isExamMode(practice.mode) || !exam?.startedAt || exam.finishedAt) {
    toggleFinishExamButton(false);
    return;
  }

  toggleFinishExamButton(true);
  runtime.examTimerId = setInterval(() => {
    const remaining = updateExamTimerText();
    if (remaining <= 0 && !examFinishFailed) finishExam(true);
  }, 1000);
}

function updateExamTimerText() {
  const timer = $("#examTimer");
  const course = activeCourse();
  const practice = course?.practice;
  const exam = practice?.exam;
  if (!timer || !practice || !isExamMode(practice.mode) || !exam?.startedAt || exam.finishedAt) return Infinity;

  const remaining = remainingExamMs(exam);
  const seconds = Math.max(0, Math.ceil(remaining / 1000));
  const minutesPart = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsPart = String(seconds % 60).padStart(2, "0");
  timer.textContent = `${minutesPart}:${secondsPart}`;
  timer.classList.toggle("is-danger", remaining <= 60_000);
  return remaining;
}

function remainingExamMs(exam) {
  const started = Date.parse(exam.startedAt || "");
  if (!started) return Infinity;
  const limitMs = (Number(exam.timeLimitMinutes) || runtime.examTimeLimitMinutes || 20) * 60_000;
  return started + limitMs - Date.now();
}

function toggleFinishExamButton(show) {
  const button = $("#finishExamBtn");
  if (button) button.style.display = show ? "" : "none";
}

async function handleReviewActions(event) {
  const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
  if (!action) return;

  if (action === "practice-wrong") {
    runtime.practiceMode = "wrong";
    localStorage.setItem("quiz-platform-practice-mode", runtime.practiceMode);
    const modeRadio = document.querySelector("input[name='practiceMode'][value='wrong']");
    if (modeRadio) modeRadio.checked = true;
    switchTab("practicePanel");
    await resetRound();
    return;
  }

  if (action === "open-wrong-bank") {
    runtime.bankShowWrongOnly = true;
    runtime.bankShowBookmarkedOnly = false;
    runtime.bankSearch = "";
    switchTab("bankPanel");
    renderApp();
  }
}

async function deleteQuestion(event) {
  const id = event.target.dataset.delete;
  if (!id || !confirm("确认删除这道题？")) return;
  if (!(await ensureActiveCourseSynced())) return;
  const result = await request(() => api.deleteQuestion(id), "删除题目失败");
  if (!result.ok) return;
  if (!hydrateAndApplyState(result.value)) return;
  clearCurrentAnswer();
  clearOptionOrder(id);
  renderApp();
  updatePrevBtn();
}

function handleBankSearch(event) {
  if (event.target.id === "bankSearch") {
    runtime.bankSearch = event.target.value;
    clearTimeout(bankSearchRenderTimer);
    bankSearchRenderTimer = setTimeout(() => {
      updateBankListOnly();
    }, 120);
  }
}

function handleBankToolbar(event) {
  if (event.target.id === "createQuestionBtn") {
    runtime.creatingQuestion = true;
    runtime.editingQuestionId = null;
    renderApp();
  }
  if (event.target.id === "toggleWrongOnlyBtn") {
    runtime.bankShowWrongOnly = !runtime.bankShowWrongOnly;
    renderApp();
  }
  if (event.target.id === "toggleBookmarkedOnlyBtn") {
    runtime.bankShowBookmarkedOnly = !runtime.bankShowBookmarkedOnly;
    renderApp();
  }
}

async function handleBookmarkClick(event) {
  const button = event.target.closest("[data-bookmark]");
  if (!button) return;

  const questionId = button.dataset.bookmark;
  const course = activeCourse();
  if (!course) return;
  if (!(await ensureActiveCourseSynced())) return;
  const courseId = course.id;
  const operationId = createOperationId();
  const result = await request(() => api.bookmarkQuestion(courseId, questionId, operationId), "收藏状态保存失败");
  if (!result.ok) return;
  if (!applyQuestionPayload(result.value)) return;
  if ($("#practicePanel")?.classList.contains("active")) updatePracticeOnly();
  if ($("#bankPanel")?.classList.contains("active")) updateBankListOnly();
}

function handleBankActions(event) {
  const target = event.target;

  if (target.dataset.edit) {
    runtime.editingQuestionId = target.dataset.edit;
    runtime.creatingQuestion = false;
    renderApp();
    return;
  }

  if (target.dataset.cancelForm) {
    if (target.dataset.cancelForm === "create") runtime.creatingQuestion = false;
    else runtime.editingQuestionId = null;
    renderApp();
    return;
  }

  if (target.dataset.saveForm) {
    saveQuestionForm(target.dataset.saveForm);
    return;
  }

  if (target.classList.contains("form-add-option")) {
    addOptionRow(target.dataset.formId);
    return;
  }

  if (target.classList.contains("form-remove-option")) {
    removeOptionRow(target);
  }
}

function handleBankFormInput(event) {
  if (!event.target.classList.contains("form-option-key") && !event.target.classList.contains("form-option-text")) return;
  const form = event.target.closest("[data-form-id]");
  if (!form) return;

  const options = Array.from(form.querySelectorAll(".form-option-row")).map((row) => ({
    key: row.querySelector(".form-option-key").value.trim().toUpperCase(),
    text: row.querySelector(".form-option-text").value.trim()
  })).filter((option) => option.key);
  refreshOptionCheckboxes(form.dataset.formId, options);
}

document.addEventListener("change", (event) => {
  if (event.target.classList.contains("form-type")) {
    const form = event.target.closest(".bank-form");
    if (!form) return;
    const isFillBlank = event.target.value === "fill-blank";
    const choiceSection = form.querySelector(".form-choice-section");
    const fillBlankSection = form.querySelector(".form-fill-blank-section");
    if (choiceSection) choiceSection.style.display = isFillBlank ? "none" : "";
    if (fillBlankSection) fillBlankSection.style.display = isFillBlank ? "" : "none";
  }
});

function getFormData(formId) {
  const form = findForm(formId);
  if (!form) return null;

  const stem = form.querySelector(".form-stem").value.trim();
  const explanation = form.querySelector(".form-explanation").value.trim();
  const memoryTip = form.querySelector(".form-memory-tip")?.value.trim() || "";
  const typeSelect = form.querySelector(".form-type");
  const type = typeSelect ? typeSelect.value : "choice";

  if (type === "fill-blank") {
    const answerText = form.querySelector(".form-fill-blank-answer").value.trim();
    const answer = answerText.split(/[；;]/).map((value) => value.trim()).filter(Boolean);
    return { type: "fill-blank", stem, options: [], answer, explanation, memoryTip };
  }

  const optionRows = form.querySelectorAll(".form-option-row");
  const options = [];
  optionRows.forEach((row) => {
    const key = row.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = row.querySelector(".form-option-text").value.trim();
    if (key && text) options.push({ key, text });
  });

  const answerCheckboxes = form.querySelectorAll(".form-answers input[type='checkbox']:checked");
  const answer = Array.from(answerCheckboxes).map((checkbox) => checkbox.value);

  return { type: "choice", stem, options, answer, explanation, memoryTip };
}

function refreshOptionCheckboxes(formId, options) {
  const form = findForm(formId);
  if (!form) return;

  const answersDiv = form.querySelector(".form-answers");
  if (!answersDiv) return;

  const checked = Array.from(answersDiv.querySelectorAll("input:checked"));
  const checkedIndexes = new Set(checked.map((checkbox) => checkbox.dataset.optionIndex).filter(Boolean));
  const checkedValues = checked.map((checkbox) => checkbox.value);

  answersDiv.innerHTML = options.map((option, index) => `
    <label class="form-answer-check">
      <input type="checkbox" value="${escapeHtml(option.text)}" data-option-index="${index}" ${checkedIndexes.has(String(index)) || checkedValues.some((value) => normalizeChoiceText(value) === normalizeChoiceText(option.text)) ? "checked" : ""}>
      <span>${escapeHtml(option.key)}. ${escapeHtml(option.text)}</span>
    </label>
  `).join("");
}

function addOptionRow(formId) {
  const form = findForm(formId);
  if (!form) return;

  const optionsDiv = form.querySelector(".form-options");
  const rows = optionsDiv.querySelectorAll(".form-option-row");
  const nextKey = String.fromCharCode(65 + rows.length);

  const row = document.createElement("div");
  row.className = "form-option-row";
  row.innerHTML = `
    <input type="text" class="form-option-key" value="${nextKey}" maxlength="2" placeholder="键">
    <input type="text" class="form-option-text" value="" placeholder="选项内容">
    <button class="ghost form-remove-option" data-index="${rows.length}">删除</button>
  `;
  optionsDiv.appendChild(row);

  const options = [];
  optionsDiv.querySelectorAll(".form-option-row").forEach((item) => {
    const key = item.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = item.querySelector(".form-option-text").value.trim();
    if (key) options.push({ key, text });
  });
  refreshOptionCheckboxes(formId, options);
}

function removeOptionRow(target) {
  const row = target.closest(".form-option-row");
  const optionsDiv = row.parentElement;
  const formId = optionsDiv.dataset.formId;

  if (optionsDiv.querySelectorAll(".form-option-row").length <= 2) {
    alert("至少需要 2 个选项");
    return;
  }

  row.remove();

  const options = [];
  optionsDiv.querySelectorAll(".form-option-row").forEach((item) => {
    const key = item.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = item.querySelector(".form-option-text").value.trim();
    if (key) options.push({ key, text });
  });
  refreshOptionCheckboxes(formId, options);
}

async function saveQuestionForm(formId) {
  const data = getFormData(formId);
  if (!data) return;

  if (!data.stem) return alert("请输入题干");
  if (data.type === "fill-blank") {
    if (!data.answer.length) return alert("请输入正确答案");
  } else {
    if (data.options.length < 2) return alert("至少需要 2 个选项");
    if (!data.answer.length) return alert("请勾选正确答案");
  }

  if (!(await ensureActiveCourseSynced())) return;
  if (formId === "create") {
    const result = await request(() => api.addQuestions([data]), "创建题目失败");
    if (!result.ok) return;
    if (!hydrateAndApplyState(result.value)) return;
    runtime.creatingQuestion = false;
    clearAllOptionOrders();
  } else {
    const questionId = formId.replace("edit-", "");
    const result = await request(() => api.updateQuestion(questionId, data), "保存题目失败");
    if (!result.ok) return;
    if (!hydrateAndApplyState(result.value)) return;
    runtime.editingQuestionId = null;
    clearOptionOrder(questionId);
  }

  renderApp();
}

async function recognizeImage() {
  const file = $("#imageInput").files[0];
  if (!file) return alert("请先选择图片。");
  $("#status").textContent = "AI 正在识别...";
  $("#importResult").innerHTML = `<div class="import-summary">正在上传图片并调用 AI，请稍候。</div>`;
  try {
    const imageDataUrl = await readFileAsDataUrl(file);
    const recognition = await api.recognizeImage(imageDataUrl);
    const questions = recognition.questions || [];
    if (!questions.length) {
      $("#status").textContent = "AI 识别完成，但没有返回可导入题目。";
      $("#importResult").innerHTML = `<div class="import-summary">没有识别到题目。建议换更清晰的截图，或确认图片里包含题干、选项和答案。</div>`;
      return;
    }

    if (!(await ensureActiveCourseSynced())) return;
    const result = await api.addQuestions(questions);
    if (!hydrateAndApplyState(result)) return;
    $("#status").textContent = `AI 导入完成：识别 ${result.importResult.total} 道，成功 ${result.importResult.accepted.length} 道，失败 ${result.importResult.rejected.length} 道。`;
    renderImportResult(result.importResult, "AI 导入");
    clearAllOptionOrders();
    renderApp();
    updatePrevBtn();
  } catch (error) {
    $("#status").textContent = error.message;
    $("#importResult").innerHTML = `<div class="import-summary">AI 导入失败：${escapeHtml(error.message || "未知错误")}</div>`;
  }
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (!$("#practicePanel")?.classList.contains("active")) return;
    const tagName = event.target.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT" || tagName === "BUTTON") return;
    if (event.target.isContentEditable) return;

    const key = event.key.toUpperCase();
    const question = currentQuestion();
    if (/^[A-Z]$/.test(key) && question && !runtime.answerFeedback && !isQuestionAnsweredInRound(activeCourse().practice, question.id)) {
      const option = question.options.find((item) => String(item.key || "").toUpperCase() === key);
      if (option) {
        const isMulti = question.answer.length > 1;
        const input = document.querySelector(`input[name='answer'][data-key='${key}']`);
        if (!input) return;

        if (isMulti) {
          input.checked = !input.checked;
          if (input.checked) {
            runtime.selectedAnswers = getChoiceAnswerTexts(question, [...runtime.selectedAnswers, option.text]);
          } else {
            runtime.selectedAnswers = runtime.selectedAnswers.filter((value) => normalizeChoiceText(value) !== normalizeChoiceText(option.text));
          }
        } else {
          document.querySelectorAll("input[name='answer']").forEach((element) => { element.checked = false; });
          input.checked = true;
          runtime.selectedAnswers = getChoiceAnswerTexts(question, [option.text]);
        }
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitAnswer();
      return;
    }

    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      nextQuestion();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      prevQuestion();
    }
  });
}

function setupStickyActions() {
  const bar = document.getElementById("stickyActions");
  const card = document.getElementById("quizCard");
  if (!bar || !card || typeof IntersectionObserver !== "function") return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      bar.classList.toggle("is-floating", entry.isIntersecting);
    });
  }, { threshold: 0.15 });
  observer.observe(card);
}

function showBootError(error) {
  showAppStatus(`题库加载失败：${error.message || "请求失败"}。Render 免费实例首次启动通常需要 30 到 60 秒。`, {
    tone: "error",
    action: { label: "重新加载", onClick: () => { boot().catch(() => {}); } }
  });
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    showAppStatus("正在加载题库，首次打开可能需要约 30 秒…");
    const payload = await api.bootstrap();
    runtime.revision = Number(payload.revision) || 0;
    runtime.state = hydrateStatePayload(payload);
    const course = activeCourse();
    if (!course) throw new Error("题库中没有课程");

    runtime.practiceMode = course.practice.mode || runtime.practiceMode;
    runtime.practiceCount = course.practice.count || runtime.practiceCount;
    if (course.practice.mode === "exam") {
      runtime.examCount = course.practice.count || runtime.examCount;
    }
    if (course.practice.exam?.timeLimitMinutes) {
      runtime.examTimeLimitMinutes = course.practice.exam.timeLimitMinutes;
    }
    runtime.questionHistory = course.practice.historyIds || [];

    if (course.practice.lastAnswer?.questionId === course.practice.currentQuestionId) {
      runtime.answerFeedback = course.practice.lastAnswer;
      runtime.selectedAnswers = course.practice.lastAnswer.selectedAnswers || [];
    }

    if (!booted) {
      bind();
      setupStickyActions();
      bindKeyboardShortcuts();
      booted = true;
    }
    syncPracticeInputs();
    hideAppStatus();
    renderApp();
    updatePrevBtn();
    setupExamTimer();
  })();

  try {
    await bootPromise;
  } catch (error) {
    showBootError(error);
    throw error;
  } finally {
    bootPromise = null;
  }
}

boot().catch(() => {});
