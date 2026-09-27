# 07: 把 image/text/video 的共享 UI 依赖迁出默认主题

**What to build:** 图像、文本和视频节点插件都从可替换 UI 目录取得标准控件，不再把默认主题包当作运行时组件库；三个包分别验证，任意一个失败都能单独回退。

**Blocked by:** 05: 让默认主题通过渲染契约消费宿主能力

**Status:** done (commit 5cb5310)

- [x] plugin-node-image 生产组件继续通过主题可替换目录读取 button、select 和 toolParamField；生产源码、测试、bundle external 和 package.json 不再把 plugin-theme-default 当作组件实现来源；image test、typecheck、build 通过。
- [x] plugin-node-text 生产组件继续通过主题可替换目录读取 button、select 和 toolParamField；生产源码、测试、bundle external 和 package.json 不再把 plugin-theme-default 当作组件实现来源；text test、typecheck、build 通过。
- [x] plugin-node-video 生产组件继续通过主题可替换目录读取 button、select 等当前使用的设计系统件；package.json 不再对 plugin-theme-default 声明直接依赖；video test、typecheck 通过。
- [x] 三个插件的测试都经真实 UI 目录注册或独立 fixture 提供控件，不从默认主题包偷 import 实现。
- [x] 图像、文本、视频的工具栏、生成面板、编辑/剪辑交互保持原有行为。

三个包 test 分别 137 / 65 / 105 全绿；image 与 text build 通过；官方 e2e 40/40。
