# FRONTEND KNOWLEDGE BASE

## OVERVIEW

单页应用（SPA），原生 JavaScript（无框架、无构建、无打包）。`index.html` 加载 `src/main.js` 作为 ES module。三个 Tab：导入 / 刷题 / 题库。状态以服务端为权威；前端做乐观更新（切题、答题立即本地生效，后台同步统计字段）。

## STRUCTURE

```
frontend/
├── index.html          # 96 行：三个 panel + 工具栏 + 快捷键 checkbox
└── src/
    ├── main.js         # 654 行：controller —— 所有事件绑定 + 业务函数
    ├── styles.css      # 全部样式（含主题色、动画 keyframes）
    ├── api/client.js   # 33 行：单一 request() + 13 个端点包装
    ├── state/appState.js # 43 行：settings (localStorage) + runtime (内存)
    ├── ui/render.js    # 362 行：renderApp / renderPractice / renderBank
    └── utils/
        ├── format.js   # 22 行：escapeHtml / rate / readFileAsDataUrl
        └── parser.js   # 142 行：parseQuestions —— 粘贴文本的正则式行解析
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改全局状态形状 | `state/appState.js` | `settings` 走 localStorage；`runtime` 是易失状态 |
| 改 API 调用 | `api/client.js` | 13 个方法对应所有后端端点；throw `Error(payload.error)` |
| 改题目渲染 | `ui/render.js:renderChoicePractice` / `renderFillBlankPractice` | 选/填空分支 |
| 改题库管理 | `ui/render.js:renderBank` / `renderQuestionForm` | 列表 + 新建/编辑表单 |
| 改粘贴文本解析 | `utils/parser.js` | 5 个顶部正则：start/option/answer/explanation/noise |
| 改事件绑定 | `main.js:bind()` | 一处集中；不要散落到其他文件 |
| 改键盘快捷键 | `main.js:bindKeyboardShortcuts()` | 全局 keydown + INPUT/TEXTAREA/SELECT 豁免 |
| 改答题判断逻辑 | `main.js:submitAnswer` / `routes.js:handleApi(/api/practice/answer)` | 前端乐观判断；服务端真判断（不要让它们不一致） |
| 改样式主题 | `styles.css` | 主色 `#c05529`（hero `theme-color`） |

## CODE MAP

| Symbol | File:Line | Role |
|--------|-----------|------|
| `runtime` | appState.js:8 | 易失状态：`state` / `selectedAnswers` / `answerFeedback` / `practiceMode` / `questionHistory` |
| `settings` | appState.js:1 | 持久化：4 个 `show*` / `autoNext` / `shuffleOptions` 布尔 |
| `activeCourse()` | appState.js:23 | `runtime.state.courses.find(id === activeCourseId)` |
| `currentQuestion()` | appState.js:27 | 通过 `practice.currentQuestionId` 找题目 |
| `request(path, options)` | api/client.js:1 | 单一 fetch 包装；非 2xx → throw |
| `api.*` | api/client.js:14 | 13 个端点（state / courses.* / questions.* / practice.* / recognize-image） |
| `parseQuestions(text)` | utils/parser.js:9 | 状态机式行扫描；自动判定 choice vs fill-blank |
| `cleanText` / `cleanOption` | utils/parser.js:114,124 | 合并中文拆字空格；修 OCR 错字（`汽车轮取` → `汽车轮胎`） |
| `shuffleArray(arr)` | ui/render.js:5 | Fisher-Yates；用于选项乱序 |
| `animateQuizCard()` | ui/render.js:17 | 移动端 (`innerWidth <= 760`) 跳过动画 |
| `renderApp()` | ui/render.js:26 | 全量渲染（三个 panel 都重画） |
| `updatePracticeOnly()` | ui/render.js:37 | 仅重画答题区；切题/答题时用，省 DOM 操作 |
| `renderBank()` | ui/render.js:235 | 仅在 `bankPanel.active` 时渲染，避免 1900+ 题目无谓重建 |
| `bindKeyboardShortcuts()` | main.js:562 | A/B/C/D 选 / Enter 提交 / ←→ 切题 / Space 下一题 |

## CONVENTIONS

- **零构建**：`index.html` 直接 `<script type="module" src="./src/main.js">`；无 bundler/转译
- **顶层 await**：`main.js:622` 有 `runtime.state = await api.state()`，必须 module 加载（IE 不支持）
- **导入扩展名**：ESM 要求，所有 `import` 显式写 `.js`
- **DOM 选择器**：用文件内 `$ = (s) => document.querySelector(s)`，不引外部库
- **HTML 转义**：所有用户内容经 `escapeHtml`；不要直接 innerHTML 拼字符串（XSS 风险）
- **localStorage key 命名**：`quiz-platform-*` 前缀（避免和别的项目冲突）
- **事件委托**：答题卡片的 `data-bookmark` 用 `quizCard.addEventListener('click', ...)` 统一处理

## ANTI-PATTERNS (THIS PROJECT)

- **不要**用 `document.write` / `eval` / 任何同步阻塞操作
- **不要**在 `renderApp()` 之外直接操作 DOM —— 状态驱动渲染
- **不要**让"乐观更新"与服务端判断逻辑分叉 —— 见 `main.js:submitAnswer` 与 `routes.js:handleApi /api/practice/answer` 必须保持一致
- **不要**把"上一题历史栈"放到 `practice` 子对象 —— 它是 UI-only 状态，应留在 `runtime.questionHistory`
- **不要**用 `addEventListener` 给每个 `<input>` 绑 change —— `renderChoicePractice` 内已经处理
- **不要**改 `settings` 默认值而不更新 `localStorage` 默认 —— 老用户的 `null` 会变 `true`
- **不要**让 `parser.js` 引入第三方 NLP 库 —— 它是纯正则实现，有意保持

## UNIQUE STYLES

- **三 Tab 切换**：`data-tab` 属性 + `.active` class；切到 bankPanel 时强制 `renderApp()` 重建
- **填空题多空**：`question.answer[i]` 与输入框下标一一对应；分隔符 `；;|、` 任意一种
- **错题重做定义**：服务端 `wrongCount > 0 && correctCount === 0` —— 答错过但从未答对过才算
- **乐观更新 + 统计字段同步**：`nextQuestion` / `submitAnswer` 后台 `.then` 只同步 `roundNo` / `answeredInRound` / `correctInRound` / `totalAnswered` / `totalCorrect` / `wrongCount` / `correctCount`，不覆盖 `currentQuestionId` 和 `remainingIds`
- **OCR 容错正则链**：`parser.js:normalize` 做全角→半角 + 修 `PMoO|PmoO|PM0|Pwo` → `PMO` + 修 `汽车轮取` → `汽车轮胎`
- **多答案排序比较**：`[...answer].sort()` 后逐位相等；大小写无关（先 `.toUpperCase()`）
- **多选题自动判断**：`question.answer.length > 1` → checkbox + multi-hint；否则 radio
- **选项乱序触发条件**：仅 `settings.shuffleOptions === true` 时 Fisher-Yates
- **刷题模式持久化**：`runtime.practiceMode` 写 `localStorage["quiz-platform-practice-mode"]`，模式切换立即触发 `resetRound`

## NOTES

- `main.js` 顶层 await 抛错时显示带 stack 的红色错误页（开发体验保留）
- `runtime.state` 启动时调 `api.state()` 同步；之后所有写操作都 `runtime.state = await api.X(...)`
- 上一题/下一题：`prevQuestion` 把当前题 `unshift` 回 `remainingIds`；`nextQuestion` 用 `questionHistory` 记录
- `bankList` 同时绑 `click` 给 `deleteQuestion` 和 `handleBankActions`（事件复用，靠 dataset 区分）
- 移动端 `innerWidth <= 760` 跳过 `fadeSlideUp` 动画以提升性能
- 答题后 `setTimeout(..., 1500)` 触发自动下一题（仅 `settings.autoNext` + 答对时）
