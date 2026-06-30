# SCRIPTS KNOWLEDGE BASE

## OVERVIEW

6 个独立 CLI 工具。两类：本地数据迁移（读/写 `data/quiz-data.json` 或 PostgreSQL），远程导入（HTTP POST 到运行中的 `quiz-platform` 服务）。所有工具都是 ESM Node，无外部依赖（除 `pg`）。

## STRUCTURE

```
backend/src/scripts/
├── import-txt-files.js            # 批量导入 .txt 目录（按 "题目 N (ID: xxx):" 格式）
├── import-md-files.js             # 批量导入 .md 目录（按 "## 一、单选题" 章节）
├── import-to-single-course.js     # 把所有现有题目合并到一门课
├── migrate-from-quiz-maker.js     # 从旧 quiz-maker 项目 JSON 合并进来
├── migrate-to-db.js               # JSON 仓库 → PostgreSQL 仓库一次性迁移
└── scan-codex-session-questions.js # 从 codex session 文件中扫描题目
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 加新批量导入脚本 | 复制 `import-txt-files.js` 改 `parseQuestionBlock` | 必须先 `npm start` 跑服务，脚本只发 POST |
| 改题目识别正则 | `import-txt-files.js:64` / `import-md-files.js:20` | 每个文件有独立的 `parseQuestionBlock` / `parseMdQuestions` |
| 改 quiz-maker 兼容 | `migrate-from-quiz-maker.js:mergeState` | 默认从 `../../../../quiz-maker/data/quiz-data.json` 读，可 CLI 传路径覆盖 |
| 跑 JSON → DB 迁移 | `migrate-to-db.js` | 需 `DATABASE_URL` 环境变量；会保留原 `data/quiz-data.json` 不删 |
| 调远程服务地址 | 设 `API_URL=http://...` | import-txt-files 默认 `http://127.0.0.1:8787`；import-md-files 强制要求设置 |

## CONVENTIONS

- **本地迁移** 用 `JsonQuizRepository` 直读 `dataFile`；**远程导入** 走 `fetch` POST `/api/*`
- **CLI 入口**：每个文件顶层 `main().catch(console.error)`（import-txt）或顶层 `await`（migrate）
- **post() 辅助**：自己内联 `http.request` Promise 包装，不依赖全局 fetch（旧 Node 习惯）
- **去重**：靠服务端的 `buildImportResult` 三键去重（`id` / `fingerprint` / `stemKey`），脚本不需要客户端去重
- **题目类型**：仅产出 `choice` 和 `fill-blank`；`judgement` 在 import-txt 中归一为 `choice`（`对/错` 选项）

## ANTI-PATTERNS (THIS PROJECT)

- **不要**让脚本直接调 `repository.saveState` 后再启服务 —— 容易踩到"两个进程写同一文件"的竞态
- **不要**改 `import-txt-files.js` 默认 `API_URL` 为线上地址 —— 它是 dev tool，应默认 localhost
- **不要**为脚本加新依赖（`chalk`、`ora` 等）—— 项目零依赖哲学不破例
- **不要**让 `migrate-from-quiz-maker.js` 覆盖目标文件而不备份 —— 当前会在合并前 `fs.copyFile` 到 `quiz-data.json.<ts>.bak`
- **不要**假设 `quiz-maker` 项目仍在原位 —— 默认路径是 `../../../../quiz-maker/data/quiz-data.json`，应总是支持 CLI 覆盖

## UNIQUE STYLES

- **`judgement` 题型归一**：import-txt 检测 `类型:judgement` 时把答案 `正确/错误` 映射成 `对/错` 选项 key
- **章节推断题型**：import-md-files 通过 `## 一、单选题 / ## 二、多选题 / ## 三、判断题` 标题自动设 `currentSectionType`
- **迁移可重入**：`migrate-from-quiz-maker.js` 多次执行不会重复导入（靠三键去重）
- **远程 import 是无状态客户端**：所有去重 + 校验交给 server，本地不做预校验

## NOTES

- 跑任何"远程"脚本（import-txt / import-md）前必须先 `npm start` 让 8787 跑起来
- `import-md-files.js` 强制要求 `API_URL` 环境变量（无默认值），因为它本意是给线上用
- `migrate-to-db.js` 不会清空目标数据库 —— 写入是覆盖式（单行 JSONB）
- `scan-codex-session-questions.js` 用途最特殊：从 `~/.claude` 或类似目录扫 session 文件提取题目，是临时工具，可能过时
- 所有脚本都允许 `process.argv[2]` 覆盖默认输入路径
