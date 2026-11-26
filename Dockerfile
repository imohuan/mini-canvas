# plume-canvas 自托管部署镜像（Railway / 任意容器平台）
#
# 不在镜像里重新构建工作区（35 个插件的 vite 构建太慢），直接装 npm 发布包：
# 首次启动时 bootstrap 会自动从 npm 下载画布界面与全部内置插件到数据目录。
# 数据目录挂持久卷（Railway 上挂 /data），重启不丢数据。
FROM node:22-alpine

# 版本号必须写成一个会变的 ARG：Docker 按「命令字符串」做层缓存，
# 直接写 @plume-canvas/server 时发新版本后字符串没变，构建会命中原层，
# 容器里永远是第一次装的那个版本（实测：发了 0.1.5，容器仍是 0.1.4）。
# 每次发版把这个值一起改掉（和 apps/server/package.json 的 version 保持一致）。
#
# 发版请用 pnpm publish（不能用 npm publish）：package.json 里有
# "@plume-canvas/plugin-agent": "workspace:*"，npm 会原样发出去导致装不上，
# pnpm 才会把它替换成真实版本号。完整流程见 apps/docs/cloud-server/deploy-railway.md。
ARG PLUME_VERSION=0.1.27
RUN npm install -g @plume-canvas/server@${PLUME_VERSION}

ENV NODE_ENV=production
EXPOSE 8865

# --host 0.0.0.0  必须监听所有网卡，容器外才能访问
# -d /data        数据目录（画布/插件/KV/上传全在这里，挂卷）
# --trusted-host  Railway 的公网域名（Host 白名单，不带端口；没绑域名时回落 localhost）
CMD plume-canvas serve --host 0.0.0.0 -p ${PORT:-8865} -d /data \
  --trusted-host ${RAILWAY_PUBLIC_DOMAIN:-localhost}
