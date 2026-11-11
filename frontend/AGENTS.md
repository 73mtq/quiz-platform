# FRONTEND KNOWLEDGE BASE

## OVERVIEW

单页应用（SPA），原生 JavaScript（无框架、无构建、无打包）。`index.html` 加载 `src/main.js` 作为 ES module。四个 Tab：导入 / 刷题 / 复习 / 题库。状态以服务端为权威；前端做乐观更新（切题、答题立即本地生效，后台同步统计字段）。所有 `api.*` 失败都会显示到全局提示条（`#toast`）。

## STRUCTURE

```
frontend/
├── index.html          # 118 行：四个 panel + 工具栏 + 提示条容器
├── src/
    ├── main.js         # 996 行：controller —— 事件绑定 + 业务函数 + 错误提示
    ├── styles.css      # 1619 行：全部样式（主题变量、动画、提示条）
    ├── api/client.js   # 47 行：单一 request() + 14 个端点包装
    ├── state/appState.js # 45 行：settings (localStorage) + runtime (内存)
    ├── ui/render.js    # 760 行：renderApp / renderPractice / renderReview / renderBank
    ├── data/
    │   └── reviewTaxonomy.js # 85 行：复习分析的领域关键词与题型规则
    └── utils/
        ├── answers.js      # 53 行：选项文本解析与选择/填空判定
        ├── format.js       # 22 行：escapeHtml / rate / readFileAsDataUrl
        ├── parser.js       # 142 行：parseQuestions —— 粘贴文本的正则式行解析
        ├── practiceFlow.js # 86 行：轮次进度计算与自动下一题判定
        └── review.js       # 193 行：复习分析与复习进度更新
└── test/
    └── review.test.js  # 60 行：复习分析单元测试（node --test）
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改全局状态形状 | `state/appState.js` | `settings` 走 localStorage；`runtime` 是易失状态 |
| 改 API 调用 | `api/client.js` | 14 个方法对应所有后端端点；throw `Error(payload.error)` |
| 改题目渲染 | `ui/render.js:renderChoicePractice` / `renderFillBlankPractice` | 选/填空分支 |
| 改题库管理 | `ui/render.js:renderBank` / `renderQuestionForm` | 列表 + 新建/编辑表单 |
| 改粘贴文本解析 | `utils/parser.js` | 5 个顶部正则：start/option/answer/explanation/noise |
| 改事件绑定 | `main.js:bind()` | 一处集中；不要散落到其他文件 |
| 改键盘快捷键 | `main.js:bindKeyboardShortcuts()` | 选项字母按当前题目生成；INPUT/TEXTAREA/SELECT 豁免 |
| 改答题判定 | `utils/answers.js` / `routes.js:handleApi(/api/practice/answer)` | 两端必须一致；`backend/test/parity.test.js` 会检查 |
| 改复习进度更新 | `utils/review.js:applyQuestionReview` | 与后端 `utils.js:updateQuestionReview` 对应 |
| 改复习关键词/题型规则 | `data/reviewTaxonomy.js` | 纯数据文件，不含逻辑 |
| 改失败提示 | `main.js:showToast` / `main.js:request` | 所有 `api.*` 调用都应经 `request()` |
| 改样式主题 | `styles.css` | 主色 `#b85c2a`（hero `theme-color` 为 `#c05529`） |

## CODE MAP

| Symbol | File:Line | Role |
|--------|-----------|------|
| `runtime` | appState.js:8 | 易失状态：`state` / `selectedAnswers` / `answerFeedback` / `practiceMode` / `questionHistory` |
| `settings` | appState.js:1 | 持久化：`showAnswer` / `showExplanation` / `autoNext` / `shuffleOptions` |
| `activeCourse()` | appState.js:26 | `runtime.state.courses.find(id === activeCourseId)` |
| `currentQuestion()` | appState.js:30 | 通过 `practice.currentQuestionId` 找题目 |
| `clearCurrentAnswer()` | appState.js:35 | 清空选中答案与答题反馈 |
| `request(path, options)` | api/client.js:1 | 单一 fetch 包装；非 2xx → throw |
| `api.*` | api/client.js:14 | 14 个端点（state / courses.* / questions.* / practice.* / study-notes / recognize-image） |
| `showToast(message)` | main.js:26 | 全局提示条，4 秒后自动隐藏 |
| `request(action, failureMessage)` | main.js:35 | 包装 `api.*` 调用，失败提示并返回 `{ok:false}` |
| `bind()` | main.js:44 | 所有事件绑定入口 |
| `stageLocalPracticeRound()` | main.js:240 | 切换模式时本地重置轮次并重渲染 |
| `nextQuestion()` | main.js:322 | 乐观切题 + 后台同步统计 |
| `submitAnswer()` | main.js:406 | 乐观判定 + 更新本地统计 + 后台同步 |
| `bindKeyboardShortcuts()` | main.js:906 | A–H 选选项 / Enter 提交 / ←→ 切题 / Space 下一题 |
| `parseQuestions(text)` | utils/parser.js:9 | 行式扫描；自动判定 choice vs fill-blank |
| `cleanText` / `cleanOption` | utils/parser.js:114,124 | 合并中文拆字空格；修 OCR 错字（`汽车轮取` → `汽车轮胎`） |
| `getChoiceAnswerTexts` | utils/answers.js:8 | 把答案 key 或文本统一解析为选项文本 |
| `isChoiceAnswerCorrect` | utils/answers.js:35 | 排序后集合相等 |
| `isFillBlankAnswerCorrect` | utils/answers.js:41 | 逐空匹配，每空任一可接受答案 |
| `applyQuestionReview` | utils/review.js:63 | 更新连对次数与已掌握标记 |
| `analyzeReview(course)` | utils/review.js:3 | 生成复习面板的错题统计、类型、板块与优先列表 |
| `shuffleArray(arr)` | ui/render.js:17 | Fisher-Yates；用于选项乱序 |
| `animateQuizCard()` | ui/render.js:31 | 移动端 (`innerWidth <= 760`) 跳过动画 |
| `renderApp()` | ui/render.js:40 | 全量渲染（四个 panel） |
| `updatePracticeOnly()` | ui/render.js:52 | 仅重画答题区；切题/答题时用，省 DOM 操作 |
| `updateBankListOnly()` | ui/render.js:56 | 仅重画题库列表；搜索输入防抖后调用 |
| `renderBank()` | ui/render.js:606 | 仅在 `bankPanel.active` 时渲染，避免 1900+ 题目无谓重建 |

## CONVENTIONS

- **零构建**：`index.html` 直接 `<script type="module" src="./src/main.js">`；无 bundler/转译
- **顶层 await**：`main.js` 末尾有 `runtime.state = await api.state()`，必须 module 加载
- **导入扩展名**：ESM 要求，所有 `import` 显式写 `.js`
- **DOM 选择器**：用文件内 `$ = (s) => document.querySelector(s)`，不引外部库
- **HTML 转义**：所有用户内容经 `escapeHtml`；不要直接 innerHTML 拼字符串（XSS 风险）
- **localStorage key 命名**：`quiz-platform-*` 前缀（避免和别的项目冲突）
- **事件委托**：答题卡片的 `data-bookmark` 用 `quizCard.addEventListener('click', ...)` 统一处理
- **失败提示**：新的 `api.*` 调用要用 `request(action, failureMessage)`，不要让 Promise 静默失败

## ANTI-PATTERNS (THIS PROJECT)

- **不要**用 `document.write` / `eval` / 任何同步阻塞操作
- **不要**在 `renderApp()` 之外直接操作 DOM —— 状态驱动渲染
- **不要**让"乐观更新"与服务端判断逻辑分叉 —— 判定函数改动后跑 `parity.test.js`
- **不要**把"上一题历史"放到 `practice` 子对象 —— 它是 UI-only 状态，应留在 `runtime.questionHistory`
- **不要**用 `addEventListener` 给每个 `<input>` 绑 change —— `renderChoicePractice` 内已经处理
- **不要**改 `settings` 默认值而不更新 `localStorage` 默认 —— 老用户的 `null` 会变 `true`
- **不要**让 `parser.js` 引入第三方 NLP 库 —— 它是纯正则实现，有意保持
- **不要**在 `reviewTaxonomy.js` 里写逻辑 —— 它只存放领域数据

## UNIQUE STYLES

- **四 Tab 切换**：`data-tab` 属性 + `.active` class；切到 bankPanel / reviewPanel 时强制 `renderApp()`
- **填空题多空**：`question.answer[i]` 与输入框下标一一对应；分隔符 `；;|、` 任意一种
- **错题重做定义**：服务端 `wrongCount > 0` —— 题库“只看错题”和“错题重做”保持同一口径
- **乐观更新 + 统计字段同步**：`nextQuestion` / `submitAnswer` 后台 `.then` 只同步统计字段，不覆盖 `currentQuestionId` 和 `remainingIds`
- **练习补丁合并**：练习端点只返回 `{ courseId, practice }` 补丁；`resetRound` / `finishExam` 整体替换 `practice`，切题与答题只合并统计和 `exam`，避免后台响应覆盖本地刚切到的题目
- **请求串行化**：练习相关请求统一走 `enqueuePracticeSync`，保证答题、切题、重置按用户操作顺序落到服务端并合并响应
- **OCR 容错正则链**：`parser.js:normalize` 做全角→半角 + 修 `PMoO|PmoO|PM0|Pwo` → `PMO` + 修 `汽车轮取` → `汽车轮胎`
- **多答案排序比较**：两边都规范化后排序，再逐位比较；大小写与全角/半角无关
- **多选题自动判断**：`question.answer.length > 1` → checkbox + multi-hint；否则 radio
- **选项乱序触发条件**：仅 `settings.shuffleOptions === true` 时 Fisher-Yates
- **刷题模式持久化**：`runtime.practiceMode` 写 `localStorage["quiz-platform-practice-mode"]`，模式切换立即重置轮次
- **考试模式**：`exam` 限时模拟、`exam-wrong` 复盘本轮错题；倒计时由 `setupExamTimer` 维护

## NOTES

- `main.js` 顶层 await 抛错时显示带 stack 的红色错误页（开发体验保留）
- `runtime.state` 启动时调 `api.state()` 同步；之后写操作经 `request()` 更新
- 上一题/下一题：`prevQuestion` 把当前题 `unshift` 回 `remainingIds`；`nextQuestion` 用 `questionHistory` 记录
- `bankList` 同时绑 `click` 给 `deleteQuestion` 和 `handleBankActions`（事件复用，靠 dataset 区分）
- 移动端 `innerWidth <= 760` 跳过 `fadeSlideUp` 动画以提升性能
- 答题后 `setTimeout(..., 200)` 触发自动下一题（仅 `settings.autoNext` + 答对 + 本轮还有剩余题）
