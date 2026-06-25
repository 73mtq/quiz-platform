import { activeCourse, currentQuestion, runtime, settings } from "../state/appState.js";
import { escapeHtml, rate } from "../utils/format.js";

/** 随机打乱数组（Fisher-Yates 洗牌算法） */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const $ = (selector) => document.querySelector(selector);

/** 给答题卡片添加切换动画（仅桌面端，移动端跳过以提升性能） */
function animateQuizCard() {
  if (window.innerWidth <= 760) return; // 移动端跳过动画
  const card = $("#quizCard");
  if (!card) return;
  card.style.animation = "none";
  void card.offsetHeight; // 触发重绘
  card.style.animation = "fadeSlideUp 0.35s var(--ease-out) forwards";
}

export function renderApp() {
  const course = activeCourse();
  $("#questionCount").textContent = course.questions.length;
  $("#courseSelect").innerHTML = runtime.state.courses.map((item) => (
    `<option value="${item.id}" ${item.id === runtime.state.activeCourseId ? "selected" : ""}>${escapeHtml(item.name)}（${item.questions.length}题）</option>`
  )).join("");
  renderPractice(course);
  renderBank(course);
}

/** 只更新题目区域（答题/切题时用，跳过侧边栏和题库重建） */
export function updatePracticeOnly() {
  renderPractice(activeCourse());
}

export function renderImportResult(importResult, source = "导入") {
  const accepted = importResult.accepted || [];
  const rejected = importResult.rejected || [];
  const total = importResult.total ?? accepted.length + rejected.length;

  $("#importResult").innerHTML = `
    <div class="import-summary">
      <strong>${escapeHtml(source)}完成</strong>：识别到 ${total} 道，成功导入 ${accepted.length} 道，失败 ${rejected.length} 道。
      ${rejected.length ? "<br>失败题目没有写入题库，请根据下方原因修正后再导入。" : ""}
    </div>
    ${accepted.length ? `
      <div class="import-preview">
        <h3>成功导入</h3>
        ${accepted.map((question, index) => renderImportQuestion(question, index)).join("")}
      </div>
    ` : ""}
    ${rejected.length ? `
      <div class="import-preview rejected-list">
        <h3>未导入</h3>
        ${rejected.map((item) => `
          <article>
            <h3>${item.index}. ${escapeHtml(item.stem || "未识别题干")}</h3>
            <p>原因：${escapeHtml(item.reason)}</p>
          </article>
        `).join("")}
      </div>
    ` : ""}
  `;
}

function renderImportQuestion(question, index) {
  const isFillBlank = question.type === "fill-blank";
  return `
    <article>
      <h3>${index + 1}. ${escapeHtml(question.stem || "未命名题目")} ${isFillBlank ? '<span class="tag-fill-blank">填空题</span>' : ""}</h3>
      ${isFillBlank ? "" : `<p>选项数：${(question.options || []).length}</p>`}
      <p>答案：${(question.answer || []).join("、") || "未识别"}</p>
      <p>解析：${question.explanation ? "已识别" : "无"}</p>
    </article>
  `;
}

function renderPractice(course) {
  const practice = course.practice;
  const question = currentQuestion();
  const mode = practice.mode || "all";
  const count = practice.count || 0;

  // 同步模式选择 UI
  const countInput = $("#practiceCountInput");
  const countHint = $("#practiceCountHint");
  if (countInput) {
    countInput.style.display = runtime.practiceMode === "count" ? "" : "none";
    if (runtime.practiceMode === "count" && runtime.practiceCount > 0) countInput.value = runtime.practiceCount;
  }
  if (countHint) countHint.style.display = runtime.practiceMode === "count" ? "" : "none";

  const modeLabel = mode === "wrong" ? "错题重做" : mode === "count" ? `指定 ${count} 题` : "全部题目";
  $("#roundInfo").textContent = `${course.name}：${modeLabel}，剩余 ${practice.remainingIds.length} 题`;
  $("#accuracy").innerHTML = `
    <div><strong>${rate(practice.correctInRound, practice.answeredInRound)}</strong><span>正确率 ${practice.correctInRound}/${practice.answeredInRound}</span></div>
  `;
  if (!question) {
    // 指定数量模式下刷完本轮显示完成提示
    if (mode === "count" && practice.answeredInRound > 0) {
      $("#quizCard").innerHTML = `<p class="empty round-done">${practice.answeredInRound} 题已完成！正确率 ${rate(practice.correctInRound, practice.answeredInRound)}。点击"重置本轮"重新开始。</p>`;
    } else {
      $("#quizCard").innerHTML = `<p class="empty">点击"下一题"开始。</p>`;
    }
    animateQuizCard();
    return;
  }

  const isFillBlank = question.type === "fill-blank";

  if (isFillBlank) {
    renderFillBlankPractice(question);
  } else {
    renderChoicePractice(question);
  }
  animateQuizCard();

  // 有答案反馈时自动滚动到操作按钮（答题后或刷新页面）
  if (runtime.answerFeedback) {
    requestAnimationFrame(() => {
      const actions = document.querySelector(".actions");
      if (actions) {
        actions.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
}

function renderChoicePractice(question) {
  const isMulti = question.answer.length > 1;
  const inputType = isMulti ? "checkbox" : "radio";
  const multiHint = isMulti ? `<span class="multi-hint">（多选题，共${question.answer.length}个答案）</span>` : "";
  const wrongCount = question.wrongCount || 0;
  const wrongTag = wrongCount > 0 ? `<span class="wrong-count-tag">已错 ${wrongCount} 次</span>` : "";
  const bookmarked = question.bookmarked ? "active" : "";
  const options = settings.shuffleOptions ? shuffleArray(question.options) : question.options;
  $("#quizCard").innerHTML = `
    <div class="quiz-card-header">
      <h3>${escapeHtml(question.stem)} ${multiHint} ${wrongTag}</h3>
      <button class="bookmark-btn ${bookmarked}" data-bookmark="${question.id}" title="收藏">★</button>
    </div>
    ${options.map((option) => `
      <label class="option ${optionClass(question, option.key)}">
        <input type="${inputType}" name="answer" value="${option.key}" ${runtime.answerFeedback ? "disabled" : ""}>
        <span><b>${option.key}.</b> ${escapeHtml(option.text)}</span>
      </label>
    `).join("")}
    <div id="answerResult">${renderAnswerFeedback(question)}</div>
  `;
  document.querySelectorAll("input[name='answer']").forEach((input) => {
    input.checked = runtime.selectedAnswers.includes(input.value);
    input.addEventListener("change", () => {
      if (isMulti) {
        if (input.checked) {
          runtime.selectedAnswers = [...runtime.selectedAnswers, input.value];
        } else {
          runtime.selectedAnswers = runtime.selectedAnswers.filter((v) => v !== input.value);
        }
      } else {
        runtime.selectedAnswers = [input.value];
      }
    });
  });
}

function renderFillBlankPractice(question) {
  const feedback = runtime.answerFeedback;
  const hasSubmitted = feedback && feedback.questionId === question.id;
  const blankCount = question.answer.length;
  const blankHint = blankCount > 1 ? `<span class="multi-hint">（共 ${blankCount} 个空）</span>` : "";
  const wrongCount = question.wrongCount || 0;
  const wrongTag = wrongCount > 0 ? `<span class="wrong-count-tag">已错 ${wrongCount} 次</span>` : "";
  const bookmarked = question.bookmarked ? "active" : "";

  const blanksHtml = Array.from({ length: blankCount }, (_, i) => {
    const val = runtime.selectedAnswers[i] || "";
    return `<input type="text" class="fill-blank-input" data-index="${i}" placeholder="第${i + 1}个空" value="${escapeHtml(val)}" ${hasSubmitted ? "disabled" : ""}>`;
  }).join("");

  $("#quizCard").innerHTML = `
    <div class="quiz-card-header">
      <h3>${escapeHtml(question.stem)} ${blankHint} ${wrongTag}</h3>
      <button class="bookmark-btn ${bookmarked}" data-bookmark="${question.id}" title="收藏">★</button>
    </div>
    <div class="fill-blank-area">${blanksHtml}</div>
    <div id="answerResult">${renderAnswerFeedback(question)}</div>
  `;

  if (!hasSubmitted) {
    document.querySelectorAll(".fill-blank-input").forEach((input) => {
      input.addEventListener("input", () => {
        const inputs = document.querySelectorAll(".fill-blank-input");
        runtime.selectedAnswers = Array.from(inputs).map((el) => el.value.trim());
      });
    });
  }
}

function optionClass(question, key) {
  const feedback = runtime.answerFeedback;
  if (!feedback || feedback.questionId !== question.id) return "";
  if (question.answer.includes(key)) return "is-correct";
  if (feedback.selectedAnswers && feedback.selectedAnswers.includes(key)) return "is-wrong";
  return "";
}

function renderAnswerFeedback(question) {
  const feedback = runtime.answerFeedback;
  if (!feedback || feedback.questionId !== question.id) return "";

  const isFillBlank = question.type === "fill-blank";
  const selected = isFillBlank
    ? (feedback.selectedAnswers || []).map((s, i) => `第${i + 1}空：${s || "未填写"}`).join("、")
    : (feedback.selectedAnswers || []).join("、") || "未选择";
  const correctText = isFillBlank
    ? question.answer.map((s, i) => `第${i + 1}空：${s}`).join("、")
    : question.answer.join("、");

  const lines = [
    `<strong>${feedback.correct ? "回答正确" : "回答错误"}</strong>`,
    `你的答案：${escapeHtml(selected)}`
  ];
  if (settings.showAnswer) lines.push(`正确答案：${correctText}`);
  if (settings.showExplanation && question.explanation) lines.push(`解析：${escapeHtml(question.explanation)}`);
  if (!settings.showAnswer && !settings.showExplanation) lines.push("已记录本题结果，可在上方开关中选择是否显示答案和解析。");

  return `<div class="${feedback.correct ? "correct" : "wrong"}">${lines.join("<br>")}</div>`;
}

function renderBank(course) {
  // 仅在题库面板可见时渲染，避免 1900+ 题目不必要的 DOM 操作
  const bankPanel = $("#bankPanel");
  if (!bankPanel || !bankPanel.classList.contains("active")) return;

  const wrongCount = course.questions.filter((q) => (q.wrongCount || 0) > 0).length;
  const bookmarkedCount = course.questions.filter((q) => q.bookmarked).length;
  const bankToolbar = $("#bankToolbar");
  if (bankToolbar) {
    bankToolbar.innerHTML = `
      <span class="bank-count">共 ${course.questions.length} 题</span>
      <button id="toggleWrongOnlyBtn" class="ghost ${runtime.bankShowWrongOnly ? "active-filter" : ""}">只看错题（${wrongCount}）</button>
      <button id="toggleBookmarkedOnlyBtn" class="ghost ${runtime.bankShowBookmarkedOnly ? "active-filter" : ""}">只看收藏（${bookmarkedCount}）</button>
      <input type="text" id="bankSearch" placeholder="搜索题干关键词..." value="${runtime.bankSearch || ""}">
      <button id="createQuestionBtn" class="ghost">手动出题</button>
    `;
  }

  const keyword = (runtime.bankSearch || "").trim().toLowerCase();
  let filtered = keyword
    ? course.questions.filter((q) => q.stem.toLowerCase().includes(keyword))
    : course.questions;
  if (runtime.bankShowWrongOnly) {
    filtered = filtered.filter((q) => (q.wrongCount || 0) > 0);
    filtered = [...filtered].sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0));
  }
  if (runtime.bankShowBookmarkedOnly) {
    filtered = filtered.filter((q) => q.bookmarked);
  }

  const bankList = $("#bankList");
  if (runtime.creatingQuestion) {
    bankList.innerHTML = renderQuestionForm(null) + renderBankList(filtered);
  } else {
    bankList.innerHTML = renderBankList(filtered);
  }
}

function renderBankList(questions) {
  if (!questions.length) return `<p class="empty">${runtime.bankSearch ? "没有匹配的题目。" : "题库为空。"}</p>`;

  return questions.map((question, index) => {
    if (runtime.editingQuestionId === question.id) {
      return renderQuestionForm(question);
    }
    const isFillBlank = question.type === "fill-blank";
    const typeTag = isFillBlank ? `<span class="tag-fill-blank">填空题</span>` : "";
    const wrongCount = question.wrongCount || 0;
    const correctCount = question.correctCount || 0;
    const statsTag = wrongCount > 0 || correctCount > 0
      ? `<span class="stats-tag">${wrongCount > 0 ? `错 ${wrongCount}` : ""}${wrongCount > 0 && correctCount > 0 ? " / " : ""}${correctCount > 0 ? `对 ${correctCount}` : ""}</span>`
      : "";
    return `
      <article class="bank-item">
        <div>
          <h3>${index + 1}. ${escapeHtml(question.stem)} ${typeTag} ${statsTag}</h3>
          ${isFillBlank ? "" : `
          <div class="bank-options">
            ${question.options.map((option) => `<p><b>${option.key}.</b> ${escapeHtml(option.text)}</p>`).join("")}
          </div>
          `}
          <p>答案：${question.answer.join("、")}</p>
          ${question.explanation ? `<p>解析：${escapeHtml(question.explanation)}</p>` : ""}
        </div>
        <div class="bank-actions">
          <button class="ghost" data-edit="${question.id}">编辑</button>
          <button data-delete="${question.id}">删除</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderQuestionForm(question) {
  const isEdit = !!question;
  const stem = question?.stem || "";
  const options = question?.options || [{ key: "A", text: "" }, { key: "B", text: "" }];
  const answer = question?.answer || [];
  const explanation = question?.explanation || "";
  const formId = isEdit ? `edit-${question.id}` : "create";
  const isFillBlank = question?.type === "fill-blank";

  return `
    <article class="bank-item bank-form" data-form-id="${formId}">
      <div class="form-body">
        <label>题目类型</label>
        <select class="form-type" data-form-id="${formId}" ${isEdit ? "disabled" : ""}>
          <option value="choice" ${!isFillBlank ? "selected" : ""}>选择题</option>
          <option value="fill-blank" ${isFillBlank ? "selected" : ""}>填空题</option>
        </select>
        <label>题干</label>
        <textarea class="form-stem" placeholder="输入题干...填空题用 ____ 表示空位">${escapeHtml(stem)}</textarea>
        <div class="form-choice-section" ${isFillBlank ? 'style="display:none"' : ""}>
          <label>选项</label>
          <div class="form-options" data-form-id="${formId}">
            ${options.map((opt, i) => `
              <div class="form-option-row">
                <input type="text" class="form-option-key" value="${escapeHtml(opt.key)}" maxlength="2" placeholder="键">
                <input type="text" class="form-option-text" value="${escapeHtml(opt.text)}" placeholder="选项内容">
                <button class="ghost form-remove-option" data-index="${i}">删除</button>
              </div>
            `).join("")}
          </div>
          <button class="ghost form-add-option" data-form-id="${formId}">+ 添加选项</button>
          <label>答案（勾选正确选项）</label>
          <div class="form-answers" data-form-id="${formId}">
            ${options.map((opt) => `
              <label class="form-answer-check">
                <input type="checkbox" value="${escapeHtml(opt.key)}" ${answer.includes(opt.key) ? "checked" : ""}>
                <span>${escapeHtml(opt.key)}</span>
              </label>
            `).join("")}
          </div>
        </div>
        <div class="form-fill-blank-section" ${!isFillBlank ? 'style="display:none"' : ""}>
          <label>正确答案（多个答案用 ；分隔，任一匹配即正确）</label>
          <input type="text" class="form-fill-blank-answer" placeholder="例如：北京；首都" value="${escapeHtml(isFillBlank ? answer.join("；") : "")}">
        </div>
        <label>解析（可选）</label>
        <textarea class="form-explanation" placeholder="输入解析...">${escapeHtml(explanation)}</textarea>
      </div>
      <div class="form-actions">
        <button data-save-form="${formId}">${isEdit ? "保存" : "创建"}</button>
        <button class="ghost" data-cancel-form="${formId}">取消</button>
      </div>
    </article>
  `;
}
