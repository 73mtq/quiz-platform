# 部署与运维手册

**线上地址**：https://quiz-platform-fbxp.onrender.com/
**适用版本**：master 分支（编写于 2026-11-11）

---

## 1. 部署拓扑

```
浏览器
  │
  ▼
Render Web Service (quiz-platform)  ── 代码 ──▶ GitHub  73mtq/quiz-platform  master
  │
  └── 存储 ──▶ Supabase PostgreSQL（表 quiz_data，单行 id=1，JSONB）
```

| 环境 | 代码来源 | 存储 | 启动方式 |
|------|----------|------|----------|
| 生产 | GitHub master 推送后自动部署 | Supabase PostgreSQL | `npm start` |
| 本地 | 工作区 | `data/quiz-data.json` | `npm start` |

**存储如何选择**：`backend/src/config.js` 的 `useDatabase` getter 返回 `Boolean(DATABASE_URL)`。
有 `DATABASE_URL` 就走 `SqlQuizRepository`，否则走 `JsonQuizRepository`。启动日志会打印
`📦 使用 PostgreSQL 数据库存储` 或 `📄 使用本地 JSON 文件存储`，这是判断当前模式最快的方式。

---

## 2. 部署配置

`render.yaml`（只有 6 行，环境变量不在这里）：

```yaml
services:
  - type: web
    name: quiz-platform
    runtime: node
    buildCommand: npm install
    startCommand: npm start
```

- Node 版本由仓库根目录 `.node-version`（`20.11.0`）决定，不要删。
- 端口由 Render 注入 `PORT`，服务监听 `0.0.0.0`（见 `config.js`），本地默认 `8787`。
- 仓库里没有 CI 工作流，**唯一的部署触发就是 push 到 master**。

### 环境变量清单

| 变量 | 必需 | 说明 |
|------|------|------|
| `DATABASE_URL` | 生产必需 | Supabase 连接串。只配在 Render Dashboard，**不进仓库、不写进本文档** |
| `MIMO_API_KEY` | 可选 | 图片识别，缺失时 `/api/recognize-image` 直接报"未设置 MIMO_API_KEY" |
| `MIMO_BASE_URL` | 可选 | 默认 `https://token-plan-cn.xiaomimimo.com/v1` |
| `MIMO_MODEL` | 可选 | 默认 `mimo-v2.5` |
| `MIMO_TIMEOUT_MS` | 可选 | 默认 120000 |
| `PORT` / `HOST` | 可选 | 本地默认 8787 / 0.0.0.0 |

> `config.js` 会读根目录 `.env`，但**不覆盖已存在的环境变量**——所以 Render 上的值优先。

---

## 3. 首次部署（新环境）

1. 建 Supabase 项目，复制连接串（Session pooler 或直连 5432 均可）。
2. Render → New → Web Service → 连接 GitHub 仓库 `73mtq/quiz-platform` → 分支 `master`。
3. Build Command `npm install`，Start Command `npm start`。
4. 环境变量加 `DATABASE_URL`。
5. 首次启动会自动建表 `quiz_data (id INT PRIMARY KEY DEFAULT 1, data JSONB, updated_at TIMESTAMPTZ)`
   并插入空行，**不需要手工执行 SQL**。
6. 灌数据：走第 5 节的增量导入（推荐），或首次用 `npm run migrate:to-db`（整库覆盖）。

> `render.yaml` 里不写环境变量是有意为之：连接串属于机密，只存 Dashboard。

---

## 4. 日常发布流程（改代码）

```bash
npm run check      # 全部源码 node --check
npm test           # node --test，自动发现 *.test.js
git add -A && git commit -m "..."
git push origin master
```

推送后 Render 自动：拉取 → `npm install` → 重启进程。不需要手动点击 Deploy。

**免费实例注意**：约 15 分钟无请求会休眠，休眠后第一个请求要 30–60 秒才返回。
探测线上时超时给足 90 秒以上，否则会把冷启动误判成宕机。

---

## 5. 数据变更（改题库）

**铁律：题库数据不在 git 里。** 部署代码不会动数据，改数据也不需要重新部署。
生产数据只存在于 Supabase 的那一行 JSONB。

### 5.1 本地 JSON 模式

直接改 `data/quiz-data.json` 或用 `npm run import:txt`，写入时走"临时文件 + rename"，
并在 `data/backups/` 保留最近 80 份（内容没变不写备份）。

### 5.2 生产增量导入（推荐）

走应用自己的 API，不覆盖已有课程、不动别人的练习进度：

```bash
# 1) 新建课程（注意：新建后会自动设为 active）
curl -X POST https://<host>/api/courses -H 'content-type: application/json' --data-binary @course.json

# 2) 切回想要的课程
curl -X POST https://<host>/api/courses/active -H 'content-type: application/json' --data-binary @active.json

# 3) 批量导入题目，返回 { state, importResult }，rejected 里是逐题原因
curl -X POST https://<host>/api/questions -H 'content-type: application/json' --data-binary @questions.json

# 4) 修正单题（不做去重校验）
curl -X POST https://<host>/api/questions/update -H 'content-type: application/json' --data-binary @update.json
```

**中文必须走文件 body**：Windows 控制台会把内联中文参数转成 GBK，课程名会变乱码。
用 Node 写 UTF-8 文件再 `--data-binary @file`。

### 5.3 去重陷阱（踩过一次）

`routes.js` 的 `buildImportResult` 用 **OR** 判断重复：

```js
if (seenIds.has(question.id) || seen.has(fingerprint) || seenStems.has(stemKey)) { ...跳过... }
```

最弱的一环是 `stemKey`（只看题干）。**同题干、不同选项/答案的两道题会被判重复，只进第一道。**
导入前先统计重复题干；必须全量导入时，给这些题干加互不相同的临时标记，导入完成后用
`/api/questions/update` 还原（update 不做去重），最后确认标记残留为 0。

### 5.4 整库迁移（危险）

```bash
DATABASE_URL="postgresql://..." npm run migrate:to-db
```

脚本读 `data/quiz-data.json`，执行 `INSERT ... ON CONFLICT (id) DO UPDATE SET data = $1`，
**整行替换**：线上所有课程、题目、练习进度全部变成该文件的副本。
只用于"新库首次灌数据"或"确认要用本地数据覆盖全站"。执行前先备份：

```bash
curl -s https://<host>/api/state -o backup-$(date +%Y%m%d-%H%M%S).json
```

---

## 6. 验证上线是否成功

**静态根是 `frontend/`**（`serveStatic` 把请求路径 join 到 `frontendDir`）。
因此：

- 只能探测 `frontend/` 下的文件；
- 仓库根文件（`README.md`、`docs/*`、`render.yaml`）**永远返回 404**，
  拿它当"文件已删除"的证据是错的，任何版本都 404。

正确做法是**内容哈希比对**：

```bash
f=src/main.js
curl -s https://<host>/$f | sha256sum
git show HEAD:frontend/$f | sha256sum
# 两个哈希一致 → 线上跑的就是当前 HEAD
```

再补一次接口自检：

```bash
curl -s -o /dev/null -w '%{http_code} %{size_download}\n' https://<host>/api/state
```

应返回 200，且课程数 / 题数与预期一致。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 首页超时或 502 | 免费实例休眠冷启动 | 等 60 秒重试，不要急着重部署 |
| `/api/state` 500，错误含 `tenant/user postgres.xxx not found` | Supabase 项目被暂停或删除 | 到 Supabase Dashboard 恢复项目，**恢复后无需重新部署** |
| 构建失败 | 依赖或语法问题 | 本地先跑 `npm run check` + `npm test`，再看 Render Logs |
| 页面能开但题库为空 | 新库首次启动只有空 state | 按 5.2 或 5.4 灌数据 |
| 写入返回 413 | 单请求体上限 20 MB | 分批导入 |
| 课程名 / 题干乱码 | shell 内联中文被转码 | 改用 UTF-8 文件 + `--data-binary` |
| 导入数量少于提交数量 | 同题干被去重 | 见 5.3 |

---

## 8. 回滚

- **代码**：`git revert <sha> && git push origin master`，Render 自动回到上一版。
  不要用 `git reset --hard` + 强推，会污染共享历史。
- **数据**：用第 5.4 节的备份文件配合 `migrate:to-db` 覆盖，或从 `data/backups/` 取最近的 JSON。
- 两者独立：回滚代码不会回滚数据，回滚数据也不需要重新部署。

---

## 9. 安全与限制

- **无鉴权**：任何知道地址的人都能增删改题库、切换课程。不要放敏感内容。
- 单实例 + 单行 JSONB，写入在事务内 `SELECT ... FOR UPDATE` 串行化，适合小流量；
  不是多租户设计，不能水平扩多实例共写。
- 数据库只存一个 `data` 大字段，整库读写，题库变大会线性变慢。
- 备份只在本地 JSON 模式生效（`data/backups/` 保留 80 份）；数据库模式依赖 Supabase 自身备份。