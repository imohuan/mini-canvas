# PenguinHarness 默认密码存储位置调查

调查对象：`github.com/Prism-Shadow/penguin-harness`（主仓库，最新版 0.2.8）
调查方式：git clone 本地检索 + 源码分析

## 结论

### 1. 没有明文"默认密码"（0.2.8 起，2026-08-24 之后）
新版取消了固定 seed 密码，改成**首次登录链接（claim link）**：
- 服务器每次启动打印一个一次性 claim 链接 `http://localhost:7364/api/auth/claim?token=...`
- 打开链接 → 设置密码 → 之后用密码登录
- 链接仅在服务器"未认领"状态有效，重启会换新

### 2. 密码存哪（重点）
- 文件：**`~/.penguin/data/web.db`**（SQLite 数据库）
- 表：**`users`** 表，字段 **`password_hash`**
- 存储格式：**scrypt 哈希**，不是明文
  - 格式 `scrypt$N$r$p$salt$hash`
  - N=16384, r=8, p=1, salt 16 字节, key 64 字节
  - 每个密码独立 salt，验密用 timingSafeEqual
- 会话：`auth_sessions` 表，存 session token 的 **sha256**（不是 token 本身）

### 3. 旧版固定默认密码（0.2.8 之前）
- `PENGUIN_SEED_ADMIN_PASSWORD` 环境变量未设置时，打印 `penguin-<4位数字>`
- 升级到新版后，数据根里遗留的 `initial-admin-password` 明文会被删除

### 4. 相关文件位置（`~/.penguin/data` 根，可用 `PENGUIN_HOME` 覆盖）
| 文件 | 内容 |
| --- | --- |
| `web.db` | 密码哈希、会话哈希、应用数据（永久） |
| `<project>/.project_config.toml` | Model API 密钥，明文，mode 0600（注意：这是 API 密钥，不是登录密码） |
| `cli-session.json` | 一条有效 CLI 会话令牌，mode 0600 |

### 5. 找回/重置密码
- 忘记密码：服务器机器上停服后跑 `penguin server reset-admin-password`，回到未认领状态，下次启动重新打印 claim 链接

## 关键源码
- `packages/server/src/db/repos/users.ts` — users 表 CRUD，password_hash 字段
- `packages/server/src/auth/password.ts` — scrypt 哈希逻辑
- `packages/core/src/state/paths.ts` — resolveRoot() = PENGUIN_HOME 或 ~/.penguin/data
- `packages/server/src/config.ts` — PENGUIN_WEB_DB 覆盖 web.db 路径
- `packages/docs/content/security.en.md` — 安全模型文档（权威）
- `changelog/0.2.8/2026-08-24-penguin-auth.md` — 认证变更记录
