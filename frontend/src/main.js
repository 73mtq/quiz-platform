import { api } from "./api/client.js";
import { activeCourse, clearCurrentAnswer, currentQuestion, persistFeedbackSettings, runtime, settings } from "./state/appState.js";
import { renderApp, renderImportResult, updatePracticeOnly } from "./ui/render.js";
import { escapeHtml, readFileAsDataUrl } from "./utils/format.js";
import { parseQuestions } from "./utils/parser.js";

const $ = (selector) => document.querySelector(selector);

const sample = `1. 下列哪项活动不是项目（）。
A. 开发操作系统
B. 准备大运会比赛用场馆
C. 生产汽车轮胎
D. 策划野餐活动
答案：C
解析：生产汽车轮胎属于运营活动。`;

function bind() {
  document.querySelectorAll(".tabs button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tabs button,.panel").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#${button.dataset.tab}`).classList.add("active");
      // 切换到题库时触发渲染（题库面板默认跳过渲染以提升性能）
      if (button.dataset.tab === "bankPanel") renderApp();
    });
  });

  $("#sampleBtn").addEventListener("click", () => { $("#sourceText").value = sample; });
  $("#showAnswerToggle").checked = settings.showAnswer;
  $("#showExplanationToggle").checked = settings.showExplanation;
  $("#autoNextToggle").checked = settings.autoNext;
  $("#shuffleOptionsToggle").checked = settings.shuffleOptions;
  $("#showAnswerToggle").addEventListener("change", (event) => {
    settings.showAnswer = event.target.checked;
    persistFeedbackSettings();
    renderApp();
  });
  $("#showExplanationToggle").addEventListener("change", (event) => {
    settings.showExplanation = event.target.checked;
    persistFeedbackSettings();
    renderApp();
  });
  $("#autoNextToggle").addEventListener("change", (event) => {
    settings.autoNext = event.target.checked;
    persistFeedbackSettings();
  });
  $("#shuffleOptionsToggle").addEventListener("change", (event) => {
    settings.shuffleOptions = event.target.checked;
    persistFeedbackSettings();
    renderApp();
  });
  $("#importTextBtn").addEventListener("click", importText);
  $("#aiBtn").addEventListener("click", recognizeImage);
  $("#courseSelect").addEventListener("change", setActiveCourse);
  $("#addCourseBtn").addEventListener("click", addCourse);
  $("#deleteCourseBtn").addEventListener("click", deleteCourse);
  $("#nextBtn").addEventListener("click", nextQuestion);
  $("#prevBtn").addEventListener("click", prevQuestion);
  $("#submitBtn").addEventListener("click", submitAnswer);
  $("#resetRoundBtn").addEventListener("click", resetRound);
  $("#bankList").addEventListener("click", deleteQuestion);
  $("#bankList").addEventListener("click", handleBankActions);
  $("#bankToolbar").addEventListener("click", handleBankToolbar);
  $("#bankToolbar").addEventListener("input", handleBankSearch);

  // 收藏按钮点击
  $("#quizCard").addEventListener("click", handleBookmarkClick);

  // 刷题模式切换
  document.querySelectorAll("input[name='practiceMode']").forEach((radio) => {
    radio.addEventListener("change", async (event) => {
      runtime.practiceMode = event.target.value;
      localStorage.setItem("quiz-platform-practice-mode", runtime.practiceMode);
      const countInput = $("#practiceCountInput");
      const countHint = $("#practiceCountHint");
      if (countInput) countInput.style.display = runtime.practiceMode === "count" ? "" : "none";
      if (countHint) countHint.style.display = runtime.practiceMode === "count" ? "" : "none";
      // 切换模式时立即重置
      runtime.state = await api.resetRound(runtime.practiceMode, runtime.practiceCount);
      clearCurrentAnswer();
      runtime.questionHistory = [];
      renderApp();
      updatePrevBtn();
    });
  });

  const countInput = $("#practiceCountInput");
  if (countInput) {
    countInput.addEventListener("input", (event) => {
      runtime.practiceCount = Math.max(1, Number(event.target.value) || 1);
      localStorage.setItem("quiz-platform-practice-count", String(runtime.practiceCount));
    });
    // 数量输入框失焦或回车时重置
    countInput.addEventListener("change", async () => {
      runtime.practiceCount = Math.max(1, Number(countInput.value) || 1);
      localStorage.setItem("quiz-platform-practice-count", String(runtime.practiceCount));
      if (runtime.practiceMode === "count") {
        runtime.state = await api.resetRound(runtime.practiceMode, runtime.practiceCount);
        clearCurrentAnswer();
        renderApp();
      }
    });
  }
}

async function importText() {
  const parsed = parseQuestions($("#sourceText").value);
  if (!parsed.length) return alert("未识别到完整题目。选择题请确认包含题干、至少 2 个选项和答案；填空题请确认包含题干和答案。");

  const result = await api.addQuestions(parsed);
  runtime.state = result.state;
  $("#status").textContent = `文本导入完成：成功 ${result.importResult.accepted.length} 道，失败 ${result.importResult.rejected.length} 道。`;
  renderImportResult(result.importResult, "文本导入");
  renderApp();
}

async function setActiveCourse(event) {
  runtime.state = await api.setActiveCourse(event.target.value);
  clearCurrentAnswer();
  runtime.questionHistory = [];
  renderApp();
  updatePrevBtn();
}

async function addCourse() {
  runtime.state = await api.addCourse($("#courseName").value.trim() || "新课程");
  $("#courseName").value = "";
  clearCurrentAnswer();
  renderApp();
}

async function deleteCourse() {
  if (!confirm("确认删除当前课程？该课程下的题目也会删除。")) return;
  runtime.state = await api.deleteCourse(activeCourse().id);
  clearCurrentAnswer();
  renderApp();
}

async function nextQuestion() {
  const course = activeCourse();
  const prevId = course.practice.currentQuestionId;

  if (!course.practice.remainingIds.length) {
    // 题目用完了，需要重新洗牌 —— 必须等服务端返回新的 remainingIds
    runtime.state = await api.nextQuestion(runtime.practiceMode, runtime.practiceCount);
    clearCurrentAnswer();
    updatePracticeOnly();
    updatePrevBtn();
    return;
  }

  // 记录历史
  if (prevId) runtime.questionHistory.push(prevId);

  // 乐观更新：本地立即切换题目
  course.practice.currentQuestionId = course.practice.remainingIds.shift();
  course.practice.lastAnswer = null;
  clearCurrentAnswer();
  updatePracticeOnly();
  updatePrevBtn();

  // 后台同步服务端（只同步统计数据，不同步 remainingIds）
  api.nextQuestion(runtime.practiceMode, runtime.practiceCount).then((state) => {
    const serverCourse = state?.courses?.find((c) => c.id === activeCourse()?.id);
    if (!serverCourse) return;
    const localCourse = activeCourse();
    // 只同步统计数据，不同步 remainingIds（前端已管理）
    localCourse.practice.roundNo = serverCourse.practice.roundNo;
    localCourse.practice.answeredInRound = serverCourse.practice.answeredInRound;
    localCourse.practice.correctInRound = serverCourse.practice.correctInRound;
    localCourse.practice.totalAnswered = serverCourse.practice.totalAnswered;
    localCourse.practice.totalCorrect = serverCourse.practice.totalCorrect;
  }).catch(() => {});
}

function prevQuestion() {
  if (!runtime.questionHistory.length) return;
  const course = activeCourse();
  const prevId = runtime.questionHistory.pop();
  // 把当前题放回 remainingIds 头部
  if (course.practice.currentQuestionId) {
    course.practice.remainingIds.unshift(course.practice.currentQuestionId);
  }
  course.practice.currentQuestionId = prevId;
  course.practice.lastAnswer = null;
  clearCurrentAnswer();
  updatePracticeOnly();
  updatePrevBtn();
}

function updatePrevBtn() {
  const btn = $("#prevBtn");
  if (btn) btn.style.display = runtime.questionHistory.length ? "" : "none";
}

async function submitAnswer() {
  const question = currentQuestion();
  if (!question) return alert("请先点击下一题。");

  const isFillBlank = question.type === "fill-blank";
  if (isFillBlank) {
    const inputs = document.querySelectorAll(".fill-blank-input");
    runtime.selectedAnswers = Array.from(inputs).map((el) => el.value.trim());
    if (runtime.selectedAnswers.every((s) => !s)) return alert("请填写答案。");
  } else {
    if (!runtime.selectedAnswers.length) return alert("请选择答案。");
  }
  if (runtime.answerFeedback?.questionId === question.id) return alert("这道题已经提交。");

  // 乐观更新：本地立即判断对错，不等服务端
  let correct;
  if (isFillBlank) {
    const blanksCorrect = runtime.selectedAnswers.map((userAns, i) => {
      if (!userAns) return false;
      const acceptable = (question.answer[i] || "").split(/[；;|、]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      return acceptable.includes(userAns.toLowerCase());
    });
    correct = blanksCorrect.length === question.answer.length && blanksCorrect.every(Boolean);
  } else {
    const selected = runtime.selectedAnswers.map((s) => s.toUpperCase()).sort();
    const answer = [...question.answer].sort();
    correct = selected.length === answer.length && selected.every((s, i) => s === answer[i]);
  }

  // 立即显示反馈
  runtime.answerFeedback = {
    questionId: question.id,
    selectedAnswers: runtime.selectedAnswers,
    correct
  };
  runtime.submittedQuestionId = question.id;

  // 更新本地统计
  const course = activeCourse();
  course.practice.answeredInRound += 1;
  course.practice.totalAnswered += 1;
  if (correct) {
    course.practice.correctInRound += 1;
    course.practice.totalCorrect += 1;
    question.correctCount = (question.correctCount || 0) + 1;
  } else {
    question.wrongCount = (question.wrongCount || 0) + 1;
  }
  course.practice.lastAnswer = runtime.answerFeedback;
  updatePracticeOnly();

  // 答题后自动滚动到操作按钮
  const actions = document.querySelector(".actions");
  if (actions) {
    actions.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 后台同步服务端（不阻塞 UI）
  // 同步统计数据，不覆盖 currentQuestionId，防止答题后跳题
  api.submitAnswer(question.id, runtime.selectedAnswers).then((result) => {
    const serverCourse = result.state?.courses?.find((c) => c.id === activeCourse()?.id);
    if (!serverCourse) return;
    const localCourse = activeCourse();
    // 同步所有统计数据（除 currentQuestionId 外）
    localCourse.practice.totalAnswered = serverCourse.practice.totalAnswered;
    localCourse.practice.totalCorrect = serverCourse.practice.totalCorrect;
    localCourse.practice.answeredInRound = serverCourse.practice.answeredInRound;
    localCourse.practice.correctInRound = serverCourse.practice.correctInRound;
    // 同步题目级别的统计
    const serverQ = serverCourse.questions.find((q) => q.id === question.id);
    const localQ = localCourse.questions.find((q) => q.id === question.id);
    if (serverQ && localQ) {
      localQ.wrongCount = serverQ.wrongCount;
      localQ.correctCount = serverQ.correctCount;
    }
  }).catch(() => {});

  // 答对自动下一题
  if (correct && settings.autoNext) {
    setTimeout(() => {
      nextQuestion();
    }, 1500);
  }
}

async function resetRound() {
  runtime.state = await api.resetRound(runtime.practiceMode, runtime.practiceCount);
  clearCurrentAnswer();
  runtime.questionHistory = [];
  renderApp();
  updatePrevBtn();
}

async function deleteQuestion(event) {
  const id = event.target.dataset.delete;
  if (!id || !confirm("确认删除这道题？")) return;
  runtime.state = await api.deleteQuestion(id);
  clearCurrentAnswer();
  renderApp();
}

function handleBankSearch(event) {
  if (event.target.id === "bankSearch") {
    runtime.bankSearch = event.target.value;
    renderApp();
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
  const btn = event.target.closest("[data-bookmark]");
  if (!btn) return;

  const questionId = btn.dataset.bookmark;
  runtime.state = await api.bookmarkQuestion(questionId);
  renderApp();
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
    if (target.dataset.cancelForm === "create") {
      runtime.creatingQuestion = false;
    } else {
      runtime.editingQuestionId = null;
    }
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
    return;
  }
}

// 题目类型切换
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
  const form = document.querySelector(`[data-form-id="${formId}"]`);
  if (!form) return null;

  const stem = form.querySelector(".form-stem").value.trim();
  const explanation = form.querySelector(".form-explanation").value.trim();
  const typeSelect = form.querySelector(".form-type");
  const type = typeSelect ? typeSelect.value : "choice";

  if (type === "fill-blank") {
    const answerText = form.querySelector(".form-fill-blank-answer").value.trim();
    const answer = answerText.split(/[；;]/).map((s) => s.trim()).filter(Boolean);
    return { type: "fill-blank", stem, options: [], answer, explanation };
  }

  const optionRows = form.querySelectorAll(".form-option-row");
  const options = [];
  optionRows.forEach((row) => {
    const key = row.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = row.querySelector(".form-option-text").value.trim();
    if (key && text) options.push({ key, text });
  });

  const answerCheckboxes = form.querySelectorAll(".form-answers input[type='checkbox']:checked");
  const answer = Array.from(answerCheckboxes).map((cb) => cb.value);

  return { type: "choice", stem, options, answer, explanation };
}

function refreshOptionCheckboxes(formId, options) {
  const form = document.querySelector(`[data-form-id="${formId}"]`);
  if (!form) return;

  const answersDiv = form.querySelector(".form-answers");
  if (!answersDiv) return;

  const checkedKeys = new Set(
    Array.from(answersDiv.querySelectorAll("input:checked")).map((cb) => cb.value)
  );

  answersDiv.innerHTML = options.map((opt) => `
    <label class="form-answer-check">
      <input type="checkbox" value="${escapeHtml(opt.key)}" ${checkedKeys.has(opt.key) ? "checked" : ""}>
      <span>${escapeHtml(opt.key)}</span>
    </label>
  `).join("");
}

function addOptionRow(formId) {
  const form = document.querySelector(`[data-form-id="${formId}"]`);
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
  optionsDiv.querySelectorAll(".form-option-row").forEach((r) => {
    const key = r.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = r.querySelector(".form-option-text").value.trim();
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
  optionsDiv.querySelectorAll(".form-option-row").forEach((r) => {
    const key = r.querySelector(".form-option-key").value.trim().toUpperCase();
    const text = r.querySelector(".form-option-text").value.trim();
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

  if (formId === "create") {
    const result = await api.addQuestions([{ ...data, answer: data.answer }]);
    runtime.state = result.state;
    runtime.creatingQuestion = false;
  } else {
    const questionId = formId.replace("edit-", "");
    runtime.state = await api.updateQuestion(questionId, data);
    runtime.editingQuestionId = null;
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

    const result = await api.addQuestions(questions);
    runtime.state = result.state;
    $("#status").textContent = `AI 导入完成：识别 ${result.importResult.total} 道，成功 ${result.importResult.accepted.length} 道，失败 ${result.importResult.rejected.length} 道。`;
    renderImportResult(result.importResult, "AI 导入");
    renderApp();
  } catch (error) {
    $("#status").textContent = error.message;
    $("#importResult").innerHTML = `<div class="import-summary">AI 导入失败：${escapeHtml(error.message || "未知错误")}</div>`;
  }
}

function bindKeyboardShortcuts() {
  document.addEventListener("keydown", (event) => {
    // 如果用户正在输入框中输入，不触发快捷键
    const tagName = event.target.tagName;
    if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;

    const key = event.key.toUpperCase();

    // A/B/C/D 选择选项
    if (["A", "B", "C", "D"].includes(key)) {
      const question = currentQuestion();
      if (!question || runtime.answerFeedback) return;

      // 检查选项是否存在
      const optionExists = question.options.some((opt) => opt.key === key);
      if (!optionExists) return;

      const isMulti = question.answer.length > 1;
      const input = document.querySelector(`input[name='answer'][value='${key}']`);
      if (!input) return;

      if (isMulti) {
        input.checked = !input.checked;
        if (input.checked) {
          runtime.selectedAnswers = [...runtime.selectedAnswers, key];
        } else {
          runtime.selectedAnswers = runtime.selectedAnswers.filter((v) => v !== key);
        }
      } else {
        document.querySelectorAll("input[name='answer']").forEach((el) => {
          el.checked = false;
        });
        input.checked = true;
        runtime.selectedAnswers = [key];
      }
      return;
    }

    // Enter 提交答案
    if (event.key === "Enter") {
      event.preventDefault();
      submitAnswer();
      return;
    }

    // 右箭头或空格 下一题
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      nextQuestion();
      return;
    }

    // 左箭头 上一题
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      prevQuestion();
    }
  });
}

try {
  runtime.state = await api.state();
  bind();

  // 恢复上次答题状态
  const course = activeCourse();
  if (course.practice.lastAnswer) {
    runtime.answerFeedback = course.practice.lastAnswer;
    runtime.selectedAnswers = course.practice.lastAnswer.selectedAnswers || [];
    runtime.submittedQuestionId = course.practice.lastAnswer.questionId;
  }

  // 初始化刷题模式 UI
  const modeRadio = document.querySelector(`input[name='practiceMode'][value='${runtime.practiceMode}']`);
  if (modeRadio) modeRadio.checked = true;
  const countInput = document.querySelector("#practiceCountInput");
  const countHint = document.querySelector("#practiceCountHint");
  if (countInput) {
    countInput.style.display = runtime.practiceMode === "count" ? "" : "none";
    countInput.value = runtime.practiceCount;
  }
  if (countHint) countHint.style.display = runtime.practiceMode === "count" ? "" : "none";

  // 初始化键盘快捷键
  bindKeyboardShortcuts();

  renderApp();
} catch (err) {
  document.querySelector(".app").innerHTML = `<div style="padding:40px;color:red;font-size:18px;"><h2>页面加载出错</h2><pre>${err.message}\n${err.stack}</pre><p>请截图发给开发者。</p></div>`;
}
