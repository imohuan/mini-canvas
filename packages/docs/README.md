# @mini-canvas/docs

mini-canvas 的文档站。用 MD 写文档，并额外做两件事：

1. **插件功能展示** —— 扫 packages/plugins/*/package.json，自动列出每个插件注册了什么。
2. **组件预览** —— 在文档页面里直接跑真实 Vue 组件，点开就能看。

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
| 让某个插件出现在功能表 | 该插件的 package.json 里声明 miniCanvas.title/description + builtin 或 installable |
| 让文档能预览某个组件 | .vitepress/theme/preview-registry.ts 加一条 |
| 调站点外观/导航 | .vitepress/config.ts 与 .vitepress/theme/styles.css |

## 目录

```
packages/docs/
├── index.md                     首页
├── guide/                       指南
├── plugins/                     插件功能列表
├── preview/                     组件预览台
└── .vitepress/
    ├── config.ts                站点配置
    ├── data/plugins.data.ts     构建期扫插件，生成列表
    └── theme/
        ├── index.ts             注册全局文档组件
        ├── preview-registry.ts  组件预览登记表
        └── components/          表格 / 预览台 / 运行时能力面板
```

## 两个预览组件的区别

- ComponentPreview：内联跑一个组件，要求它能单独渲染。
- ComponentPreviewFrame：用 iframe 嵌一个整页，适合必须完整宿主才能跑的界面。
