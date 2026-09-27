# 01: 统一主题与节点区域注册事实源

**What to build:** 插件注册、替换、手动撤销或卸载后，主题槽和节点区域在所有读取入口中都呈现同一结果，顺序和所有者保持一致。

**Blocked by:** None (can start immediately)

**Status:** done (commit c50b108)

- [x] 主题与节点区域各只有一条权威写入路径；旧读取接口由同一状态适配。
- [x] theme register/add/remove 对 id、order、source、替换、返回值和自动回收使用一致语义。
- [x] nodes.contribute 对显式 order 使用同一个解析结果，不因兼容表而显示不同顺序。
- [x] 通过插件级测试覆盖默认条目、替换、手动 dispose、scope unload、回退和重复 dispose。
- [x] 现有主题选择、节点区域渲染和既有测试行为保持不变。

实测修正：原审查称"卸载后注册场留幽灵条目"未复现 —— 插件作用域视图本就随 fiber 自动回收。
真实缺陷是 theme.add 只写 ThemeRegistry、theme.remove 只删 ThemeRegistry（两处读数不一致），
以及 contribute 在场里忽略显式 order。已在同一提交修复。
