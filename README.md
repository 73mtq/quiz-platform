# Quiz Platform

模块化题库与随机刷题平台。

相比 `quiz-maker`，这个版本把后端 API、数据仓库、AI 识别服务和前端页面拆开，后续更适合继续加功能。

## 启动

```powershell
cd D:\claude_code\auto_test\quiz-platform
npm start
```

访问 `http://127.0.0.1:8787/`。

## 数据

题库保存在：

```text
data/quiz-data.json
```

从旧版 `quiz-maker` 迁移题库：

```powershell
cd D:\claude_code\auto_test\quiz-platform
npm run migrate:quiz-maker
```

## AI

如需图片 AI 识别，创建 `.env` 并填写：

```text
MIMO_API_KEY=你的 tokenplan API Key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
PORT=8787
```

注意：真正生效的是 `.env` 文件，不是 `.env.example`。改完 `.env` 后需要重新运行 `npm start`。
