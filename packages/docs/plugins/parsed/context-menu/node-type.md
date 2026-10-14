# 节点类型 `connection-menu`

> 插件：右键菜单 context-menu · [返回总览](/plugins/parsed/context-menu/)

**一句话**：从端口拖线、落到空白处时冒出来的那张**菜单卡** —— 它是一个**真的节点**，直接让你选要连到哪种节点。

## 注册处

```ts
ctx.nodes.register({
  type: CONNECTION_MENU_TYPE,          // 'connection-menu'
  label: '连线菜单',
  size: connectionMenuCardSize(1),     // 按菜单项数写进 node.size
  in: ConnectionMenuContent,
})
```

| 字段 | 值 |
| --- | --- |
| `type` | `'connection-menu'` |
| `label` | `'连线菜单'` |
| `size` | `connectionMenuCardSize(1)`（**按菜单项数算**，非零） |
| `in` | `ConnectionMenuContent.vue` |

## 为什么是"一个真节点"

经 `nodeStore` → VueFlow 渲染，所以位置 / 尺寸 / 缩放**全部由画布负责**，本插件不用自己摆位。

> 尺寸为什么要写成非零：VueFlow 用 `offsetWidth == 0` 判定"节点还没初始化"，会把它写死 `hidden` —— 所以 `addNodes` 时就把尺寸按菜单项数写上。

## 专属外壳（主题槽）

```ts
ctx.theme.register(nodeShellSlot(CONNECTION_MENU_TYPE), ConnectionMenuNode)
`
落点是 `nodeShell:connection-menu`（渲染层按 `nodeShell:<type>` 解析）。

**为什么自带外壳**：这张卡整体就是一张菜单（无标题条、自绘边框底色、单侧端口、反缩放），
与"标题 + 内容"的通用卡片形态不同 —— 由本插件自己画，默认壳（`BaseNode`）不必为它开特判。

## 注意事项

1. **`nodeShell:<type>` 是"按类型换壳"的精确键**：比全局 `nodeShell` 更优先。
2. **菜单项来自命令的 `areas`**：这张卡显示哪些选项，取决于当时注册了哪些带 `areas` 的命令。

