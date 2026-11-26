# BACKEND KNOWLEDGE BASE

## OVERVIEW

Node.js 18+ ESM 后端，原生 `node:http`（无 Express）。题库数据走 `repository` 抽象（JSON 文件 / PostgreSQL 二选一），AI 图片识别与学习笔记生成走 `services/`。首屏通过 `/api/bootstrap` 只返回当前课程；PostgreSQL 把课程正文、练习状态、题目统计分成三列。

## STRUCTURE

```
backend/src/
├── server.js              # DI 容器，创建 repository + aiService + router
├── config.js              # .env 加载、路径常量、MIMO_* 与超时
├── utils.js               # 规范化/校验/答案判定/复习进度/JSON 响应与 gzip/readBody
├── routes.js              # API 端点 + 静态资源服务（ETag/304/gzip/内存缓存）
├── repositories/
│   ├── StateShape.js      # 状态形状：normalize/split/merge/bootstrap 负载
│   ├── JsonQuizRepository.js  # 文件存储 + mtime 缓存 + 更新队列 + 原子写入 + 备份
│   └── SqlQuizRepository.js   # PostgreSQL 单行三列 + revision 缓存 + 高频写入
├── services/
│   ├── AiRecognitionService.js # Mimo chat/completions，默认 120 秒超时
│   ├── QuizDataRestore.js      # 从 quiz_data_backups 恢复旧版整行
│   └── StudyNoteGenerator.js   # 生成解析与速记文本
└── scripts/               # 见 ./scripts/AGENTS.md

backend/test/              # node --test 自动发现
├── parity.test.js         # 前后端判定逻辑一致性
├── routes.test.js         # 路由集成测试（内存仓库 + 真实 HTTP）
├── state-shape.test.js    # split/merge/compact 负载
└── repositories/
    ├── JsonQuizRepository.test.js
    └── SqlQuizRepository.integration.test.js
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 加 HTTP 端点 | `routes.js` 的 `handleApi` | 练习写入走 `updatePractice` / `updateAnswer`；题库内容走 `update` |
| 改首屏负载 | `StateShape.compactStatePayload` | 只包含当前课程；非当前课程只返回元数据；解析默认延迟加载 |
| 改答案判定 | `utils.js:areChoiceAnswerSetsEqual` / `areFillBlankAnswersCorrect` | 前端对应实现见 `frontend/src/utils/answers.js`；改动后跑 `parity.test.js` |
| 改题目去重 | `routes.js:buildImportResult` | 三个 Set：`seenIds` / `seen(fingerprint)` / `seenStems` |
| 改 JSON 存储 | `JsonQuizRepository.js` | `readState` 返回只读缓存；`getState` 返回副本；`update` 串行 |
| 改 SQL 存储 | `SqlQuizRepository.js` | `data` / `practice` / `stats` 三列；`revision` 做缓存失效 |
| 改迁移 | `SqlQuizRepository._migrateLayout` | 事务、备份表、split/merge 逐字段比较 |
| 恢复旧版数据 | `scripts/migrate/restore-quiz-data.js` | `npm run restore:db`，需要 `DATABASE_URL` |
| 改 AI prompt/超时 | `AiRecognitionService.js:prompt()` + `config.js:mimoTimeoutMs` | 强制纯 JSON 输出，max_completion_tokens=4096 |
| 改学习笔记 | `StudyNoteGenerator.js` | `buildStudyNotes` 生成、`applyStudyNotesToState` 批量写入 |
| 改端口/环境变量 | `config.js` | 全部走 `config.*`，不要在路由里 `process.env` |

## CODE MAP

| Symbol | Role |
|--------|------|
| `createRouter({repository, aiService})` | 路由工厂；顶层 try/catch 转 JSON 响应 |
| `handleApi` | 单一 if 链；`/api/bootstrap`、`/api/state`、`/api/explanations`、课程与题目、练习流程 |
| `serveStatic` | 路径穿越防护、ETag/304、gzip、按 mtime 与 size 失效的静态缓存 |
| `compactStatePayload(state, revision)` | 首屏负载：当前课程题目与 practice，其他课程只留元数据 |
| `splitState(state)` / `mergeState(data, practice, stats)` | 完整状态与三列布局互转；写入与迁移共用 |
| `normalizePractice` | 补齐 roundTotal、answeredIds、historyIds、recentOperationIds；旧轮次从 lastAnswer / exam.answers 推导已答题目 |
| `JsonQuizRepository.readState` | 只读缓存引用；调用方不得修改 |
| `JsonQuizRepository.updatePractice` / `updateAnswer` | 本地文件模式仍整文件写入，接口与 SQL 仓库一致 |
| `SqlQuizRepository.readState` | 先查 revision；命中缓存直接返回，未命中读取三列并合并 |
| `SqlQuizRepository.updatePractice` | 只写 practice；下一题、上一题、重置、切换课程 |
| `SqlQuizRepository.updateAnswer` | 事务内写 practice 与一个 stats 条目；答题与收藏 |
| `SqlQuizRepository.setActiveCourse` | 只写 practice 中的 activeCourseId，返回目标课程 |
| `SqlQuizRepository._migrateLayout` | 旧单列 data 自动迁移，备份到 quiz_data_backups，失败回滚 |
| `restoreSnapshot(pool)` | 恢复迁移快照，practice 与 stats 置空，schema_version 回到 1 |
| `buildStudyNotes` / `applyStudyNotesToState` | 解析与速记生成 |
| `sendJson` / `sendBody` | 响应发送；≥1 KB 且客户端支持 gzip 时压缩 |
| `readBody(req, maxBytes)` | 默认 20 MB 上限；超限抛 413 |

## CONVENTIONS

- **零依赖**：`package.json` 只有 `pg`；不要加新依赖除非必要
- **依赖注入**：`server.js` 显式创建 repository 与 aiService
- **错误处理**：预期内的失败用 `httpError(状态码, 消息)`；其余异常由 handleApi 兜底 500
- **路径常量**：用 `config.js` 的 `rootDir` / `dataFile` / `frontendDir`
- **BOM 处理**：`JsonQuizRepository` 用 `.replace(/^\uFEFF/, "")` 兜底
- **读写分离**：路由使用 `repository.readState()` 读取；修改统一走 `update` / `updatePractice` / `updateAnswer`
- **课程定位**：练习与收藏请求带 `courseId`；不带时回退到当前课程，兼容旧客户端
- **重试去重**：练习请求可带 `operationId`；仓库在 `practice.recentOperationIds` 中保存最近 50 个
- **版本号**：所有前端使用的写响应带 `revision`；前端忽略较旧的响应

## ANTI-PATTERNS (THIS PROJECT)

- **不要**修改 `readState` 返回的对象 —— 缓存会被直接污染
- **不要**用 `update` 处理练习流程 —— 会把整份题库内容重新写回
- **不要**在练习端点重新返回完整 `state` —— 使用 `{ revision, courseId, practice }`
- **不要**绕过 `repository` 直接读写 `data/quiz-data.json`
- **不要**在 `routes.js` 里读 `process.env`
- **不要**给运行时数据加多张业务表 —— 仍是一行三列；`quiz_data_backups` 只存迁移快照
- **不要**让 `getState` 吞掉 JSON 解析错误
- **不要**用 `fs.writeFile` 直接覆盖主数据文件
- **不要**删除 `/api/state` —— 脚本、导出与迁移仍依赖完整状态
- **不要**在 `compactStatePayload` 中返回非当前课程的题目 —— 首屏体积会重新变大

## UNIQUE STYLES

- **首屏按课程加载**：`/api/bootstrap` 返回 `revision`、课程元数据、当前课程；切换课程时 `/api/courses/active` 返回目标课程
- **解析延迟加载**：`/api/bootstrap` 只为当前题与 `lastAnswer` 题保留 explanation / memoryTip；题库页打开时调用 `/api/explanations`
- **紧凑补丁响应**：练习端点返回 `{ revision, courseId, practice }`；答题额外带 `answerResult` 与 `question`
- **练习状态字段**：`roundTotal`、`answeredIds`、`historyIds`、`recentOperationIds`；`next` 写 history，`prev` 从 history 弹出
- **答题规则**：只接受当前题或本轮历史中尚未计分的题；同一轮同一题只计一次
- **写入粒度**：答题写 practice 与一个 stats 条目；下一题、上一题、重置、切换课程只写 practice
- **状态机**：`practice` 含 `mode` / `count` / `remainingIds` / `currentQuestionId` / `lastAnswer` / `roundNo` / 统计 / `exam`
- **错题定义**：`wrongCount > 0`；连续答对 2 次标记已掌握
- **考试模式**：`exam` 与 `exam-wrong`；`practice.exam` 保存题号、作答记录、上次错题与总结
- **静态缓存**：ETag 由 size + mtime 生成；内存缓存只复用内容与 gzip，仍保留 `no-cache` 校验
- **前端一致性**：判定逻辑改动必须让 `parity.test.js` 继续通过

## NOTES

- `/api/recognize-image` 直接调 aiService，无 repository 参与
- JSON 仓库是单进程串行模型；SQL 仓库通过事务串行，支持多实例读取
- 旧版单列 `data` 在首次读取时自动迁移；迁移失败会回滚并抛出错误
- `quiz_data_backups` 保存最近一次迁移前的整行；恢复命令 `npm run restore:db`
- 请求体错误：JSON 解析失败 400，超过 20 MB 413
- 测试：`npm test`；SQL 集成测试 `TEST_DATABASE_URL=... npm run test:sql`
- 性能验收：`/api/bootstrap` 的 gzip 体积明显小于 `/api/state`；练习更新只写小列
