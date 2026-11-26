# PROJECT KNOWLEDGE BASE

**Updated:** 2026-11-26
**Branch:** master

## OVERVIEW

模块化题库与随机刷题平台。Node.js 18+ ESM 后端（无框架，原生 `node:http`）+ 原生 JS 前端（无构建步骤），题库可存为本地 JSON 或 PostgreSQL。动态版首屏通过 `/api/bootstrap` 只加载当前课程；PostgreSQL 把题库正文、练习状态、题目统计分成三列。

## STRUCTURE

```
quiz-platform/
├── backend/src/                # 后端：server + routes + repositories + services + scripts
│   ├── routes.js               # HTTP 端点 + 静态资源服务（ETag/304/gzip/内存缓存）
│   ├── utils.js                # 题目规范化、答案判定、复习进度、JSON 响应
│   ├── repositories/           # StateShape + JSON 文件 / PostgreSQL 双实现
│   ├── services/               # AI 识别、学习笔记、迁移快照恢复
│   └── scripts/                # 按用途分组的 CLI 工具 + check-syntax.js
├── frontend/
│   ├── index.html              # 四个 Tab：导入 / 刷题 / 复习 / 题库
│   └── src/                    # main.js + api/ + state/ + ui/ + utils/ + data/ + styles.css
├── data/                       # 本地 JSON 数据（quiz-data.json + 自动备份）
├── backend/test/ + frontend/test/ # 单元/集成测试（node --test）
├── docs/DEPLOYMENT.md          # 部署 / 发布 / 数据迁移 / 排障手册
├── dist/                       # 离线 HTML 产物（gitignore）
├── .test-tmp/                  # 测试临时目录（gitignore）
├── package.json                # ESM；Node 18+；唯一依赖 pg
├── render.yaml                 # Render 部署配置
└── .env                        # 运行时环境变量（DATABASE_URL、MIMO_*）
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改 HTTP 路由/接口 | `backend/src/routes.js` | 单文件集中式路由；首屏、解析、课程与题目、练习流程 |
| 改状态形状/首屏负载 | `backend/src/repositories/StateShape.js` | normalize / split / merge / compact |
| 改数据存储 | `backend/src/repositories/JsonQuizRepository.js` 或 `SqlQuizRepository.js` | 都提供 `readState` / `update` / `updatePractice` / `updateAnswer` / `setActiveCourse` |
| 改题目规范化/校验/答案判定 | `backend/src/utils.js` | `normalizeQuestion`, `validateQuestion`, `areChoiceAnswerSetsEqual`, `areFillBlankAnswersCorrect` |
| 改 AI 图片识别 | `backend/src/services/AiRecognitionService.js` | Mimo API，默认 120 秒超时 |
| 生成学习笔记/解析 | `backend/src/services/StudyNoteGenerator.js` | `buildStudyNotes`, `applyStudyNotesToState` |
| 改前端入口/交互 | `frontend/src/main.js` | 启动、事件绑定、练习队列、同步与失败提示 |
| 改状态合并 | `frontend/src/state/practiceState.js` | 完整/紧凑状态 hydrate、练习补丁、解析合并 |
| 改 UI 渲染/动画 | `frontend/src/ui/render.js` | 全部 DOM 渲染逻辑 |
| 改题目解析（粘贴文本） | `frontend/src/utils/parser.js` | 正则式行解析，区分选择/填空 |
| 改刷题进度计算 | `frontend/src/utils/practiceFlow.js` | roundTotal / 剩余数 / 完成判定 / 自动下一题 |
| 改复习分析 | `frontend/src/utils/review.js` + `frontend/src/data/reviewTaxonomy.js` | 领域关键词与题型规则在 data 文件 |
| 改 API 客户端 | `frontend/src/api/client.js` | `request()` + 超时/重试 + 端点包装 |
| 加/迁移数据 | `backend/src/scripts/` | 见 `backend/src/scripts/AGENTS.md` |
| 部署 / 发布 / 排障 | `docs/DEPLOYMENT.md` | push master → Render 自动部署；含迁移、备份与恢复 |
| 改前端全局状态 | `frontend/src/state/appState.js` | `settings` (localStorage) + `runtime` (内存) |

## CODE MAP

| Symbol | Location | Role |
|--------|----------|------|
| `createRouter` | backend/src/routes.js | 路由分发；`/api/*` 走 handleApi，其他走 serveStatic |
| `handleApi` | backend/src/routes.js | 单一 if 链；首屏、解析、课程、题目与练习 |
| `serveStatic` | backend/src/routes.js | 路径穿越防护、ETag/304、gzip、静态缓存 |
| `compactStatePayload` | backend/src/repositories/StateShape.js | 首屏只含当前课程；解析默认延迟加载 |
| `splitState` / `mergeState` | backend/src/repositories/StateShape.js | 三列布局与完整状态互转 |
| `JsonQuizRepository` | backend/src/repositories/JsonQuizRepository.js | 文件存储；更新队列、mtime 缓存、原子写入、备份 |
| `SqlQuizRepository` | backend/src/repositories/SqlQuizRepository.js | 单行三列；revision 缓存；事务高频写入；布局迁移 |
| `AiRecognitionService` | backend/src/services/AiRecognitionService.js | 调用 Mimo chat/completions 抽取题目 JSON |
| `restoreSnapshot` | backend/src/services/QuizDataRestore.js | 从 quiz_data_backups 恢复旧版整行 |
| `buildStudyNotes` | backend/src/services/StudyNoteGenerator.js | 生成解析与速记 |
| `normalizeQuestion` | backend/src/utils.js | 类型推断，选项大写去重 |
| `validateQuestion` | backend/src/utils.js | 拒绝空 stem、<2 选项、答案不存在 |
| `updateQuestionReview` | backend/src/utils.js | 连对 2 次标记已掌握 |
| `config` | backend/src/config.js | port=8787, host=0.0.0.0；`useDatabase = !!DATABASE_URL` |
| `api` | frontend/src/api/client.js | bootstrap / explanations / courses / questions / practice / AI |
| `runtime` / `settings` | frontend/src/state/appState.js | runtime=易失状态；settings=localStorage |
| `hydrateStatePayload` / `applyPracticeStats` | frontend/src/state/practiceState.js | 首屏状态与练习补丁合并 |
| `parseQuestions` | frontend/src/utils/parser.js | 行式正则解析 |
| `renderApp` / `updatePracticeOnly` | frontend/src/ui/render.js | 全量与局部渲染 |
| `createOptionOrderCache` | frontend/src/ui/optionOrder.js | 同一题选项顺序稳定 |
| `request(action, failureMessage)` | frontend/src/main.js | 包装 api，失败显示提示条 |
| `enqueuePracticeSync` | frontend/src/main.js | 练习请求串行化与失败重试 |

## CONVENTIONS

- **ESM 前后端**：所有 `.js` 用 `import/export`，导入路径显式写扩展名
- **零构建**：无 bundler、无 transpiler；`package.json` 只有 `pg` 一个依赖
- **测试**：`node --test` 发现 `*.test.js`；仓库层用真实临时文件，路由层用内存仓库 + 真实 HTTP
- **依赖注入**：`server.js` 创建 repository 与 aiService，通过 `createRouter` 注入
- **服务端权威**：所有状态变更走 `/api/*` POST；前端 runtime 是服务端状态的镜像
- **读写分离**：路由读取用 `readState()`；练习写入用 `updatePractice` / `updateAnswer`；题库内容才用 `update`
- **请求定位**：练习与收藏请求带 `courseId`；可带 `operationId` 做重试去重
- **版本号**：前端使用的写响应带 `revision`；旧响应被忽略
- **乐观更新**：切题与答题先本地生效，后台同步统计字段
- **错误处理**：预期内的失败用 `httpError(status, message)`；其余异常由 handleApi 兜底 500

## ANTI-PATTERNS (THIS PROJECT)

- **不要**加任何依赖除非必要 —— `package.json` 保持极简
- **不要**引入前端框架 —— 当前刻意保持 vanilla
- **不要**在路由里读 `process.env` —— 全部走 `config.js`
- **不要**修改 `readState` 返回的对象 —— 会污染缓存
- **不要**用 `update` 处理练习流程 —— 会重写整份题库
- **不要**在练习端点返回完整 `state` —— 使用紧凑补丁
- **不要**让首屏返回非当前课程的题目 —— 体积会重新变大
- **不要**跳过 `readBody` 直接读请求体
- **不要**让 `getState` 捕获 JSON 解析错误
- **不要**用 git reset 或 git revert 回退代码 —— 通过文件编辑恢复上一版文件

## UNIQUE STYLES

- **双模式存储**：`useDatabase` getter 让 JSON/PostgreSQL 共享路由代码
- **首屏按课程加载**：`/api/bootstrap` 只含当前课程；切换课程按需加载
- **解析延迟加载**：首屏只为当前题与 lastAnswer 题保留解析；题库页请求 `/api/explanations`
- **SQL 三列布局**：`data`、`practice`、`stats`；练习只写小列；`revision` 做缓存失效
- **三键去重**：导入时用 id + 指纹 + 题干三个 set
- **填空答案分隔符**：`；;|、` 任意一种
- **答案大小写无关**：选择题答案规范化后排序比较
- **题目类型自动推断**：无选项 + 有答案 → `fill-blank`
- **前端分层**：api → state → ui → utils；`main.js` 是 controller
- **请求快照**：练习任务入队前保存参数，避免读取已清空的 runtime
- **选项顺序缓存**：同一题重渲染不改变选项位置
- **双端一致性测试**：`parity.test.js` 保证前后端判定逻辑一致

## COMMANDS

```bash
# 本地启动（默认 JSON 存储）
npm start

# 数据库模式
DATABASE_URL=postgres://... npm start

# 测试与语法检查
npm test
npm run check
npm run test:sql                         # 需要 TEST_DATABASE_URL

# 数据迁移与恢复
npm run migrate:quiz-maker
npm run migrate:to-db
npm run restore:db                       # 需要 DATABASE_URL
npm run verify:live -- backup.json       # 需要 API_URL

# 批量导入 .txt 题库
npm run import:txt -- "D:\题库目录"

# 生成学习笔记 / 静态页面
npm run generate:study-notes
npm run build:ns-pages
```

## NOTES

- 服务启动打印“使用本地 JSON 文件存储”或“使用 PostgreSQL 数据库存储”
- 端口默认 8787，可用 `PORT` 覆盖
- 线上当前约 2,639 道题；查看 `/api/state` 获取课程与题数
- 本地 `data/backups/` 保留最近 80 份；只有题库内容变化才新增
- SQL 迁移自动执行；迁移前整行保存在 `quiz_data_backups`
- `MIMO_API_KEY` 缺失时 `/api/recognize-image` 立即报错；`MIMO_TIMEOUT_MS` 默认 120000
- `frontend/src/main.js` 通过 `boot()` 启动；必须作为 `<script type="module">` 加载
- Render 免费实例休眠后首个请求 30 到 60 秒；首屏显示加载状态与重试入口
- 测试临时文件写在 `.test-tmp/`（gitignore）
