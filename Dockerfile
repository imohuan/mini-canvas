# plume-canvas 自托管部署镜像（Railway / 任意容器平台）
#
# 不在镜像里重新构建工作区（35 个插件的 vite 构建太慢），直接装 npm 发布包：
# 首次启动时 bootstrap 会自动从 npm 下载画布界面与全部内置插件到数据目录。
# 数据目录挂持久卷（Railway 上挂 /data），重启不丢数据。
FROM node:22-alpine

RUN npm install -g @plume-canvas/server

ENV NODE_ENV=production
EXPOSE 8865

# --host 0.0.0.0  必须监听所有网卡，容器外才能访问
# -d /data        数据目录（画布/插件/KV/上传全在这里，挂卷）
# --trusted-host  Railway 的公网域名（Host 白名单，不带端口；没绑域名时回落 localhost）
CMD plume-canvas serve --host 0.0.0.0 -p ${PORT:-8865} -d /data \
  --trusted-host ${RAILWAY_PUBLIC_DOMAIN:-localhost}
