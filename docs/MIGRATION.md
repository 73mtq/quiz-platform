# 迁移说明

本项目从 `quiz-maker` 拆分而来，脚本按用途分组放在 `backend/src/scripts/` 的 `import/` / `migrate/` / `generate/` 子目录下。

## 从 quiz-maker 迁移题库

```powershell
npm run migrate:quiz-maker
```

- 默认从同级 `quiz-maker/data/quiz-data.json` 读取，可传路径覆盖：
  `node backend/src/scripts/migrate/migrate-from-quiz-maker.js "D:\路径\quiz-data.json"`
- 合并前会把现有 `data/quiz-data.json` 备份为 `quiz-data.json.<时间戳>.bak`
- 靠服务端的三键去重（`id` / 内容指纹 / 题干），可重复执行

## 从 JSON 切换到 PostgreSQL

```powershell
$env:DATABASE_URL="postgresql://..."
npm run migrate:to-db
```

- 目标库使用单行三列（`data` / `practice` / `stats`）的 `quiz_data` 表，写入覆盖式，不会清空其他表
- 写库前会把当前行备份到 `quiz_data_backups`；需要恢复时运行 `npm run restore:db`
- 迁移完成后启动服务时设置同一个 `DATABASE_URL`，自动切换到 SQL 仓库

## 批量导入题库文件

```powershell
# .txt 题库（需要先 npm start）
npm run import:txt -- "D:\题库目录"

# .md 题库（需要先设置 API_URL）
$env:API_URL="http://127.0.0.1:8787"
node backend/src/scripts/import/import-md-files.js "课程名" "D:\题库目录"
```

## 生成解析与速记

```powershell
npm run generate:study-notes              # 只为缺少解析/速记的题目生成
npm run generate:study-notes -- --overwrite  # 覆盖已有内容
```

## 环境变量

`.env` 直接创建在项目根目录（仓库里没有 `.env.example`）：

```text
MIMO_API_KEY=你的 API Key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
MIMO_TIMEOUT_MS=120000
PORT=8787
DATABASE_URL=你的 PostgreSQL 连接地址（可选）
```

## 国家安全教育静态题库

国家安全教育 290 道题的内容源在 `content/national-security/`：

```powershell
npm run build:ns-content   # 合并 explanations/batch-*.json
npm run validate:ns        # 校验 290 道题、解析、引用和占位内容
npm run build:ns-html      # 生成 dist/national-security-quiz.html
npm run build:ns-pages     # 生成 docs/index.html，推送后 GitHub Pages 自动更新
```

- 线上入口：<https://73mtq.github.io/quiz-platform/>
- 构建会关闭毛概专用的自动解析生成，保留人工解析。
- 进度保存在浏览器 localStorage，页面提供“导出进度/导入进度”。
- 旧服务器进度可以用 `backend/src/scripts/migrate/export-standalone-progress.js` 转成静态页可导入的 JSON。
- 题库哈希变化时，静态页会先按题目 ID 合并本地进度，保留仍然存在的题目记录。
