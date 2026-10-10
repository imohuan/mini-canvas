# @mini-canvas/docs

mini-canvas 的**插件系统文档站**。四类：

1. **入门** —— 从这是什么到动手写出前后端各一个插件，再深挖内核/数据层/渲染层/主题/后台。
2. **示例** —— 9 个可照抄的插件案例（含完整上下文与逐行注释）。
3. **插件** —— 插件总览、活快照（读运行中画布的真数据）、核心插件与桥接插件。
4. **API** —— **纯 API 参考**：前端服务（每篇只有签名表 + 用法 + 注意事项）、
   `ctx` / 注册场、后端 cloud-server 的 `routes` / `store` / `jobs` / `mcp` / `agent`。

## 跑起来

```bash
pnpm -C packages/docs dev      # 本地预览（:5290）
pnpm -C packages/docs build    # 打静态站
pnpm -C packages/docs preview  # 预览静态站（:5291）
```

## 怎么加东西

| 想做什么 | 去哪改 |
| --- | --- |
| 写一篇文档 | 在对应目录新建 .md；想让菜单出现就改 .vitepress/config.ts 的 sidebar |
| 让某个插件出现在总览表 | 该插件的 package.json 里声明 miniCanvas.title/description + builtin 或 installable |
| 让文档能内联预览某个组件 | .vitepress/theme/preview-registry.ts 加一条 |
| 给某个内置服务写文档 | 在 services/ 新建 <服务名>.md，按 API 两节结构（一句话定位 + 用法表 + 注意事项）写；文件头路径用相对路径，别指向不存在的 public/examples |
| 更新活快照的真实数据 | 在跑着画布应用的页面点「重新采集」，用它覆盖 public/surface-snapshot.json |
| 调站点外观/导航 | .vitepress/config.ts 与 .vitepress/theme/styles.css |

## 目录

```
packages/docs/
├── index.md                     首页
├── intro/                       项目介绍（是什么 / 三层 / 七个原语 / 注册场 / 生命周期）
├── api/                         API 参考（总览 / ctx / 注册场 / 后端 cloud-server 6 篇）
├── core/                        前端 API 清单 / 自省
├── services/                    前端服务（15 个服务，每个一篇：签名表 + 用法 + 注意事项）
├── plugins/                     插件（总览 / 活快照 / 默认主题 / 渲染宿主）
├── public/
│   ├── surface-snapshot.json    真实采集的自省快照（活快照 / 服务分布用它）
│   └── examples/                服务文档里“完整例子”的配套源码
└── .vitepress/
    ├── config.ts                站点配置
    ├── data/plugins.data.ts     构建期扫插件，生成列表
    └── theme/
        ├── index.ts             注册全局文档组件
        ├── preview-registry.ts  组件预览登记表
        └── components/          SurfaceReport（活快照）/ 插件总表 / 预览台
```

## 文档专用组件

- `<SurfaceReport/>`：**活快照**。调 `window.MiniCanvasUI.getContext().surface()`
  或后台接口，把当前画布的注册情况画成表格。这是"看不见的文档"变成"看得见"的桥。
- `<PluginCapabilityTable/>`：按插件 `package.json` 的声明列出全部插件。
- `<ComponentPreview/>` `<ComponentPreviewFrame/>`：在页面里跑真实组件 / 嵌整页。

## 活快照的数据从哪来

优先读组件 prop 给的 `url`（后台/MCP 把 `surface()` 转成 JSON 下发）；
没有 `url` 时退回读同源运行中的应用。两条路都读不到时只显示一句提示，页面照常。

## 两个预览组件的区别

- ComponentPreview：内联跑一个组件，要求它能单独渲染。
- ComponentPreviewFrame：用 iframe 嵌一个整页，适合必须完整宿主才能跑的界面。
