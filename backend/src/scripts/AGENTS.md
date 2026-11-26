# SCRIPTS KNOWLEDGE BASE

## OVERVIEW

独立 Node 脚本，按用途分到 3 个子目录 + 1 个根目录工具：语法检查、批量导入、数据迁移、内容生成 / 离线产物。全部是 ESM Node，无外部依赖（除 `pg`）。

## STRUCTURE

```
backend/src/scripts/
├── check-syntax.js                       # npm run check：对 backend/src + frontend/src 全部 .js 跑 node --check
├── import/
│   ├── import-txt-files.js               # 批量导入 .txt 目录（HTTP POST 到运行中的服务）
│   └── import-md-files.js                # 批量导入 .md 目录（HTTP POST，必须设置 API_URL）
├── migrate/
│   ├── migrate-from-quiz-maker.js        # 从旧 quiz-maker 项目 JSON 合并进来
│   ├── migrate-to-db.js                  # JSON 仓库 → PostgreSQL 三列布局一次性迁移
│   └── restore-quiz-data.js              # 从 quiz_data_backups 恢复旧版单列 data
└── generate/
    ├── generate-study-notes.js           # 本地为所有题目生成解析与速记
    ├── build-standalone-maogai-html.js   # 生成离线单文件 HTML
    ├── build-national-security-content.js
    ├── validate-national-security-content.js
    └── build-national-security-pages.js  # 复制静态产物到 docs/ 与 frontend/
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| 加新批量导入脚本 | 复制 `import/import-txt-files.js` 改 `parseQuestionBlock` | 必须先 `npm start` 跑服务，脚本只发 POST |
| 改题目识别正则 | `import/import-txt-files.js` / `import/import-md-files.js` | 每个文件有独立的 `parseQuestionBlock` / `parseMdQuestions` |
| 改 quiz-maker 兼容 | `migrate/migrate-from-quiz-maker.js` | 默认从同级 `quiz-maker/data/quiz-data.json` 读，可 CLI 传路径覆盖 |
| 跑 JSON → DB 迁移 | `migrate/migrate-to-db.js` | 需 `DATABASE_URL`；先写 `quiz_data_backups`，再写 data / practice / stats |
| 恢复旧版数据 | `migrate/restore-quiz-data.js` | `npm run restore:db`；把 data 写回，practice 与 stats 置空 |
| 调远程服务地址 | 设 `API_URL` | import-txt 默认 `http://127.0.0.1:8787`；import-md 强制要求 `API_URL` |
| 生成解析 / 速记 | `generate/generate-study-notes.js` | `npm run generate:study-notes`；`--overwrite` 覆盖已有内容 |
| 生成离线 HTML | `generate/build-standalone-maogai-html.js` | 参数：`[源数据文件] [输出 HTML 路径] [进度 JSON 路径]` |
| 生成国家安全教育静态站 | `generate/build-national-security-pages.js` | `npm run build:ns-pages`；复制到 `docs/index.html` 与 `frontend/national-security.html` |
| 语法检查 | `check-syntax.js` | `npm run check`；递归遍历 `backend/src` 与 `frontend/src` |

## CONVENTIONS

- **本地数据脚本** 用 `JsonQuizRepository` 直读写 `dataFile`；**远程脚本** 走 `fetch` 或 `http.request` 调用 `/api/*`
- **CLI 入口**：每个文件顶层 `main().catch(...)` 或顶层 `await`
- **去重**：远程导入靠服务端 `buildImportResult` 的三键去重
- **题目类型**：仅产出 `choice` 和 `fill-blank`；`judgement` 在 import-txt 中归一为 `choice`
- **子目录相对导入**：`import/` / `migrate/` / `generate/` 下引用 `config.js` / `repositories/` / `services/` / `utils.js` 用 `../../` 前缀
- **迁移脚本先备份**：写库前把当前整行写入 `quiz_data_backups`；恢复时只写回 `data`

## ANTI-PATTERNS (THIS PROJECT)

- **不要**让脚本直接调 `repository.saveState` 后再启服务 —— JSON 文件会被两个进程互相覆盖
- **不要**在 `migrate-to-db.js` 中只写 `data` —— 必须同时写 practice 与 stats
- **不要**改 `import/import-txt-files.js` 默认 `API_URL` 为线上地址
- **不要**为脚本加新依赖（`chalk`、`ora` 等）
- **不要**让 `migrate-from-quiz-maker.js` 覆盖目标文件而不备份
- **不要**在恢复旧版数据后继续运行新代码而不确认迁移结果 —— 新代码会再次自动迁移

## UNIQUE STYLES

- **`judgement` 题型归一**：import-txt 把答案 `正确/错误` 映射成 `对/错` 选项
- **章节推断题型**：import-md-files 通过标题自动设 `currentSectionType`
- **迁移可重入**：`migrate-from-quiz-maker.js` 多次执行不会重复导入
- **远程 import 是无状态客户端**：去重与校验交给服务端
- **离线 HTML 完整性**：`build-standalone-maogai-html.js` 输出前计算题库 SHA256 并回读校验
- **静态页进度合并**：题库哈希变化时按题目 ID 合并本地进度，保留可匹配的记录

## NOTES

- 跑远程脚本前必须先让目标服务运行
- `build-standalone-maogai-html.js` 的进度文件默认读 `data/maogai-progress.json`
- 所有脚本允许 `process.argv[2]` 覆盖默认输入路径
- SQL 迁移与恢复使用 `DATABASE_URL`；集成测试使用 `TEST_DATABASE_URL`
