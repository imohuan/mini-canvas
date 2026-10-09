# 指南

这个文档站只做三件事，每件都尽量简单。

1. **写文档**：用 MD 文件写，和平时写笔记一样。
2. **列功能**：每个插件注册了什么，自动列出来，不用手抄。
3. **看组件**：文档里能直接跑真实组件，不用切到别的应用。

## 怎么跑起来

```bash
pnpm -C packages/docs dev      # 本地预览，改文件立刻刷新（:5290）
pnpm -C packages/docs build    # 打出静态站点（dist/）
pnpm -C packages/docs preview  # 预览打好的静态站（:5291）
```

## 目录长什么样

```
packages/docs/
├── index.md                    # 首页（带大标题那种）
├── guide/                      # 指南（你现在看的）
├── plugins/                    # 插件功能列表
├── preview/                    # 组件预览台
└── .vitepress/
    ├── config.ts               # 站点配置（导航、侧边栏）
    └── theme/                  # 自定义主题
        ├── components/         # 文档专用组件（表格、预览台…）
        ├── data/               # 构建期数据（扫插件生成列表）
        └── preview-registry.ts # 组件预览登记表
```

## 下一步看哪里

- 想写文档：[怎么写文档](/guide/writing-docs)
- 想预览组件：[怎么预览组件](/guide/component-preview)
- 想看全部插件：[插件功能](/plugins/)
- 想看运行时能力：[运行时能力](/plugins/runtime-capabilities)
