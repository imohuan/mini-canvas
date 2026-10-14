# UI 插槽与主题槽

> 插件：底部状态栏 bottom-bar · [返回总览](/plugins/parsed/bottom-bar/)

**一句话**：本插件往画布叠了三层 UI（底栏宿主 / 参考选择态 / 全屏媒体预览），
再给所有节点盖了一层任务进度覆盖层，并用一个主题槽提供**可替换的底栏皮**。

## 注册的 UI 插槽（都挂画布 `overlay` 槽）

| id | order | 组件 | 干什么 |
| --- | --- | --- | --- |
| `bottom-bar/host` | 40 | `NodeBottomBarOverlay` | **底栏宿主**：把底栏摆到选中卡片的正下方 |
| `bottom-bar/reference-select` | 41 | `ReferenceSelectOverlay` | 参考选择态浮层（顶行「参考」按钮引发） |
| `bottom-bar/media-preview` | 42 | `MediaPreviewOverlay` | 全屏媒体预览（素材卡点开看大图/全文） |

> **为什么底栏挂画布槽而不是节点 `out:bottom`**：节点带 `transform` 必然成层叠上下文，
> 底栏住在节点里就压不过外壳底部工具栏（`.shell-dock` z-index:30），输入区点击会被截走（实测复现）。
> 挂到画布槽后由 `NodeBottomBarOverlay` 负责把它摆到卡片正下方。

## 注册的节点区域

| 区域 | 键 | 组件 | 干什么 |
| --- | --- | --- | --- |
| `over:inset` | `*/over:inset`（通配所有节点类型） | `NodeTaskOverlay` | 任务进度覆盖层（组件自己判空与显隐） |

## 注册的主题槽

| 槽名 | 放进去的组件 | 说明 |
| --- | --- | --- |
| `bottomBar`（常量 `BOTTOM_BAR_SLOT`） | `NodeBottomBar` | 默认底栏皮；与 `settingsPanel` 同构：**order 最小者赢** |

整体换皮就一行：

```ts
// 位置：换皮插件的 apply —— order 比默认皮小即顶掉它
ctx.theme.add('bottomBar', MyBar, { order: -1 })
```

## 注意事项

1. **三层浮层用不同 order 排开**，各自判显隐：不在选择态 / 没有素材时**不产出 DOM**。
2. **覆盖层用 `'*'` 通配**：所有节点类型都能有进度显示，不需要每个节点插件自己声明。
3. **换皮只换"栏内内容"**：摆位（摆到卡片正下方）仍由 `NodeBottomBarOverlay` 负责。

