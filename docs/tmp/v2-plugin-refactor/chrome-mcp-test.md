# Chrome MCP 浏览器测试记录 —— 插件独立包(dsh)最小 demo

日期：2026-09-04 · 分支：feat/cordis-plugin-system · 方式：chrome-devtools MCP 真实浏览器自动化
被测：`packages/canvas-core-v2` vite demo（`pnpm dev`，端口 5201）
验证目标：text/image 节点已抽成独立包（`packages/plugins/plugin-node-{text,image}`），UI(.vue)+逻辑一体、宿主按清单加载。

## 前置
- 清空 localStorage → 刷新，让 demo 重新 seed 默认 text+image 两节点。

## 测试用例与结果

| # | 操作 | 断言 | 结果 |
|---|---|---|---|
| T1 | 加载页面 | 2 节点(text+image,image 带图)+1 边渲染；console 无 error | ✅ |
| T2 | 点"+ 图片"按钮 | 节点 2→3，image 2 个（经 command:create-node + 插件 factory） | ✅ |
| T3 | 点"+ 文本"按钮 | 节点 3→4（新增 text，带"双击编辑"） | ✅ |
| T4 | 双击 text 内容 → 输入"chrome-mcp 编辑测试 OK" → blur | 文本更新为新内容（content .vue→ctx.get('text').editText→nodeStore+save） | ✅ |
| T5 | 刷新页面 | 4 节点全恢复，编辑文本仍在（localStorage 持久化） | ✅ |
| T6 | 选中 image 节点 → 按 Delete | 节点 4→3（选中→command:delete→移除+落盘） | ✅ |
| T7 | Ctrl+Z 撤销 | 节点 3→4（undo 恢复删除） | ✅ |
| T8 | 画布空白右键 → 菜单出现 → 点"+ 图片节点" | 菜单项齐全；节点 4→5 | ✅ |

全程 console 无 error；节点坐标正常（transform translate）。

## 结论
插件抽独立包架构跑通：宿主零硬编码 UI，content .vue 随插件包注册渲染，
双击编辑(插件服务)、持久化、命令增删、撤销、右键菜单全链路正常。

> 未自动测：自由拖拽移动(属 VueFlow 原生成熟能力，非本次改动范围)。如需可后续补 drag 用例。
