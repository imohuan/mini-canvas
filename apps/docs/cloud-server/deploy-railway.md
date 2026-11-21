# 部署到 Railway（云托管）

**一句话定位**：把 plume-canvas 发布到公网，让任何人打开一个网址就能用画布。
这篇用 Railway 做例子（免费额度可用），思路同样适用于 Render、Fly.io 等其它
「常驻进程 + 持久磁盘」的平台。它属于 cloud-server 组。

## 为什么不能选 Vercel 这类 Serverless 平台

cloud-server 是一个**长期运行的 Node 进程**，数据直接写在磁盘目录：
画布、插件产物、上传的图片视频都落在 `<数据目录>` 下。

Vercel 这类 Serverless 函数「用完即销毁、磁盘只读」——这次请求写的文件，
下次请求就没了；SSE 长连接、Agent 后台任务也需要常驻进程。
所以要选支持**常驻容器 + 持久卷**的平台。

## 部署前要有

- 一个 npm 包 `@plume-canvas/server`（服务启动时会自动从 npm 拉界面与插件）；
- 一个 GitHub 仓库（Railway 从它拉代码构建）；
- Railway 账号（免费档：前 30 天 $5 额度，之后每月 $1，不用绑卡）。

## 第 1 步 · 写 Dockerfile

在仓库根目录建一个 `Dockerfile`：

```dockerfile
FROM node:22-alpine

RUN npm install -g @plume-canvas/server

ENV NODE_ENV=production
EXPOSE 8865

CMD plume-canvas serve --host 0.0.0.0 -p ${PORT:-8865} -d /data \
  --trusted-host ${RAILWAY_PUBLIC_DOMAIN:-localhost}
```

逐行解释：

| 写法 | 为什么 |
| --- | --- |
| `npm install -g @plume-canvas/server` | 镜像里装服务本体。**不在镜像里重新构建整个工作区**（三十多个插件的 vite 构建会撞平台构建时限）；服务首次启动会自动从 npm 拉界面和 24 个内置插件 |
| `--host 0.0.0.0` | 容器里的服务必须监听所有网卡，外部才访问得到（默认 127.0.0.1 只有容器自己能连） |
| `-p ${PORT:-8865}` | Railway 会注入 `PORT` 环境变量（8080 之类）；没注入时用默认 8865 |
| `-d /data` | 数据根目录固定指到 /data——下一步把持久卷挂在这里 |
| `--trusted-host ${RAILWAY_PUBLIC_DOMAIN:-localhost}` | 把公网域名加进 Host 白名单，见下节 |

### 为什么要配 `--trusted-host`

后台对每个请求都会校验 `Host` 头与 Origin 来源（防伪造请求，见
[管理鉴权与请求边界](/cloud-server/admin-auth)）。容器里跑的服务出厂只认识
`localhost`，但浏览器访问的是 `xxx.up.railway.app`——这个域名不在白名单里，
所有请求都会被 403 拒掉。`--trusted-host` 就是告诉服务「这个域名是你自己的合法名字」。

`RAILWAY_PUBLIC_DOMAIN` 是 Railway 自动注入的环境变量（你的公网域名），
所以不用写死；换域名也不用改 Dockerfile。

## 第 2 步 · Railway 建项目

1. 打开 railway.com/dashboard → **New** → **GitHub Repository**；
2. 粘贴仓库地址（如 `https://github.com/<你>/mini-canvas`）→ Deploy Repo；
3. Railway 自动检测根目录 Dockerfile 并构建，构建成功服务自动上线。

## 第 3 步 · 生成公网域名

1. 服务 → Settings → Networking → **Generate Domain**；
2. 目标端口填服务实际监听的端口。

注意：Railway 默认会注入 `PORT=8080`，Dockerfile 里 `-p ${PORT:-8865}` 会用它，
所以目标端口通常填 **8080**。填错端口的表现是域名返回 502——服务在跑，
但域名指错了门牌号。

改完 Settings 里的任何配置，Railway 6 是「暂存变更」模式：
要点页面顶部的「应用更改 → 部署」才真正生效。

## 第 4 步 · 挂持久卷

容器有个特点：**每次重启，容器里写的文件全部消失**，恢复成镜像最初的样子。
而画布数据、插件、上传的图片都存在磁盘上——不挂卷的话，重启一次全部清零。

持久卷是平台提供的一块「外挂硬盘」：容器重启、重新部署、甚至换机器，卷上的内容都还在。

操作：回项目画布 → 右键服务节点 → 添加 → **体积（Volume）** → 挂载路径填
`/data`（和 Dockerfile 的 `-d /data` 对上）→ 应用更改 → 部署。

挂载完成后，`-d /data` 写的所有数据（`canvases/`、`plugins/`、`kv/`、
`providers/`、`ui/`）都落在卷上，重启不丢。

## 第 5 步 · 设置登录密码

后台默认开启登录鉴权。**首次设置密码只允许在容器内操作**（防止公网上任何人
抢先把密码设成自己的），所以要用 Railway 的 SSH 进容器内部完成：

```bash
railway login                          # 浏览器授权
railway link                           # 关联项目（选你的项目 / 环境 / 服务）
railway ssh keys add                   # 注册本机 SSH 公钥
```

然后从容器内部调用设置接口（注意服务监听的是 8865 还是 8080，看启动日志）：

```bash
ssh -o IdentitiesOnly=yes -i ~/.ssh/<你的密钥> <user>@ssh.railway.com node -e \
  "fetch('http://127.0.0.1:8865/api/auth/setup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'你的密码至少5位'})}).then(r=>r.text()).then(console.log)"
```

返回 `{"ok":true}` 即成功。之后打开网站，输入这个密码登录即可。

> 这一步的体验确实不友好（要装 CLI、配 SSH）。规划中的改进（见仓库
> docs/问题整理/41）：部署平台环境变量 `PLUME_INITIAL_PASSWORD` 预置初始密码——
> 落地后只需在 Railway 的 Variables 里加一个变量重启，不再进容器。落地后这篇会更新。

## 第 6 步 · 验证

打开分配的域名（如 `https://xxx.up.railway.app`），应该看到登录面板；
输入刚设的密码进入画布。也可以命令行验证：

```bash
curl https://xxx.up.railway.app/health          # {"ok":true}
curl https://xxx.up.railway.app/api/auth/status # {"configured":true,...}
```

## 免费额度的账怎么算

Railway 免费档每月 $1 使用额度，按秒计费：

- **服务睡眠**：免费档的服务空闲 5～10 分钟后自动睡眠，下一个请求唤醒（几十秒）。
  睡眠期间不计费；
- **但画布页面常开时**，前端有一条 `/api/kv/events` SSE 长连接，Agent 也有后台任务——
  这类持续流量会让服务一直醒着。按内存计费（约 $10/GB·月），一个 100～300MB 的
  Node 进程一个月就是 $1～$3，**会超出免费额度**，超出后服务暂停到下月；
- 想稳定在线：升级 Hobby（$5/月，含 $5 额度，服务始终在线）。
- 省钱姿势：不用时关掉画布页面，让服务睡眠。

## 自动部署

Settings → Source → **Enable** Auto deploy 之后，`git push` 到主分支就会自动
重新构建发布。不开启的话，去 Deployments 页手动 Redeploy。

## 常见坑

1. **域名 502**：九成是 Target port 和服务实际监听端口对不上。看部署日志里
   `plume-canvas 已启动` 下面打印的 `http://0.0.0.0:xxxx/`，域名就指这个端口；
2. **改了 Settings 不生效**：Railway 6 的改动是暂存的，要点「应用更改 → 部署」；
3. **重启后数据没了**：检查卷是否挂载成功（服务节点旁边应出现卷节点），挂载路径
   必须是 `/data`；
4. **页面能打开但请求全 403**：Host 白名单少了公网域名。检查 Dockerfile 的
   `--trusted-host ${RAILWAY_PUBLIC_DOMAIN}`；手动加的话格式是**不带端口**的裸域名；
5. **首次设置密码报「只允许在本机操作」**：这是安全设计不是 bug，按第 5 步进容器设置；
6. **构建超时**：别把整个工作区搬进 Docker 构建（35 个插件构建 10 分钟打底），
   用 npm 包形态。

## 源码出处

| 这篇里的说法 | 真实文件 | 真实行为 |
| --- | --- | --- |
| `--trusted-host` 加入白名单 | `apps/server/src/server.ts`（fillTrustedHosts） | 追加进 trustedHosts 数组，requestTrust 中间件校验 |
|`-d` 数据根目录 | `apps/server/src/server.ts`（DEFAULT_DATA_DIR） | 画布/插件/KV/providers 都落在它下面 |
| 首次启动装插件与界面 | `apps/server/src/updater/bootstrap.ts` | 读 builtin-manifest 从 npm 拉缺失件 |
| 首次设置密码限本机 | `apps/server/src/routes/auth.ts`（authRoutes 的 isLocal） | 回环 + Host 回环 + 无转发头三重判定 |
| 登录 / 会话 | `apps/server/src/authAccount.ts`、`authSession.ts` | 哈希落 auth.json，HttpOnly cookie 30 天 |
| 恢复令牌 | `apps/server/src/adminAuth.ts` | 数据目录 admin-token 或 PLUME_ADMIN_TOKEN，忘记密码时用 |
