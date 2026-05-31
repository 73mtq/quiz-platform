# 迁移说明

这个目录是从 `quiz-maker` 拆出来的模块化版本，目标是方便继续演进。

## 结构

```text
quiz-platform/
  backend/src/
    repositories/JsonQuizRepository.js  # 当前文件仓库，后续可替换 SQLite
    services/AiRecognitionService.js    # MiMo 图片识别
    routes.js                           # API 路由
    server.js                           # 服务入口
  frontend/src/
    api/client.js                       # API 客户端
    utils/parser.js                     # 文本题目解析
    main.js                             # 当前原生前端入口
  data/quiz-data.json                   # 本地题库文件
```

## 运行

```powershell
cd D:\claude_code\auto_test\quiz-platform
npm start
```

访问：

```text
http://127.0.0.1:8787/
```

## AI 配置

复制 `.env.example` 为 `.env`：

```text
MIMO_API_KEY=你的 tokenplan API Key
MIMO_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
MIMO_MODEL=mimo-v2.5
PORT=8787
```

## 后续建议

- 把 `frontend/src/main.js` 迁移到 Vue 3 组件。
- 把 `JsonQuizRepository` 替换为 `SqliteQuizRepository`。
- 新增 `AnswerRecord` 表，正确率改为由答题记录计算。
- 增加题目编辑、搜索、错题本、导入导出。
