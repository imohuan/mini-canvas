# plugin-clipboard

## 一句话

复制/粘贴/剪切/复制一份，走“内存快照 + 系统剪贴板载荷 + 注册场仲裁”三条路。它是本组里对宿主与其它插件契约依赖最深的插件。

## 清单

| 项 | 值 |
|---|---|
| 包名 | @mini-canvas/plugin-clipboard |
| 身份 | builtin |
| 源码文件 | 4 个（plugin 531 行 / engine 397 行 / index / env.d.ts） |
| 测试文件 | 2 个，43 个用例 |
| 包依赖的其他插件 | 无 |

## 跨包 import

| 目标 | 入口 | 是否公开出口 | 证据 |
|---|---|---|---|
| canvas-base | Service / Context / PluginModule / registerEventName | 是 | src/clipboardPlugin.ts:18-19 |
| canvas-data | 类型 + 剪贴板载荷工具（CANVAS_CLIPBOARD_MIME/PREFIX、parse、注册场 kind） | 是（公开出口） | 同上:20-36 |
| 其他插件 | 无 | — | 全 src 无 plugin- import |

没有 L3 代码级 import。与 file-drop 的协作通过 canvas-data 的注册场完成，契约住在上游，这是正确方向。

## 运行时协作

| 依赖 | 方式 | 必需/可选 | 证据 |
|---|---|---|---|
| doc | inject + get，transaction/nextNodeId/nextTypeName | 必需 | src/clipboardPlugin.ts:88、118-120、323-356 |
| selection | inject + get，ids/set/clear/clearEdges | 必需 | 同上:88、116、147、359-360、385 |
| viewport | tryGet，screenToFlow | 可选 | 同上:123、405-409 |
| nodeLayout | tryGet，absolutePosition | 可选 | 同上:134-139 |
| resources | tryGet，resolve | 可选 | 同上:302-314 |
| clipboard/copy|cut|paste 注册场 | order 10 | — | 同上:442-479 |
| 事件 | clipboard:copy / cut / paste | — | 同上:92-94、160、361、386 |
| 命令 | mod+c / mod+v / mod+x / mod+d | — | 同上:482-527 |

关键跨插件契约是与 plugin-file-drop 的粘贴仲裁顺序。注册场按 order 升序问处理器，第一个接管的赢（packages/kernel/src/registry/registry.ts:14、228-242）。实际数值是 clipboard 10（src/clipboardPlugin.ts:449、458、478）、file-drop 媒体 20、纯文本 30（packages/plugins/plugin-file-drop/src/fileDropPlugin.ts:426-427），所以 clipboard 先被问；它在没有画布载荷/标记时返回 false 让位（src/clipboardPlugin.ts:463-477），外部媒体才落到 file-drop。这条链能工作，依赖“clipboard 必须继续在无载荷时返回 false”这一隐式约定。

注释漂移：packages/canvas-render/src/host/CanvasHost.vue:1095 写的是“file-drop 的图片/视频(10) > clipboard 的内存节点(20) > file-drop 的纯文本(30)”，方向与实际代码相反；packages/canvas-data/src/canvas/clipboardActions.ts:31-34 才是对的。两处注释不一致会让后来者按错的方向调 order。

另一条契约是画布载荷格式：CANVAS_CLIPBOARD_MIME 与 text/plain 前缀由 canvas-data 定义（src/clipboardPlugin.ts:20-36），parseCanvasClipboardText/readCanvasClipboardPayload 也来自上游。跨页面粘贴依赖这份格式；格式升级必须同时兼容旧载荷，否则旧剪贴板内容粘贴失败。

## 全局与宿主粘连

| 对象 | 用途 | 风险 | 证据 |
|---|---|---|---|
| window pointermove | 记录粘贴锚点 | 中，全局监听 | src/clipboardPlugin.ts:430-431 |
| .vue-flow | 判断指针是否在画布内 | 中，VueFlow 类名 | 同上:424-428 |
| navigator.clipboard.writeText/readText | 程序化读写系统剪贴板 | 中，权限/安全上下文 | 同上:188-196、231-244 |
| HTMLElement.closest('input, textarea, select, [contenteditable]') | 跳过可编辑目标 | 低 | 同上:97-100 |
| 无定时器 / 无 localStorage | — | 无 | 本包 src 检索为空 |

## 内部职责与风险

531 行入口承担了：服务实现、系统剪贴板读写、跨页面媒体重建、注册场接线、命令注册、鼠标锚点跟踪。引擎 397 行负责快照、坐标、id 重映射、改名。分层清楚，但入口偏重。

三个真实风险：

1. 系统剪贴板是跨插件/跨页面共享资源。clipboard 写 text/plain 前缀载荷（src/clipboardPlugin.ts:179-197），可能覆盖用户从别处复制的文本；读取时靠前缀解析，解析失败就静默放过（:242-244）。
2. 粘贴外部载荷时媒体地址重建是异步的，但 pasteExternal 先返回 true 再异步落节点（src/clipboardPlugin.ts:273-283）。调用方（宿主仲裁）会认为已接管并 preventDefault，若随后重建失败，用户看到“没反应”。这是可接受的取舍，但需要文档说明。
3. 事件 clipboard:copy/cut/paste 已 registerEventName（:92-94），但全仓未发现消费方；属于预留广播，增加表面积。

## 单独装卸判断

可独立装卸。不装时 Ctrl+C/V 回到浏览器默认，file-drop 仍能处理媒体粘贴。装了会接管画布选中集的复制粘贴，并写系统剪贴板。与 file-drop 的优先级靠 order 数值维持，任一方改动都会改变行为。multi-select 的“框选后复制”依赖本插件命令存在（packages/ui/src/composables/ui.ts:2188-2199 走 clipboard:duplicate），未装时该菜单项静默无操作。

## 建议改法

1. 最小改动：把仲裁 order 提成 canvas-data 的公开常量（如 CLIPBOARD_ORDER），file-drop 与 clipboard 共同引用，消掉 10/20/30 的魔法数字；同时修正 CanvasHost.vue:1095 的注释方向。
2. 把 clipboard:copy/cut/paste 三个事件要么补消费方与文档，要么删掉，减少无用广播。
3. 验证：补一条“file-drop 与 clipboard 同时装配时，图片粘贴归 file-drop、节点粘贴归 clipboard”的集成测试；现有 clipboard 测试只覆盖自身。

## 待验证

- 本次已核对 order 排序实现（packages/kernel/src/registry/registry.ts:228-242），未跑真实 paste 事件验证浏览器行为。
- navigator.clipboard 在非安全上下文/无权限时的降级路径是否在所有浏览器一致；代码是尽力而为，未真机验证。

