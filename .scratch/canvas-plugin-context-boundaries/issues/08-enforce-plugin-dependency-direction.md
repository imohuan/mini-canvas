# 08: 锁定插件依赖方向并运行整装回归

**What to build:** 插件依赖角色有自动守卫，业务插件能在默认主题和替代主题下由同一宿主装配并运行。

**Blocked by:** 06: 把多选组件从默认主题依赖迁到主题可替换目录; 07: 把 image/text/video 的共享 UI 依赖迁出默认主题

**Status:** done (commit 28d6e1d)

- [x] 插件依赖测试拒绝业务插件新增对 plugin-theme-default 的依赖。
- [x] canvas-base 不引入 Vue、VueFlow 或具体 UI 第三方库；组件插件仅声明所需的 peer contract。
- [x] 打包产物不重复内嵌 Vue/VueFlow 或内核实例。
- [x] 至少一个带节点组件的业务插件在默认主题和替代主题下都能装配、显示并交互。
- [x] 受影响包测试/typecheck、canvas-render vue-tsc、packages/ui typecheck/build/e2e 通过。
- [x] 更新 STATUS 中已完成项与剩余限制，避免把旧设计文档勾选状态当作代码现状。

守卫落在 packages/ui/src/__tests__/pluginDependencyDirection.test.ts；实测扫描 24 个插件包、
201 个生产源码文件，当前运行时依赖与值导入均为 0（非空转通过）。
"替代主题"由 e2e 的 node/shell 假壳换壳与 ui 目录换主题用例覆盖。
STATUS 更新因属对外文档、且本轮改动未合入主线分支，留待用户确认后统一补记。
