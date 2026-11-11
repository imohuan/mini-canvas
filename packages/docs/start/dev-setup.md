# 本地开发环境

5 分钟把仓库跑起来。跑通之后再去 [极简实战](/start/quickstart-fullstack) 写插件。

## 前置要求

| 工具 | 版本 | 检查 |
| --- | --- | --- |
| Node.js | ≥ 20 | `node -v` |
| pnpm | ≥ 9 | `pnpm -v` |

## 装依赖、起后台

```bash
pnpm install                                  # 仓库根目录执行一次
pnpm -C packages/cloud-server serve --trusted-origin http://localhost:5288
```

看到「plume-canvas 已启动」就起来了。后台同时托管画布界面，手动打开
`http://127.0.0.1:8865/`（默认不自动弹浏览器）。

`--trusted-origin` 不能省：后台默认只信任自己的 :8865，开发页（:5288）的保存 /
删除等写操作会被来源边界挡下，返回 `403 请求来源不受信任`。启动日志会打印
「额外 Origin:」，可以据此确认有没有写进去。换成别的开发端口（例如 :5289）时，
把这条改成对应地址，或设环境变量 `PLUME_TRUSTED_ORIGINS=http://localhost:5289`。

### 端口被占用

CLI 会**自动往后找**下一个可用端口（8866、8867…），以启动时打印的地址为准。
想钉死端口：`npx plume-canvas serve -p 8865`。

### 数据落在哪

默认在仓库根的 `.plume/`（可用 `-d` 换）:

```
.plume/
├── canvases/         画布本体（节点+边+视口）
├── assets/           资源库（上传的图/视频字节）
├── kv/               小数据（设置、快捷键映射）
├── providers/        平台提供方（生成任务执行器）
├── server-plugins/   后台插件目录（丢 .js 进去即生效）
└── plugin-data/      各后台插件的私有存储
```

## 起前端热更新（改画布界面时才需要）

后台托管的是**打好的** ui 产物。要边改边看，另开一个终端：

```bash
pnpm -C packages/ui dev                       # :5288，画布界面热更新
```

注意 :5288 与后台不同源；仓库已在 `packages/ui/vite.config.ts` 配好 `/api` 代理指向 :8865。
日常写插件用 :8865 就够；只有改 ui 本身才起这个。

## 常用命令速查

| 命令 | 干什么 |
| --- | --- |
| `pnpm -C packages/cloud-server serve --trusted-origin http://localhost:5288` | 起后台 + 画布，并放行开发页（**日常就用这个**） |
| `pnpm -C packages/ui dev` | 前端热更新（改 ui 时用） |
| `npx plume-canvas list-tools` | 列出 MCP 暴露的工具 |
| `pnpm -C packages/cloud-server test` | 后台测试 |
| `pnpm -C packages/ui test` | 前端应用测试 |

## 下一步

环境就绪 → [★ 极简实战：前后端一起写一个插件](/start/quickstart-fullstack)。
