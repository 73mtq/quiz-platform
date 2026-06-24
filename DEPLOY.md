# 部署指南：Render + 数据库

## 方案概述

- **Render**：免费托管 Node.js Web 服务（750h/月）
- **Render PostgreSQL** 或 **Supabase**：免费数据库，替代本地 JSON 文件
- 部署后手机浏览器直接访问，数据持久化不丢失

---

## 第一步：推送到 GitHub

```bash
git init
git add .
git commit -m "初始提交：刷题平台"
git branch -M main
git remote add origin https://github.com/你的用户名/quiz-platform.git
git push -u origin main
```

---

## 第二步：准备数据库（二选一）

### 方案 A：Supabase（推荐，永不休眠）

1. 打开 [supabase.com](https://supabase.com)，注册并登录
2. 点击 "New Project"，创建项目
3. 进入 Project Settings → Database → Connection string → URI
4. 复制连接字符串，格式类似：
   ```
   postgresql://postgres.xxxx:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
   ```
5. 保存好这个连接字符串，后面要用

### 方案 B：Render PostgreSQL（更简单，会休眠）

在第三步部署时，Render 会自动创建并绑定数据库，无需手动操作。
注意：免费数据库 90 天不活跃会过期。

---

## 第三步：在 Render 部署

1. 打开 [render.com](https://render.com)，用 GitHub 账号登录
2. 点击 "New" → "Web Service"
3. 连接你的 `quiz-platform` 仓库
4. 配置如下：
   - **Name**: `quiz-platform`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`

### 配置环境变量

在 Render 的 "Environment" 标签中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `DATABASE_URL` | 你的数据库连接字符串 | 如果用 Render PostgreSQL 可跳过 |
| `MIMO_API_KEY` | 你的 API Key | AI 图片识别功能 |
| `MIMO_BASE_URL` | `https://token-plan-cn.xiaomimimo.com/v1` | AI 接口地址 |
| `MIMO_MODEL` | `mimo-v2.5` | AI 模型名 |

5. 点击 "Create Web Service"，等待部署完成
6. 部署成功后会得到一个域名，类似 `https://quiz-platform-xxxx.onrender.com`

---

## 第四步：迁移已有数据（可选）

如果你本地已有题库数据，需要迁移到数据库：

```bash
# 设置数据库连接字符串
export DATABASE_URL="postgresql://..."

# 运行迁移脚本
npm run migrate:to-db
```

---

## 第五步：手机访问

用手机浏览器打开 Render 分配的域名即可刷题！

---

## 注意事项

### 免费版限制

- **Render Web Service**：免费 750h/月，15 分钟无请求后休眠，首次访问需等待 ~30 秒冷启动
- **Render PostgreSQL**：免费 500MB 存储，90 天不活跃会过期
- **Supabase**：免费 500MB 存储，永不休眠

### 本地开发

本地开发仍然使用 JSON 文件存储（无需 DATABASE_URL）：

```bash
npm start
# 输出: 📄 使用本地 JSON 文件存储
```

### 数据备份

- 本地模式：自动备份到 `data/backups/` 目录
- 数据库模式：建议定期导出数据（访问 `/api/export` 接口）

---

## 常见问题

### Q: 部署后访问很慢？
A: Render 免费版冷启动需要 30 秒左右，之后就正常了。如果用 Supabase 数据库，数据库不需要冷启动。

### Q: 数据会丢失吗？
A: 数据存在数据库里，不会丢失。但 Render 免费 PostgreSQL 90 天不活跃会过期，建议用 Supabase。

### Q: AI 图片识别不工作？
A: 检查 Render 环境变量中是否正确设置了 `MIMO_API_KEY`。

### Q: 怎么更新代码？
A: 推送到 GitHub 后，Render 会自动重新部署：
```bash
git add .
git commit -m "更新功能"
git push
```
