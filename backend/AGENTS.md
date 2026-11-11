# BACKEND KNOWLEDGE BASE

## OVERVIEW

Node.js 18+ ESM 后端，原生 `node:http`（无 Express）。题库数据走 `repository` 抽象（JSON 文件 / PostgreSQL 二选一），AI 图片识别与学习笔记生成走 `services/`。

## STRUCTURE

```
backend/src/
├── server.js              # 29 行：DI 容器，创建 repository + aiService + router
├── config.js              # 36 行：.env 加载、路径常量（rootDir/dataFile/frontendDir）、MIMO_* 与超时
├── utils.js               # 227 行：规范化/校验/答案判定/复习进度/JSON 响应与 gzip/readBody
├── routes.js              # 572 行：16 个 API 端点 + 静态资源服务（ETag/304/gzip）
├── repositories/
│   ├── JsonQuizRepository.js      # 文件存储 + mtime 缓存 + 更新队列 + 原子写入 + 备份
│   ├── JsonQuizRepository.test.js # 并发/损坏文件/缓存/备份测试
│   └── SqlQuizRepository.js       # PostgreSQL JSONB 单行存储 + 事务更新
├── services/
│   ├── AiRecognitionService.js    # Mimo (Xiaomi) chat/completions，默认 120 秒超时
│   └── StudyNoteGenerator.js      # 生成解析与速记文本
├── parity.test.js         # 前后端判定逻辑一致性测试
├── routes.test.js         # 路由集成测试（内存仓库 + 真实 HTTP）
└── scripts/               # 见 ./scripts/AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 加 HTTP 端点 | `routes.js` 顶部 `handleApi` | 在 `serveStatic` 之前插入 if 链；POST 必须先 `parseBody(await readBody(req))` |
| 改题目校验规则 | `utils.js:validateQuestion` | 拒绝空 stem / <2 选项 / 答案不在 options 中 |
| 改答案判定 | `utils.js:areChoiceAnswerSetsEqual` / `areFillBlankAnswersCorrect` | 前端对应实现见 `frontend/src/utils/answers.js`；改动后跑 `parity.test.js` |
| 改题目去重逻辑 | `routes.js:buildImportResult` | 三个 Set：`seenIds` / `seen(fingerprint)` / `seenStems` |
| 改 JSON 存储 | `repositories/JsonQuizRepository.js` | `update` 串行执行；`_writeState` 写临时文件后 rename；备份只在内容变化时生成 |
| 改 SQL 存储 | `repositories/SqlQuizRepository.js` | 单行 JSONB；`update` 用事务 + `SELECT ... FOR UPDATE` |
| 改 AI prompt/超时 | `services/AiRecognitionService.js:prompt()` + `config.js:mimoTimeoutMs` | 强制纯 JSON 输出，max_completion_tokens=4096 |
| 改学习笔记生成 | `services/StudyNoteGenerator.js` | `buildStudyNotes` 生成、`applyStudyNotesToState` 批量写入 |
| 改端口/环境变量 | `config.js` | 全部走 `config.*`，不要在路由里 `process.env` |

## CODE MAP

| Symbol | File:Line | Role |
|--------|-----------|------|
| `createRouter({repository, aiService})` | routes.js:28 | 路由工厂；顶层 try/catch 把异常转成 JSON 响应 |
| `handleApi(req, res, url, repository, aiService)` | routes.js:45 | 单一 if 链集中所有 API（16 个端点） |
| `serveStatic(req, res, url)` | routes.js:262 | 非法 URL → 400、路径穿越 → 403、静态缺失 → 404、ETag 命中 → 304 |
| `parseBody(raw)` | routes.js:304 | 空 body 返回 `{}`；JSON 解析失败抛 400 |
| `buildImportResult(rawQuestions, existing)` | routes.js:493 | 3 重去重 + 失败原因（空 stem / 选项不足 / 答案无效 / 重复） |
| `questionFingerprint(question)` | routes.js:536 | `choice\|stem\|key:text\|...\|answer` 串联 |
| `shuffle(items)` | routes.js:565 | Fisher-Yates；用于 `remainingIds` |
| `httpError(status, message)` | utils.js:11 | 带 `statusCode` 的错误，由 handleApi 映射为响应状态码 |
| `sendJson` / `sendBody` | utils.js:17,23 | 响应发送；≥1 KB 且 `Accept-Encoding` 含 gzip 时压缩 |
| `readBody(req, maxBytes)` | utils.js:41 | 默认 20 MB 上限；超限抛 413，不销毁连接 |
| `areFillBlankAnswersCorrect(question, selected)` | utils.js:158 | 逐空匹配，每空任一可接受答案即算对 |
| `JsonQuizRepository.getState` | JsonQuizRepository.js:52 | mtime + size 命中缓存直接复制；ENOENT 建空库；解析失败抛出 |
| `JsonQuizRepository.update` | JsonQuizRepository.js:87 | Promise 队列串行执行 读取 → 修改 → 保存 |
| `JsonQuizRepository._writeState` | JsonQuizRepository.js:185 | 临时文件 + rename 原子替换，写后刷新缓存 |
| `JsonQuizRepository.backupExistingFile` | JsonQuizRepository.js:196 | 内容变化前备份到 `data/backups/quiz-data.<ts>.json` |
| `JsonQuizRepository.pruneBackups` | JsonQuizRepository.js:214 | 按 mtime 倒序，保留 80 份（`this.backupLimit`） |
| `SqlQuizRepository._ensureTable` | SqlQuizRepository.js:23 | DDL 幂等；插入初始空 row（id=1） |
| `SqlQuizRepository.update` | SqlQuizRepository.js:59 | 事务 + `SELECT ... FOR UPDATE`；提交后返回规范化状态 |
| `AiRecognitionService.recognizeImage` | AiRecognitionService.js:6 | 校验 data URL → POST（含超时）→ extractJson → 兼容数组/对象/data |
| `buildStudyNotes(question, courseName)` | StudyNoteGenerator.js:8 | 按题型生成解析与速记 |
| `applyStudyNotesToState(state, opts)` | StudyNoteGenerator.js:41 | 批量写入 explanation / memoryTip，返回统计 |

## CONVENTIONS

- **零依赖**：`package.json` 只有 `pg`；不要加新依赖除非必要
- **依赖注入**：`server.js` 显式 new 出来传给 `createRouter`，不要模块顶层 `new` + 单例
- **错误处理**：预期内的失败用 `httpError(状态码, 消息)`；其余异常由 handleApi 兜底 500
- **MIME**：`routes.js:21-26` 4 种扩展名；其他走 `application/octet-stream`
- **路径常量**：用 `config.js` 的 `rootDir` / `dataFile` / `frontendDir`，不要 `__dirname` 拼字符串
- **BOM 处理**：`JsonQuizRepository.getState` 用 `.replace(/^\uFEFF/, "")` 兜底，迁移旧 Windows 导出文件必备
- **写状态**：状态变更统一走 `repository.update(mutator, { skipBackup })`，不要在路由里直接 `saveState`

## ANTI-PATTERNS (THIS PROJECT)

- **不要**绕过 `repository` 直接读写 `data/quiz-data.json` —— 会绕过备份与缓存
- **不要**在 `routes.js` 里 `require('dotenv')` 或 `process.env.X` —— 走 `config.js`
- **不要**给 SQL 仓库加多表 schema —— 当前用单行 JSONB 是设计选择，迁移成本最低
- **不要**让 AI prompt 输出 Markdown —— prompt 明确禁止；模型不听话时 `extractJson` 兜底
- **不要**改 `JsonQuizRepository.backupLimit` 默认值 80
- **不要**在 `handleApi` 之外的地方定义 API 逻辑 —— 整个项目是"单文件路由"风格
- **不要**让 `getState` 吞掉 JSON 解析错误 —— 损坏文件必须抛出，原文件保持原样
- **不要**用 `fs.writeFile` 直接覆盖主数据文件 —— 必须走 `_writeState` 的临时文件替换

## UNIQUE STYLES

- **API 风格**：所有写操作都是 `POST + JSON body`，包括删除（`/api/courses/delete` 而非 DELETE）
- **响应压缩**：`sendJson` / `sendBody` 自动 gzip；小于 1 KB 不压缩
- **静态缓存**：ETag 由 size + mtime 生成，`Cache-Control: no-cache` 强制每次校验
- **状态机**：`practice` 子对象含 `mode` / `count` / `remainingIds` / `currentQuestionId` / `lastAnswer` / `roundNo` / 统计字段 / `exam`
- **错题定义**：`wrongCount > 0`（题库“只看错题”和“错题重做”保持同一口径）
- **考试模式**：`exam` 与 `exam-wrong` 两种 mode；`practice.exam` 保存题号、作答记录、上次错题与总结
- **备份节流**：练习流程端点传 `skipBackup: true`；只有题库内容变化才写备份
- **前端一致性**：判定逻辑改动必须让 `parity.test.js` 继续通过

## NOTES

- `/api/recognize-image` 直接调 aiService，无 repository 参与（题目入库走 `/api/questions`）
- JSON 仓库是单进程串行模型；多进程同时写同一文件仍会互相覆盖（脚本运行时不要开服务）
- SQL 仓库通过事务在数据库层面串行，支持多实例部署
- AI 超时或上游报错会以 JSON `{error}` 返回 500，前端提示条显示
- 请求体错误：JSON 解析失败 400，超过 20 MB 413
- 测试：`npm test`；仓库层测试在 `.test-tmp/` 建真实文件，用例结束后清理
