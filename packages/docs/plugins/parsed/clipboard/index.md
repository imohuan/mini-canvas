# 复制粘贴 clipboard

> 插件解析 · `@mini-canvas/plugin-clipboard` · 自带件

**一句话**：Ctrl/Cmd+C / V / X / D 四条快捷键背后的能力 —— 复制、剪切、粘贴、就地复制一份选中节点，
支持跨页面粘贴（经系统剪贴板）。

## 它注册了什么（全部落点）

| 种类 | 键 / 名字 | 放的是什么 | 详情 |
| --- | --- | --- | --- |
| 服务 | `clipboard` | `ClipboardServiceImpl`：copy / cut / paste / duplicate / pasteFromCommand / hasData | [服务](/plugins/parsed/clipboard/service) |
| 命令 | `clipboard:copy` / `clipboard:paste` / `clipboard:cut` / `clipboard:duplicate` | 与快捷键同源 | [命令](/plugins/parsed/clipboard/commands) |
| 事件 | `clipboard:copy` / `clipboard:cut` / `clipboard:paste` | 动作发生时的通知 | [事件](/plugins/parsed/clipboard/events) |
| 粘贴仲裁场 | `clipboard/paste` | 多路仲裁：贴节点还是贴外部媒体 | [服务](/plugins/parsed/clipboard/service) |

## 身份与依赖

| 项 | 值 | 来源 |
| --- | --- | --- |
| 插件名（`name`） | `'clipboard'` | `src/clipboardPlugin.ts` |
| 包名 | `@mini-canvas/plugin-clipboard` | `package.json` |
| 硬依赖（`inject`） | `['doc', 'selection']` | 同上 |
| 自带件 | `miniCanvas.builtin: true` | `package.json` |

## 注意事项

1. **快捷键用 `deferToNative: true`**：把键交给原生的 copy / paste 事件（否则 keydown 里 preventDefault 会掐掉它），真正的活在**仲裁场**里做。
2. **剪贴板快照按画布实例隔离**（不是模块级 static）：跨画布不串数据；跨页面互贴走系统剪贴板里的**完整载荷**。
3. **粘贴有多路仲裁**：本插件注册处理器进 `clipboard/paste` 场，文件拖入等别的插件也往里注册，按 `order` 决定谁接这次粘贴。

