# backup/canvas-ui

老版画布的独立 UI 入口，配合上一级的 `canvas-core` 使用。

原来的根目录 `src/`、`index.html`、`vite.config.ts`、`tsconfig*.json`
和 `public/vite.svg` 都迁到了这里。导入老核心时使用相对路径
`../../canvas-core/src`，所以这里不依赖 pnpm workspace。

这个目录是历史备份，不参与主项目构建。以后如果要单独跑它，需要准备
`prosemirror-editor-bundle` 和 `vue-sonner` 两个依赖，并在本目录执行
`pnpm install` 和 `pnpm dev`。目前它作为源码备份保留，方便对照老界面。
