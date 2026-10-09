# @mini-canvas/docs

mini-canvas 的**插件系统文档站**。讲清三件事：

1. **项目逻辑** —— 三层怎么分工、插件系统有哪些原语、注册场怎么让"加功能不用加服务"。
2. **核心 API** —— 服务清单、注册场清单、语法糖、命令、自省。
3. **看得见的数据** —— 「活快照」页直接读运行中画布的 `ctx.surface()`，
   谁注册了什么当场看得到，不是手写的。

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
| 调站点外观/导航 | .vitepress/config.ts 与 .vitepress/theme/styles.css |

## 目录

```
packages/docs/
├── index.md                     首页
├── intro/                       项目介绍（是什么 / 三层 / 七个原语 / 注册场 / 生命周期）
├── core/                        核心 API（总览 / 自省）
├── plugins/                     插件（总览 / 活快照 / 默认主题 / 渲染宿主）
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
