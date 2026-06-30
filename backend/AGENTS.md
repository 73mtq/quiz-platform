# BACKEND KNOWLEDGE BASE

## OVERVIEW

Node.js 18+ ESM 后端，原生 `node:http`（无 Express）。题库数据走 `repository` 抽象（JSON 文件 / PostgreSQL 二选一），AI 图片识别走 `AiRecognitionService` 注入。

## STRUCTURE

```
backend/src/
├── server.js              # 29 行：DI 容器，创建 repository + aiService + router
├── config.js              # 35 行：dotenv 加载、路径常量（rootDir/dataFile/frontendDir）、port 解析
├── utils.js               # 70 行：createId / normalizeQuestion / validateQuestion / readBody / sendJson
├── routes.js              # 384 行：所有 HTTP 路由 + 静态资源服务
├── repositories/
│   ├── JsonQuizRepository.js   # 文件存储 + 自动备份
│   └── SqlQuizRepository.js    # PostgreSQL JSONB 单行存储
├── services/
│   └── AiRecognitionService.js # Mimo (Xiaomi) chat/completions
└── scripts/               # 见 ./scripts/AGENTS.md（独立 CLI 工具）
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 加 HTTP 端点 | `routes.js` 顶部 `handleApi` | 在 `serveStatic` 之前插入 if 链；POST 必须先 `parseBody(await readBody(req))` |
| 改题目校验规则 | `utils.js:validateQuestion` | 拒绝空 stem / <2 选项 / 答案不在 options 中 |
| 改题目去重逻辑 | `routes.js:buildImportResult` | 三个 Set：`seenIds` / `seen(fingerprint)` / `seenStems` |
| 改 JSON 存储 | `repositories/JsonQuizRepository.js` | 备份写在 `data/backups/`，最多 80 份 |
| 改 SQL 存储 | `repositories/SqlQuizRepository.js` | 单行 JSONB，无迁移；`max: 5` 连接池 |
| 改 AI prompt | `services/AiRecognitionService.js:prompt()` | 强制纯 JSON 输出，max_completion_tokens=4096 |
| 改端口/环境变量 | `config.js` | 全部走 `config.*`，不要在路由里 `process.env` |

## CODE MAP

| Symbol | File:Line | Role |
|--------|-----------|------|
| `createRouter({repository, aiService})` | routes.js:13 | 路由工厂；`/api/*` → handleApi，其他 → serveStatic |
| `handleApi(req, res, url, repository, aiService)` | routes.js:26 | 单一 if 链集中所有 API（约 17 个端点） |
| `serveStatic(url, res)` | routes.js:281 | 路径穿越防护 (`relative.startsWith('..')` → 403) |
| `buildImportResult(rawQuestions, existing)` | routes.js:305 | 3 重去重 + 失败原因（空 stem / 选项不足 / 答案无效 / 重复） |
| `questionFingerprint(question)` | routes.js:348 | `choice\|stem\|key:text\|...\|answer` 串联 hash |
| `normalizeFingerprintText(value)` | routes.js:369 | 去空白 + 移除 `。．.` + lowercase |
| `shuffle(items)` | routes.js:377 | Fisher-Yates；用于 `remainingIds` |
| `JsonQuizRepository.normalizeState` | JsonQuizRepository.js:64 | 兜底：空 courses → `[默认课程]`；自动迁移 `bank` → `questions` |
| `JsonQuizRepository.backupExistingFile` | JsonQuizRepository.js:151 | 内容变更前自动备份到 `data/backups/quiz-data.<ts>.json` |
| `JsonQuizRepository.pruneBackups` | JsonQuizRepository.js:169 | 按 mtime 倒序，保留 80 份（`this.backupLimit`） |
| `SqlQuizRepository._ensureTable` | SqlQuizRepository.js:23 | DDL 幂等；插入初始空 row（id=1） |
| `AiRecognitionService.recognizeImage` | AiRecognitionService.js:6 | 校验 data URL 前缀 → POST → extractJson → 兼容数组/对象/data 字段 |
| `extractJson(text)` | AiRecognitionService.js:67 | 先剥 ``` ``` 围栏；失败则取首个 `{` 到末尾 `}` |

## CONVENTIONS

- **零依赖**：`package.json` 只有 `pg`；不要加新依赖除非必要
- **依赖注入**：`server.js` 显式 new 出来传给 `createRouter`，不要模块顶层 `new` + 单例
- **错误处理**：路由 try/catch 兜底返回 500 `{error: msg}`；业务层不写 try/catch，让上层处理
- **MIME**：`routes.js:6-11` 4 种扩展名；其他走 `application/octet-stream`
- **路径常量**：用 `config.js` 的 `rootDir` / `dataFile` / `frontendDir`，不要 `__dirname` 拼字符串
- **BOM 处理**：`JsonQuizRepository.getState` 用 `.replace(/^\uFEFF/, "")` 兜底，迁移旧 Windows 导出文件必备

## ANTI-PATTERNS (THIS PROJECT)

- **不要**绕过 `repository` 直接读写 `data/quiz-data.json` —— 会绕过自动备份
- **不要**在 `routes.js` 里 `require('dotenv')` 或 `process.env.X` —— 走 `config.js`
- **不要**给 SQL 仓库加多表 schema —— 当前用单行 JSONB 是设计选择，迁移成本最低
- **不要**让 AI prompt 输出 Markdown —— prompt 明确禁止；模型不听话时 `extractJson` 有 fallback
- **不要**改 `JsonQuizRepository.backupLimit` 默认值 80 —— 用户 git 占用依赖此默认
- **不要**在 `handleApi` 之外的地方定义 API 逻辑 —— 整个项目是"单文件路由"风格

## UNIQUE STYLES

- **API 风格**：所有写操作都是 `POST + JSON body`，包括删除（`/api/courses/delete` 而非 DELETE）
- **路径安全**：`serveStatic` 用 `path.relative` 校验 `..` 穿越
- **状态机**：`practice` 子对象含 `mode` / `count` / `remainingIds` / `currentQuestionId` / `lastAnswer` / `roundNo` / 各种统计字段
- **错题定义**：`wrongCount > 0 && correctCount === 0`（"错过但从未答对过"才算错题重做候选）
- **JSONB 单行**：SQL 仓库整 state 存一个 row，无 schema 演化问题

## NOTES

- `routes.js:269` `/api/recognize-image` 直接调 aiService，无 repository 参与（题目入库走 `/api/questions`）
- `JsonQuizRepository` 是同步 read+write，无文件锁；多进程并发写会丢数据
- `SqlQuizRepository.update` 是 read-modify-write，不是真正的 SQL 事务；并发写有覆盖风险（接受的范围）
- AI 错误抛出后会由 `routes.js:276` catch 返回 500，前端在 `recognizeImage()` 中显示
- 备份目录在 README 中提示可能膨胀，但未在 `.gitignore` 中显式排除
