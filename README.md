# Quiz Platform

模块化题库与随机刷题平台。

相比 `quiz-maker`，这个版本把后端 API、数据仓库、AI 识别服务和前端页面拆开，后续更适合继续加功能。

## 功能特性

- **课程管理**：支持多课程分组，方便分类管理题目
- **题目导入**：支持文本导入和 AI 图片识别导入
- **刷题模式**：
  - 全部题目：随机刷所有题目
  - 指定数量：自定义刷题数量
  - 错题重做：只刷答错且未掌握的题目
  - 限时模拟：按数量抽题并倒计时，结束后可复盘本轮错题
- **答题功能**：
  - 键盘快捷键：A–H 选择选项，Enter 提交，方向键切题
  - 答对自动下一题（可选开启）
  - 选项乱序（防止位置记忆）
  - 题目收藏（星标收藏，支持筛选）
- **复习分析**：统计待清错题、反复错、多选错题与已掌握题目，按薄弱板块给出复习顺序
- **解析与速记**：可批量生成每题解析和速记提示，也可手动编辑
- **数据同步**：动态版支持 PostgreSQL 数据库；国家安全教育静态版把进度保存在当前手机浏览器，支持导出和导入
- **答题统计**：记录正确率、错题次数等

## 启动

```powershell
cd <你的仓库目录>
npm start
```

访问 `http://127.0.0.1:8787/`。

## 测试

```powershell
npm test        # node --test，运行全部单元与集成测试
npm run check   # 对 backend/src 与 frontend/src 全部 .js 做语法检查
npm run test:sql # SQL 仓库集成测试，需要 TEST_DATABASE_URL 指向一次性数据库
```

## 数据存储

### 本地 JSON 文件（默认）

题库保存在：

```text
data/quiz-data.json
```

题库内容变化时会自动备份到 `data/backups/`（保留最近 80 份）；练习进度变化不备份。

### PostgreSQL 数据库（推荐）

配置环境变量 `DATABASE_URL` 即可使用数据库存储。运行时数据仍在 `quiz_data` 单行，分为 `data`（课程与题目正文）、`practice`（当前课程与每门课程的练习状态）、`stats`（每道题的统计、收藏、复习记录）三列，练习与答题只写 `practice` 或 `stats`。

首次读取旧版单列 `data` 时会在事务内自动迁移，并把迁移前整行写入 `quiz_data_backups`。需要恢复时：

```powershell
npm run restore:db
```

从旧版 `quiz-maker` 迁移题库：

```powershell
cd <你的仓库目录>
npm run migrate:quiz-maker
```

## AI 图片识别

如需图片 AI 识别，创建 `.env` 并填写：

```text
MIMO_API_KEY=你的 tokenplan API Key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
MIMO_TIMEOUT_MS=120000
PORT=8787
DATABASE_URL=你的 PostgreSQL 连接地址（可选）
```

注意：真正生效的是 `.env` 文件。改完 `.env` 后需要重新运行 `npm start`。

## 部署

生产环境由 GitHub `master` 分支自动部署到 Render，题库数据存放在 Supabase PostgreSQL。

1. 在 Render 创建 Web Service 并连接本仓库，分支选 `master`
2. Build Command `npm install`，Start Command `npm start`
3. 配置环境变量：
   - `DATABASE_URL`：Supabase 或其他 PostgreSQL 连接地址
   - `MIMO_API_KEY`：AI 识别 API Key（可选）
4. 首次启动自动建表，题库数据按需导入

**推送 `master` 即上线。** 完整的发布流程、数据变更、版本验证与排障步骤见
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 离线 HTML

需要把毛概题库打包成单个 HTML 文件时：

```powershell
npm run build:maogai-html
```

产物在 `dist/maogai-quiz.html`。

## 国家安全教育静态题库（手机）

国家安全教育 290 道题打包成单文件 HTML，部署到 GitHub Pages，手机打开 <https://73mtq.github.io/quiz-platform/> 即可刷题，不依赖数据库。

```powershell
npm run validate:ns     # 校验 290 道题的解析、答案和引用
npm run build:ns-html   # 生成 dist/national-security-quiz.html
npm run build:ns-pages  # 生成 docs/index.html，推送后 GitHub Pages 自动更新
```

- 当前线上入口：<https://73mtq.github.io/quiz-platform/>
- Render 镜像：<https://quiz-platform-fbxp.onrender.com/national-security.html>（旧域名，无数据库；免费实例休眠后首次打开约 1 分钟）
- 内容源：`content/national-security/course.json`
- 解析批次：`content/national-security/explanations/batch-*.json`
- 进度保存在手机浏览器的 localStorage；页面提供“导出进度”和“导入进度”。
- 页面顶部“导入旧版进度”可以导入旧版 Supabase 中已有的国家安全教育答题记录。
- `render.yaml` 也保留 Render Static Site 配置，可在 Render 控制台创建镜像站。
- 旧 Render Web Service 继续使用 Supabase，属于旧版入口；国家安全教育以静态站为准。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| A–H | 选择对应选项（仅在刷题面板生效） |
| Enter | 提交答案（仅在刷题面板生效） |
| → 或 Space | 下一题（仅在刷题面板生效） |
| ← | 上一题（仅在刷题面板生效） |
