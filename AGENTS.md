# PROJECT KNOWLEDGE BASE

**Generated:** 2026-06-30 17:10
**Commit:** c9575f6
**Branch:** master

## OVERVIEW

模块化题库与随机刷题平台。Node.js 18+ ESM 后端（无框架，原生 `node:http`）+ 原生 JS 前端（无构建步骤），题库可存为本地 JSON 或 PostgreSQL。

## STRUCTURE

```
quiz-platform/
├── backend/src/                # 后端：server + routes + repositories + services + scripts
├── frontend/                   # 前端：单页应用，原生 JS
│   ├── index.html
│   └── src/                    # main.js + api/ + state/ + ui/ + utils/ + styles.css
├── data/                       # 题库运行时数据（quiz-data.json + 自动备份）
├── docs/MIGRATION.md           # 旧迁移说明（已被本文件取代）
├── package.json                # 5 个 npm 脚本；ESM；Node 18+
├── render.yaml                 # Render 部署配置
└── .env                        # 运行时环境变量（DATABASE_URL、MIMO_*）
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 改 HTTP 路由/接口 | `backend/src/routes.js` | 384 行，单文件集中式路由（无 Express） |
| 改数据存储/数据模型 | `backend/src/repositories/JsonQuizRepository.js` 或 `SqlQuizRepository.js` | JSON / PostgreSQL 双实现 |
| 改题目规范化/校验 | `backend/src/utils.js` | `normalizeQuestion`, `validateQuestion`, `createId` |
| 改 AI 图片识别 | `backend/src/services/AiRecognitionService.js` | Mimo (Xiaomi) API，prompt 在文件内 |
| 改前端入口/交互 | `frontend/src/main.js` | 654 行，单文件事件绑定 + 业务 |
| 改 UI 渲染/动画 | `frontend/src/ui/render.js` | 全部 DOM 渲染逻辑 |
| 改题目解析（粘贴文本） | `frontend/src/utils/parser.js` | 正则式行解析，区分选择/填空 |
| 改 API 客户端 | `frontend/src/api/client.js` | 单一 `request()` 函数 |
| 加/迁移数据 | `backend/src/scripts/` | 见 `backend/src/scripts/AGENTS.md` |
| 改前端全局状态 | `frontend/src/state/appState.js` | `settings` (localStorage) + `runtime` (内存) |

## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `createRouter` | factory | `backend/src/routes.js:13` | HTTP 路由分发；`/api/*` 走 handleApi，其他走 serveStatic |
| `JsonQuizRepository` | class | `backend/src/repositories/JsonQuizRepository.js:30` | 文件存储；自动备份到 `data/backups/`（最多 80 个） |
| `SqlQuizRepository` | class | `backend/src/repositories/SqlQuizRepository.js:10` | PostgreSQL 存储；通过 `DATABASE_URL` 启用 |
| `AiRecognitionService` | class | `backend/src/services/AiRecognitionService.js:1` | 调用 Mimo `chat/completions` 抽取题目 JSON |
| `normalizeQuestion` | function | `backend/src/utils.js:28` | 类型推断（fill-blank ⇄ choice），选项大写去重 |
| `validateQuestion` | function | `backend/src/utils.js:56` | 拒绝空 stem、<2 选项、答案不存在的题目 |
| `createId(prefix)` | function | `backend/src/utils.js:1` | `${prefix}-${Date.now()}-${rand}` |
| `config` | object | `backend/src/config.js:11` | port=8787, host=0.0.0.0；`useDatabase = !!DATABASE_URL` |
| `api` | object | `frontend/src/api/client.js:14` | 13 个方法对应所有 `/api/*` 端点 |
| `runtime` / `settings` | objects | `frontend/src/state/appState.js:1,8` | runtime=易失状态, settings=localStorage 持久化 |
| `parseQuestions(text)` | function | `frontend/src/utils/parser.js:9` | 行式正则解析；自动识别选择/填空 |
| `renderApp` / `updatePracticeOnly` | functions | `frontend/src/ui/render.js:26,37` | 全量 vs 仅答题区重渲染（性能优化） |

## CONVENTIONS

- **ESM 全栈**：`package.json` 声明 `"type": "module"`，所有 `.js` 文件用 `import/export`，导入路径显式写扩展名（`.js`）
- **零构建**：无 bundler、无 transpiler、无 linter（`package.json` 只有 `pg` 一个依赖）
- **零测试**：无 test 框架、无 test 目录
- **依赖注入**：`server.js` 创建 `repository` + `aiService`，通过 `createRouter({repository, aiService})` 注入路由
- **服务端权威**：所有状态变更走 `/api/*` POST；前端 `runtime` 是服务器状态的镜像
- **乐观更新**：`nextQuestion` / `submitAnswer` 先本地更新再后台同步统计字段
- **MIME 表**：`routes.js` 顶部有手写 `mimeTypes`（4 种扩展名）

## ANTI-PATTERNS (THIS PROJECT)

- **不要**加任何依赖除非必要 —— `package.json` 故意保持极简（只有 `pg`）
- **不要**引入前端框架（Vue/React）—— README 提到未来可能迁移，但当前刻意保持 vanilla
- **不要**改 `data/quiz-data.json` 后手动重命名旧文件 —— `JsonQuizRepository.backupExistingFile` 会自动备份，再多 80 份就触发 `pruneBackups`
- **不要**在路由里读 `process.env` —— 全部走 `config.js`
- **不要**给 `frontend/src/main.js` 写新事件 handler 时绕过 `runtime` 全局对象
- **不要**新增 `.env.example` 之外的环境变量命名方式 —— 注释提醒"真正生效的是 `.env` 文件"

## UNIQUE STYLES

- **双模式存储**：`useDatabase` getter 让 JSON/PostgreSQL 共享同一份路由代码
- **三键去重**：导入时用 `id` + `questionFingerprint(stem|options|answer)` + `stemKey` 三个 set 防重复
- **填空答案分隔符**：`；;|、` 任意一种都接受
- **答案大小写无关**：选择题答案全部大写后排序比较
- **题目类型自动推断**：`normalizeQuestion` 根据"无选项 + 有答案"自动判定为 `fill-blank`
- **前端分层**：`api/`（I/O）→ `state/`（model）→ `ui/`（view）→ `utils/`（helpers）；`main.js` 是 controller
- **OCR 容错**：`parser.js` 内置常见错字修复（`汽车轮取` → `汽车轮胎`，`PMoO` → `PMO`）和全角→半角转换
- **选项乱序**：UI 渲染时 Fisher-Yates 洗牌（仅在 `settings.shuffleOptions` 开启时）

## COMMANDS

```bash
# 本地启动（默认 JSON 存储）
npm start                                # 启动服务 → http://127.0.0.1:8787/

# 数据库模式
DATABASE_URL=postgres://... npm start    # 自动切换到 SqlQuizRepository

# 语法检查
npm run check

# 旧数据迁移（quiz-maker → 本项目）
npm run migrate:quiz-maker

# 切到 PostgreSQL
npm run migrate:to-db

# 批量导入 .txt 题库
npm run import:txt -- "D:\题库目录"
```

## NOTES

- 服务启动时会打印 `📄 使用本地 JSON 文件存储` 或 `📦 使用 PostgreSQL 数据库存储` 表明当前模式
- 端口默认 8787，可通过 `PORT` 环境变量覆盖
- 备份目录 `data/backups/` 容易膨胀（80 份 × 完整 JSON），git 占用大；注意 `.gitignore` 是否排除
- `MIMO_API_KEY` 缺失时调 `/api/recognize-image` 会立即抛"未设置 MIMO_API_KEY"
- AI 响应被截断 4096 tokens；超长图片可能识别不全
- `frontend/src/main.js` 顶层 `await api.state()`，因此必须作为 `<script type="module">` 加载
