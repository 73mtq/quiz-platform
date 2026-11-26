# 部署与运维手册

**动态地址**：https://quiz-platform-fbxp.onrender.com/
**国家安全教育静态地址**：https://73mtq.github.io/quiz-platform/
**国家安全教育 Render 镜像**：https://quiz-platform-fbxp.onrender.com/national-security.html
**适用版本**：master 分支（更新于 2026-11-26）

---

## 1. 部署拓扑与数据布局

```
浏览器
  |
  v
Render Web Service (quiz-platform)  -- 代码 --> GitHub 73mtq/quiz-platform master
  |
  +-- Supabase PostgreSQL
        quiz_data：单行 id=1
          data           JSONB  课程与题目正文
          practice       JSONB  activeCourseId + 每门课程的练习状态
          stats          JSONB  每道题的统计、收藏、复习记录
          revision       BIGINT 写入版本，读取缓存失效
          schema_version INT    2 表示三列布局
          updated_at     TIMESTAMPTZ
        quiz_data_backups：迁移前整行快照
```

| 环境 | 代码来源 | 存储 | 启动方式 |
|------|----------|------|----------|
| 生产动态版 | GitHub master 推送后自动部署 | Supabase PostgreSQL | npm start |
| 国家安全教育静态站 | GitHub master 推送后自动部署 | 题库内嵌 HTML，无数据库 | GitHub Pages；Render 旧域名提供静态镜像 |
| 本地 | 工作区 | data/quiz-data.json | npm start |

存储如何选择：backend/src/config.js 的 useDatabase getter 返回 Boolean(DATABASE_URL)。有 DATABASE_URL 就走 SqlQuizRepository，否则走 JsonQuizRepository。启动日志会打印“使用 PostgreSQL 数据库存储”或“使用本地 JSON 文件存储”。

### 数据布局

- data 只保存课程与题目正文：id、name、createdAt、questions（id、type、stem、options、answer、explanation、memoryTip、createdAt、updatedAt）。
- practice 保存 activeCourseId 与 practices。每门课程的 practice 含 roundNo、remainingIds、answeredInRound、correctInRound、totalAnswered、totalCorrect、currentQuestionId、lastAnswer、mode、count、roundTotal、answeredIds、historyIds、recentOperationIds、exam。
- stats 以题目 ID 为键，保存 wrongCount、correctCount、bookmarked、review。没有进度记录的题目不会出现在 stats 中。
- revision 每次写入加一。readState 先查 revision，命中缓存时直接返回，未命中时读取三列并合并。
- 旧版单列 data 在第一次读取时自动迁移：事务内备份整行到 quiz_data_backups，splitState 写入三列，再用 mergeState 回读比较；任何差异回滚并抛出错误。

---

## 2. 部署配置

render.yaml 保留 Web Service 与静态站配置，环境变量只放在 Render Dashboard：

```yaml
services:
  - type: web
    name: quiz-platform
    runtime: node
    buildCommand: npm install
    startCommand: npm start
```

- Node 版本由仓库根目录 .node-version（20.11.0）决定。
- 端口由 Render 注入 PORT，服务监听 0.0.0.0，本地默认 8787。
- 仓库没有 CI 工作流，唯一部署触发是 push 到 master。

### 环境变量

| 变量 | 必需 | 说明 |
|------|------|------|
| DATABASE_URL | 生产必需 | Supabase 连接串，只配在 Render Dashboard |
| MIMO_API_KEY | 可选 | 图片识别；缺失时 /api/recognize-image 报“未设置 MIMO_API_KEY” |
| MIMO_BASE_URL | 可选 | 默认 https://token-plan-cn.xiaomimimo.com/v1 |
| MIMO_MODEL | 可选 | 默认 mimo-v2.5 |
| MIMO_TIMEOUT_MS | 可选 | 默认 120000 |
| PORT / HOST | 可选 | 本地默认 8787 / 0.0.0.0 |

config.js 会读根目录 .env，但不覆盖已存在的环境变量，因此 Render 上的值优先。

---

## 3. 首次部署

1. 建 Supabase 项目，复制连接串。
2. Render → New → Web Service → 连接 GitHub 仓库 73mtq/quiz-platform → 分支 master。
3. Build Command 使用 npm install，Start Command 使用 npm start。
4. 环境变量加 DATABASE_URL。
5. 首次启动自动建表 quiz_data（含 data、practice、stats、revision、schema_version、updated_at）与 quiz_data_backups，不需要手工执行 SQL。
6. 灌数据：使用第 5 节的增量导入，或首次用 npm run migrate:to-db（整库覆盖）。

---

## 4. 日常发布

```bash
npm run check
npm test
npm run test:sql        # 需要 TEST_DATABASE_URL 指向一次性数据库
npm run build:ns-pages  # 修改静态页或内容时执行
git add -A && git commit -m "..."
git push origin master
```

推送后 Render 自动：拉取 → npm install → 重启进程。免费实例约 15 分钟无请求会休眠，休眠后第一个请求要 30 到 60 秒才返回；探测线上时超时给足 90 秒以上。

---

## 5. 数据变更

题库数据不在 git 里。部署代码不会动数据，改数据也不需要重新部署。

### 5.1 本地 JSON 模式

直接改 data/quiz-data.json 或用 npm run import:txt。写入走临时文件加 rename，并在 data/backups/ 保留最近 80 份；练习进度变化不写备份。

### 5.2 生产增量导入

走应用 API，不覆盖已有课程、不动现有练习进度：

```bash
# 1) 新建课程（新建后会自动设为 active）
curl -X POST https://<host>/api/courses -H 'content-type: application/json' --data-binary @course.json

# 2) 切回想要的课程
curl -X POST https://<host>/api/courses/active -H 'content-type: application/json' --data-binary @active.json

# 3) 批量导入题目，返回紧凑状态与 importResult
curl -X POST https://<host>/api/questions -H 'content-type: application/json' --data-binary @questions.json

# 4) 修正单题（不做去重校验）
curl -X POST https://<host>/api/questions/update -H 'content-type: application/json' --data-binary @update.json
```

中文必须走文件 body：Windows 控制台会把内联中文参数转成 GBK。用 Node 写 UTF-8 文件再 --data-binary @file。

### 5.3 去重规则

buildImportResult 用 OR 判断重复：seenIds、seen(fingerprint)、seenStems。最弱的一环是 stemKey（只看题干），同题干、不同选项或答案的两道题会被判重复。全量导入前先统计重复题干；必须导入时给题干加临时标记，导入后用 /api/questions/update 还原。

### 5.4 整库迁移

```bash
DATABASE_URL="postgresql://..." npm run migrate:to-db
```

脚本读 data/quiz-data.json，先备份当前行到 quiz_data_backups，再按三列布局写入 data、practice、stats，schema_version = 2，revision 加一，最后用 mergeState 回读比较。该操作会整库覆盖线上课程、题目与练习进度，只用于新库首次灌数据或确认要用本地数据覆盖全站。

执行前先导出完整状态：

```bash
curl -s --compressed https://<host>/api/state -o backup-$(date +%Y%m%d-%H%M%S).json
```

---

## 6. 验证上线

静态根是 frontend/，serveStatic 把请求路径 join 到 frontendDir：

- 只能探测 frontend/ 下的文件；
- 仓库根文件（README.md、docs/*、render.yaml）永远返回 404。

正确做法是内容哈希比对：

```bash
f=src/main.js
curl -s https://<host>/$f | sha256sum
git show HEAD:frontend/$f | sha256sum
```

两个哈希一致说明线上运行的是当前 HEAD。

接口自检：

```bash
curl -s --compressed -o /dev/null -w 'bootstrap %{http_code} %{time_total}s %{size_download}\n' https://<host>/api/bootstrap
curl -s --compressed -o /dev/null -w 'state %{http_code} %{time_total}s %{size_download}\n' https://<host>/api/state
```

预期：当前 290 题课程的 /api/bootstrap gzip 约 40KB，/api/state gzip 约 369KB；1,937 题课程的 /api/bootstrap gzip 约 211KB。

### 进度一致性比对

部署前导出 /api/state 快照，部署后执行：

```bash
node backend/src/scripts/migrate/verify-live-state.js https://<host> backup.json
# 或
API_URL=https://<host> npm run verify:live -- backup.json
```

脚本会比较课程数、题目数、activeCourseId、每门课程的 practice、每道题的 wrongCount、correctCount、bookmarked、review。部署期间如果自己继续答题，差异会包含新答题记录，先记录基线再比对。

---

## 7. 故障排查

| 现象 | 原因 | 处理 |
|------|------|------|
| 首页超时或 502 | 免费实例休眠冷启动 | 等 60 秒重试；不要急着重部署 |
| /api/state 500，错误含 tenant/user postgres.xxx not found | Supabase 项目暂停或删除 | 到 Supabase Dashboard 恢复项目；国家安全教育改用静态站 |
| 启动日志出现“题库文件解析失败” | JSON 文件损坏 | 保留原文件，从 data/backups/ 取最近可用副本 |
| 首次读取报迁移差异或直接 500 | 旧行结构异常 | 查看 quiz_data_backups；必要时 npm run restore:db 后回到旧版代码 |
| 页面能开但题库为空 | 新库首次启动只有默认课程 | 按 5.2 或 5.4 灌数据 |
| 写入返回 413 | 单请求体上限 20 MB | 分批导入 |
| 课程名或题干乱码 | shell 内联中文被转码 | 改用 UTF-8 文件加 --data-binary |
| 导入数量少于提交数量 | 同题干被去重 | 见 5.3 |
| 练习进度突然回到旧状态 | 多实例或直接改写数据库，revision 未递增 | 只通过应用 API 写入；重新加载页面 |
| 练习题状态不一致 | 迁移期间跨版本写入了旧结构 | 停止写入，恢复 quiz_data_backups，再按当前代码迁移 |

---

## 8. 数据恢复与代码恢复

### 数据恢复

迁移前整行保存在 quiz_data_backups。恢复到旧版单列布局：

```bash
DATABASE_URL="postgresql://..." npm run restore:db
```

恢复会按快照布局写回：旧版单列快照写回 data，把 practice 与 stats 置空，schema_version 回到 1；三列快照直接写回 data、practice、stats，schema_version 保持 2。revision 每次加一。新代码下次读取旧版快照时会再次自动迁移；如果新代码本身有问题，先通过文件编辑恢复上一版文件，再部署，然后执行恢复。

### 代码恢复

按照本项目的约定，通过文件编辑恢复上一版文件后重新推送，不使用 git reset 或 git revert 清理共享历史。

---

## 9. 安全与限制

- 无鉴权：知道地址的人都能增删改题库、切换课程。不要放敏感内容。
- 单实例加单行三列，写入在事务内 SELECT ... FOR UPDATE 串行化；不是多租户设计，不能水平扩多实例共同写入。
- 练习与答题只写 practice 或 stats；题库正文 data 不变时 PostgreSQL 可以复用其 TOAST 值。
- 数据库模式依赖 Supabase 自身备份；应用额外保留 quiz_data_backups 作为迁移快照。
- 本地 JSON 模式保留 data/backups/ 最近 80 份。

---

## 10. 国家安全教育静态站

入口：

- GitHub Pages：https://73mtq.github.io/quiz-platform/
- Render 静态镜像：https://quiz-platform-fbxp.onrender.com/national-security.html

页面是单个 HTML，不请求 /api/*，不连接数据库。render.yaml 保留 quiz-platform-static 的 Render Static Site 配置，可在 Render 控制台创建镜像站。

### 构建

```bash
npm run validate:ns
npm run build:ns-pages
```

该命令校验内容、生成 dist/national-security-quiz.html，并复制到 docs/index.html、frontend/national-security.html 以及对应的 legacy-progress.json。推送 origin/master 后 GitHub Pages 自动构建；Render 静态服务若已创建也会自动部署。

### 内容更新

1. 修改 content/national-security/explanations/batch-*.json。
2. npm run build:ns-content 合并成 content/national-security/course.json。
3. npm run validate:ns 校验 290 道题。
4. npm run build:ns-pages 更新静态产物。
5. 推送 origin/master。

### 进度

手机浏览器 localStorage，键为 national-security-quiz-progress-v1；导出进度与导入进度用于换手机和备份。清除浏览器站点数据会丢失进度。

题库哈希变化时，页面先按题目 ID 合并本地 practices 与 questionProgress，保留仍然存在的题目进度；只有完全无法匹配时才回退到内嵌初始进度。

页面顶部“导入旧版进度”读取同目录的 legacy-progress.json，把旧版 Supabase 记录的国家安全教育答题统计导入当前浏览器。该文件由旧 /api/state 通过 export-standalone-progress.js 生成：

```bash
node backend/src/scripts/migrate/export-standalone-progress.js \
  --state <state.json> \
  --content content/national-security/course.json \
  --course "国家安全教育" \
  --output <progress.json>
```
