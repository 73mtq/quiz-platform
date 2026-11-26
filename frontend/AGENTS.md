# FRONTEND KNOWLEDGE BASE

## OVERVIEW

单页应用（SPA），原生 JavaScript（无框架、无构建、无打包）。`index.html` 加载 `src/main.js` 作为 ES module。四个 Tab：导入 / 刷题 / 复习 / 题库。状态以服务端为权威；前端做乐观更新（切题、答题立即本地生效，后台同步统计字段）。首屏通过 `/api/bootstrap` 只加载当前课程，切换课程时按需加载目标课程。

## STRUCTURE

```
frontend/
├── index.html          # 四个 panel + 工具栏 + 加载/同步提示 + modulepreload
├── src/
    ├── main.js         # controller：启动、事件绑定、业务、练习队列、提示
    ├── styles.css      # 全部样式（主题变量、动画、提示条、加载状态）
    ├── api/client.js   # request() + 超时/重试 + 端点包装
    ├── state/
    │   ├── appState.js       # settings (localStorage) + runtime (内存)
    │   └── practiceState.js  # 完整/紧凑状态 hydrate 与练习补丁合并
    ├── ui/
    │   ├── render.js         # renderApp / renderPractice / renderReview / renderBank
    │   └── optionOrder.js    # 选项顺序缓存
    ├── data/
    │   └── reviewTaxonomy.js # 复习分析的领域关键词与题型规则
    └── utils/
        ├── answers.js      # 选项文本解析与选择/填空判定
        ├── format.js       # escapeHtml / rate / readFileAsDataUrl
        ├── parser.js       # parseQuestions —— 粘贴文本的正则式行解析
        ├── practiceFlow.js # 轮次进度、roundTotal、answeredIds
        └── review.js       # 复习分析与复习进度更新
└── test/
    ├── review.test.js
    ├── practice-state.test.js
    ├── practice-flow.test.js
    └── option-order.test.js
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改全局状态形状 | `state/appState.js` | `settings` 走 localStorage；`runtime` 是易失状态 |
| 改状态合并 | `state/practiceState.js` | 完整/紧凑状态 hydrate；练习补丁；解析合并 |
| 改 API 调用 | `api/client.js` | 统一超时与重试；练习请求带 `courseId` 与 `operationId` |
| 改题目渲染 | `ui/render.js:renderChoicePractice` / `renderFillBlankPractice` | 选/填空分支；已作答题目禁用 |
| 改选项顺序 | `ui/optionOrder.js` | 按题目 ID 缓存；设置切换时清空 |
| 改题库管理 | `ui/render.js:renderBank` / `renderQuestionForm` | 列表 + 新建/编辑表单 |
| 改粘贴文本解析 | `utils/parser.js` | 5 个顶部正则：start/option/answer/explanation/noise |
| 改事件绑定 | `main.js:bind()` | 一处集中 |
| 改键盘快捷键 | `main.js:bindKeyboardShortcuts()` | 只在刷题面板生效；INPUT/TEXTAREA/SELECT/BUTTON 豁免 |
| 改答题判定 | `utils/answers.js` / `routes.js` | 两端必须一致；`backend/test/parity.test.js` 会检查 |
| 改复习进度更新 | `utils/review.js:applyQuestionReview` | 与后端 `utils.js:updateQuestionReview` 对应 |
| 改失败提示 | `main.js:showToast` / `main.js:request` | 所有 `api.*` 调用都应经 `request()` |
| 改样式主题 | `styles.css` | 主色 `#b85c2a`（hero `theme-color` 为 `#c05529`） |

## CODE MAP

| Symbol | Role |
|--------|------|
| `runtime` | 易失状态：`state` / `revision` / `pendingCourseId` / `explanationsLoaded` / 选中答案 / 答题反馈 |
| `settings` | 持久化：`showAnswer` / `showExplanation` / `autoNext` / `shuffleOptions` |
| `hydrateStatePayload(payload)` | 处理 `/api/bootstrap` 紧凑状态与完整状态 |
| `applyPracticeStats(state, payload)` | 合并统计、roundTotal、answeredIds、historyIds、exam；不覆盖本地当前题 |
| `applyPracticePayload(state, payload)` | 整体替换当前课程 practice；下一题取新题、重置、结束模拟 |
| `applyCoursePayload(state, payload)` | 切换课程；旧课程只保留 `questionCount` |
| `applyExplanations(state, payload)` | 题库页按需合并解析与速记 |
| `activeCourse()` | `runtime.state.courses.find(id === activeCourseId)` |
| `currentQuestion()` | 通过 `practice.currentQuestionId` 找题目 |
| `request(path, options)` | fetch 包装；AbortController 超时；5xx/网络错误最多重试 |
| `api.bootstrap()` | 首屏；90 秒超时，覆盖 Render 冷启动 |
| `api.explanations(courseId)` | 题库页按需解析 |
| `enqueuePracticeSync(task)` | 练习请求串行化；保证答题、切题、重置按顺序到达服务端 |
| `registerPracticeFailure(label, task, apply)` | 记录失败任务并显示可重试提示条 |
| `showAppStatus()` / `hideAppStatus()` | 启动加载、课程加载、错误与重试 |
| `boot()` | 首屏启动；成功后绑定事件、恢复反馈、渲染 |
| `stageLocalPracticeRound()` | 模式切换时本地重置轮次 |
| `nextQuestion()` / `prevQuestion()` | 服务端 history 驱动；答题请求快照 |
| `submitAnswer()` | 乐观判定 + 快照 selectedAnswers + 后台同步 |
| `bindKeyboardShortcuts()` | A–H 选选项 / Enter 提交 / ←→ 切题 / Space 下一题；只在刷题面板 |
| `parseQuestions(text)` | 行式扫描；自动判定 choice vs fill-blank |
| `getChoiceAnswerTexts` / `isChoiceAnswerCorrect` / `isFillBlankAnswerCorrect` | 选项与答案判定 |
| `applyQuestionReview` | 更新连对次数与已掌握标记 |
| `analyzeReview(course)` | 生成复习面板的错题统计、类型、板块与优先列表 |
| `createOptionOrderCache` | 同一题多次渲染保持选项顺序 |
| `renderApp()` | 全量渲染（当前可见面板 + 课程工具栏） |
| `updatePracticeOnly()` | 仅重画答题区 |
| `updateBankListOnly()` | 仅重画题库列表 |
| `renderBank()` | 仅在 `bankPanel.active` 时渲染 |

## CONVENTIONS

- **零构建**：`index.html` 直接加载 `src/main.js`；无 bundler/转译
- **启动**：`main.js` 调用 `boot()`；首屏失败显示重试按钮与静态题库入口
- **导入扩展名**：ESM 要求，所有 `import` 显式写 `.js`
- **DOM 选择器**：文件内 `$ = (s) => document.querySelector(s)`
- **HTML 转义**：所有用户内容经 `escapeHtml`
- **localStorage key 命名**：`quiz-platform-*` 前缀
- **失败提示**：新 `api.*` 调用要用 `request(action, failureMessage)`
- **请求快照**：练习任务入队前保存 `courseId`、`questionId`、`selectedAnswers`、mode/count 等，不在任务执行时读取会被清空的 runtime
- **版本号**：写响应带 `revision`；小于当前值的响应直接忽略
- **课程定位**：练习与收藏请求带 `courseId`；切换课程期间 `pendingCourseId` 阻止答题

## ANTI-PATTERNS (THIS PROJECT)

- **不要**用 `document.write` / `eval` / 同步阻塞操作
- **不要**在 `renderApp()` 之外随意操作 DOM —— 优先走渲染函数
- **不要**让"乐观更新"与服务端判断逻辑分叉 —— 判定函数改动后跑 `parity.test.js`
- **不要**把上一题逻辑只放在 `runtime.questionHistory` —— 服务端 `practice.historyIds` 是权威，前端只做镜像
- **不要**在练习请求里直接读取 `runtime.selectedAnswers` / `runtime.practiceMode` —— 入队前保存快照
- **不要**在题库页或复习页响应刷题快捷键
- **不要**每次渲染重新打乱选项 —— 使用 `optionOrder.js`
- **不要**在 `renderApp()` 中渲染非当前课程的全部题目
- **不要**改 `settings` 默认值而不更新 localStorage 默认
- **不要**在 `reviewTaxonomy.js` 里写逻辑

## UNIQUE STYLES

- **四 Tab 切换**：`data-tab` + `.active`；题库/复习面板在切换时渲染
- **首屏紧凑状态**：`courses` 只有元数据与 `questionCount`；当前课程含 practice 与 questions
- **解析延迟加载**：首屏只为当前题与 lastAnswer 题保留 explanation / memoryTip；题库页打开时请求 `/api/explanations`
- **切换课程**：保留旧课程显示，`pendingCourseId` 期间禁用答题；成功后旧课程只留题数
- **填空题多空**：`question.answer[i]` 与输入框下标一一对应；分隔符 `；;|、`
- **错题重做**：服务端 `wrongCount > 0`
- **乐观更新 + 统计字段同步**：切题/答题后台只合并统计字段；重置与结束模拟整体替换 practice
- **请求串行化**：练习请求经 `enqueuePracticeSync`；失败任务进入提示条，使用同一 `operationId` 重试
- **选项乱序**：同一题保持顺序；切换设置或题目内容变化时清空缓存
- **考试模式**：`exam` 与 `exam-wrong`；倒计时由 `setupExamTimer` 维护；自动结束失败后停止每秒重试

## NOTES

- `main.js` 首屏失败不再替换整个页面；显示 `#appStatus` 与重试按钮
- `runtime.state` 启动时由 `api.bootstrap()` 填充；写操作后按响应 hydrate
- 练习请求带 `operationId`，服务端用 `recentOperationIds` 去重；网络重试安全
- `bankList` 同时绑 `click` 给 `deleteQuestion` 与 `handleBankActions`，靠 dataset 区分
- 移动端 `innerWidth <= 760` 跳过 `fadeSlideUp` 动画
- 答题后 `setTimeout(..., 200)` 触发自动下一题（仅 autoNext + 答对 + 本轮还有剩余题）
