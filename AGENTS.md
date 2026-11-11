# PROJECT KNOWLEDGE BASE

**Updated:** 2026-09-19
**Branch:** master

## OVERVIEW

模块化题库与随机刷题平台。Node.js 18+ ESM 后端（无框架，原生 `node:http`）+ 原生 JS 前端（无构建步骤），题库可存为本地 JSON 或 PostgreSQL。

## STRUCTURE

```
quiz-platform/
├── backend/src/                # 后端：server + routes + repositories + services + scripts
│   ├── routes.js               # 全部 HTTP 端点 + 静态资源服务（ETag/304/gzip）
│   ├── utils.js                # 题目规范化、答案判定、复习进度、JSON 响应
│   ├── repositories/           # JSON 文件 / PostgreSQL 双实现
│   ├── services/               # AI 识别、学习笔记生成
│   └── scripts/                # 按用途分组的 CLI 工具 + check-syntax.js（见 scripts/AGENTS.md）
├── frontend/
│   ├── index.html              # 四个 Tab：导入 / 刷题 / 复习 / 题库
│   └── src/                    # main.js + api/ + state/ + ui/ + utils/ + data/ + styles.css
├── data/                       # 题库运行时数据（quiz-data.json + 自动备份）
├── backend/test/ + frontend/test/ # 单元/集成测试（node --test）
├── docs/MIGRATION.md           # 迁移 / 导入 / 离线产物操作说明
├── docs/DEPLOYMENT.md          # 部署 / 发布 / 数据变更 / 排障手册
├── dist/                       # 离线 HTML 产物（gitignore）
├── .test-tmp/                  # 测试临时目录（gitignore）
├── package.json                # 8 个 npm 脚本；ESM；Node 18+
├── render.yaml                 # Render 部署配置
└── .env                        # 运行时环境变量（DATABASE_URL、MIMO_*）
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改 HTTP 路由/接口 | `backend/src/routes.js` | 572 行，单文件集中式路由（无 Express） |
| 改数据存储/数据模型 | `backend/src/repositories/JsonQuizRepository.js` 或 `SqlQuizRepository.js` | 两个实现都提供 `getState` / `update` / `saveState` |
| 改题目规范化/校验/答案判定 | `backend/src/utils.js` | `normalizeQuestion`, `validateQuestion`, `areChoiceAnswerSetsEqual`, `areFillBlankAnswersCorrect` |
| 改 AI 图片识别 | `backend/src/services/AiRecognitionService.js` | Mimo (Xiaomi) API，默认 120 秒超时 |
| 生成学习笔记/解析 | `backend/src/services/StudyNoteGenerator.js` | `buildStudyNotes`, `applyStudyNotesToState` |
| 改前端入口/交互 | `frontend/src/main.js` | 996 行，事件绑定 + 业务 + 统一失败提示 |
| 改 UI 渲染/动画 | `frontend/src/ui/render.js` | 全部 DOM 渲染逻辑 |
| 改题目解析（粘贴文本） | `frontend/src/utils/parser.js` | 正则式行解析，区分选择/填空 |
| 改刷题进度计算 | `frontend/src/utils/practiceFlow.js` | 轮次总数/剩余数/完成判定/自动下一题 |
| 改复习分析 | `frontend/src/utils/review.js` + `frontend/src/data/reviewTaxonomy.js` | 领域关键词与题型规则在 data 文件 |
| 改 API 客户端 | `frontend/src/api/client.js` | 单一 `request()` 函数，14 个端点 |
| 加/迁移数据 | `backend/src/scripts/` | 见 `backend/src/scripts/AGENTS.md` |
| 部署 / 发布 / 排障 | `docs/DEPLOYMENT.md` | GitHub push → Render 自动部署；含数据变更与版本验证 |
| 改前端全局状态 | `frontend/src/state/appState.js` | `settings` (localStorage) + `runtime` (内存) |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createRouter` | factory | `backend/src/routes.js:28` | HTTP 路由分发；`/api/*` 走 handleApi，其他走 serveStatic；顶层 try/catch 兜底 |
| `handleApi` | function | `backend/src/routes.js:45` | 16 个端点的 if 链；`error.statusCode` 映射 400/413/500 |
| `serveStatic` | function | `backend/src/routes.js:262` | 路径穿越防护、ETag + 304、gzip |
| `sendJson` / `sendBody` | function | `backend/src/utils.js:17,23` | 响应发送；≥1 KB 且客户端支持时 gzip |
| `JsonQuizRepository` | class | `backend/src/repositories/JsonQuizRepository.js:43` | 文件存储；更新队列串行、mtime 缓存、临时文件 + rename、内容变化时备份 |
| `SqlQuizRepository` | class | `backend/src/repositories/SqlQuizRepository.js:10` | PostgreSQL 单行 JSONB；`update` 在事务内 `SELECT ... FOR UPDATE` |
| `AiRecognitionService` | class | `backend/src/services/AiRecognitionService.js:1` | 调用 Mimo `chat/completions` 抽取题目 JSON |
| `buildStudyNotes` | function | `backend/src/services/StudyNoteGenerator.js:8` | 生成解析与速记 |
| `normalizeQuestion` | function | `backend/src/utils.js:172` | 类型推断（fill-blank ⇄ choice），选项大写去重 |
| `validateQuestion` | function | `backend/src/utils.js:208` | 拒绝空 stem、<2 选项、答案不存在的题目 |
| `updateQuestionReview` | function | `backend/src/utils.js:131` | 连对 2 次标记已掌握；前端 `applyQuestionReview` 与其保持一致 |
| `config` | object | `backend/src/config.js:11` | port=8787, host=0.0.0.0；`useDatabase = !!DATABASE_URL` |
| `api` | object | `frontend/src/api/client.js:14` | 14 个方法对应所有 `/api/*` 端点 |
| `runtime` / `settings` | objects | `frontend/src/state/appState.js:1,8` | runtime=易失状态, settings=localStorage 持久化 |
| `parseQuestions(text)` | function | `frontend/src/utils/parser.js:9` | 行式正则解析；自动识别选择/填空 |
| `renderApp` / `updatePracticeOnly` | functions | `frontend/src/ui/render.js:40,52` | 全量 vs 仅答题区重渲染（性能优化） |
| `request(action, failureMessage)` | function | `frontend/src/main.js:35` | 包装 `api.*`，失败显示全局提示条 |

## CONVENTIONS

- **ESM 全栈**：`package.json` 声明 `"type": "module"`，所有 `.js` 文件用 `import/export`，导入路径显式写扩展名（`.js`）
- **零构建**：无 bundler、无 transpiler、无 linter（`package.json` 只有 `pg` 一个依赖）
- **测试**：`node --test` 发现 `*.test.js`；仓库层测试用真实临时文件，路由层用内存仓库 + 真实 HTTP
- **依赖注入**：`server.js` 创建 `repository` + `aiService`，通过 `createRouter({repository, aiService})` 注入路由
- **服务端权威**：所有状态变更走 `/api/*` POST；前端 `runtime` 是服务器状态的镜像
- **乐观更新**：`nextQuestion` / `submitAnswer` 先本地更新再后台同步统计字段
- **错误处理**：预期内的失败用 `httpError(status, message)`；其余异常由 handleApi 兜底 500

## ANTI-PATTERNS (THIS PROJECT)

- **不要**加任何依赖除非必要 —— `package.json` 故意保持极简（只有 `pg`）
- **不要**引入前端框架（Vue/React）—— 当前刻意保持 vanilla
- **不要**在路由里读 `process.env` —— 全部走 `config.js`
- **不要**给 `frontend/src/main.js` 写新事件 handler 时绕过 `runtime` 全局对象
- **不要**跳过 `readBody` 直接读请求体 —— 它负责 20 MB 上限与 413
- **不要**让 `JsonQuizRepository.getState` 捕获 JSON 解析错误 —— 损坏文件必须抛出并保留原文件

## UNIQUE STYLES

- **双模式存储**：`useDatabase` getter 让 JSON/PostgreSQL 共享同一份路由代码
- **三键去重**：导入时用 `id` + `questionFingerprint(stem|options|answer)` + `stemKey` 三个 set 防重复
- **填空答案分隔符**：`；;|、` 任意一种都接受
- **答案大小写无关**：选择题答案全部大写后排序比较
- **题目类型自动推断**：`normalizeQuestion` 根据"无选项 + 有答案"自动判定为 `fill-blank`
- **前端分层**：`api/`（I/O）→ `state/`（model）→ `ui/`（view）→ `utils/`（helpers）；`main.js` 是 controller
- **备份节流**：练习流程端点传 `skipBackup: true`，只有题库内容变化才写 `data/backups/`
- **双端一致性测试**：`backend/test/parity.test.js` 保证前端 `answers.js` / `review.js` / `practiceFlow.js` 与后端判定逻辑一致

## COMMANDS

```bash
# 本地启动（默认 JSON 存储）
npm start                                # 启动服务 → http://127.0.0.1:8787/

# 数据库模式
DATABASE_URL=postgres://... npm start    # 自动切换到 SqlQuizRepository

# 测试与语法检查
npm test                                 # node --test
npm run check                            # 对所有源码文件跑 node --check

# 旧数据迁移（quiz-maker → 本项目）
npm run migrate:quiz-maker

# 切到 PostgreSQL
npm run migrate:to-db

# 批量导入 .txt 题库
npm run import:txt -- "D:\题库目录"

# 生成学习笔记 / 离线 HTML
npm run generate:study-notes
npm run build:maogai-html
```

## NOTES

- 服务启动时会打印 `📄 使用本地 JSON 文件存储` 或 `📦 使用 PostgreSQL 数据库存储` 表明当前模式
- 端口默认 8787，可通过 `PORT` 环境变量覆盖
- `data/backups/` 保留最近 80 份；只有题库内容变化时才新增
- `MIMO_API_KEY` 缺失时调 `/api/recognize-image` 会立即抛"未设置 MIMO_API_KEY"
- AI 响应被截断 4096 tokens；超长图片可能识别不全；`MIMO_TIMEOUT_MS` 默认 120000
- `frontend/src/main.js` 顶层 `await api.state()`，因此必须作为 `<script type="module">` 加载
- 测试临时文件写在 `.test-tmp/`（gitignore），用例结束后自行清理
