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
- **数据同步**：支持 PostgreSQL 数据库，手机和电脑可同步刷题进度
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
```

## 数据存储

### 本地 JSON 文件（默认）

题库保存在：

```text
data/quiz-data.json
```

题库内容变化时会自动备份到 `data/backups/`（保留最近 80 份）；练习进度变化不备份。

### PostgreSQL 数据库（推荐）

配置环境变量 `DATABASE_URL` 即可使用数据库存储，支持多设备同步。

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

需要把题库打包成单个 HTML 文件时：

```powershell
npm run build:maogai-html
```

产物在 `dist/maogai-quiz.html`。

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| A–H | 选择对应选项 |
| Enter | 提交答案 |
| → 或 Space | 下一题 |
| ← | 上一题 |
