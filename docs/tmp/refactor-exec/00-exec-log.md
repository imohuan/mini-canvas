# 重构执行记录（更新 3 · 全部主里程碑完成）

## 全部完成 + 已 commit + Chrome 验证
1. 内核 ThemeRegistry + registerThemeSlot（外观槽位）。5 测试。
2. plugin-theme-default 主题插件：DefaultEdge / DefaultBackground / ThemeShell(node 外壳+真实端口)。
3. demo(CanvasDemo) 经 themeRegistry 装配：nodeShell/edge/background 全来自主题插件。
   Chrome(5199)：节点全 .theme-shell、端口可连、content 正常、背景随画布动。
4. **插件打包单文件**：text/image/theme 三包用 cssInjectedByJs，dist 只出一个 .js（css 内联）。
   text 3.08kB / image 2.17kB / theme 6.05kB，均无独立 .css。
5. **plugin-load demo**(/plugin-load.html)：宿主动态加载打包好的 UMD js 插件。
   Chrome 全链路：空宿主→载 UMD→installPlugin('text')→addTextNode→uninstall 回收 type，通过。
6. **theme 插件独立预览页**：pnpm dev 起 5310，自建 host 渲染主题壳/边/背景 + 示例连边。
   Chrome(5310)：themeShells 2 / themeEdge 1 / themeBg true / handles 4，无双 vue。

## 测试/tsc
121 测试全绿；内核 + 三插件(text/image/theme) tsc 干净。

## 关键架构事实
- 单例 = vue + @vue-flow/core + 内核，判断=同一份模块文件。
- 宿主单一 dev server 用 workspace import(单例)；打包插件用 UMD + 宿主喂 window.Vue/MiniCanvasCore 全局。
- 主题插件把壳/端口/边/背景整套换成自己的 vue 组件，宿主只读 themeRegistry 装配。

## 验证命令
- 主 demo: cd packages/canvas-core-v2 && node ./node_modules/vite/bin/vite.js  (5199)
- 主题自看: cd packages/plugins/plugin-theme-default && node ../../canvas-core-v2/node_modules/vite/bin/vite.js --config vite.demo.config.ts  (5310)
- 加载 UMD: 打开 http://localhost:5199/plugin-load.html（先 cd plugin-node-text && pnpm build 再复制 dist 到 demo-web/plugins/）
- 测试: cd packages/canvas-core-v2 && node ./node_modules/vitest/vitest.mjs run
