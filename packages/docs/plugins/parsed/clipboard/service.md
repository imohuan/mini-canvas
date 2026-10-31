# 服务 `clipboard`

> 插件：复制粘贴 clipboard · [返回总览](/plugins/parsed/clipboard/)

**一句话**：服务名 `clipboard` —— 把"选中节点"复制/剪切/粘贴/就地复制一份。

## 怎么拿

```ts
const clipboard = ctx.get('clipboard')
clipboard.copy()
```

## 类型

实现类 `ClipboardServiceImpl extends Service`，暴露这些方法：

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `copy` | `copy(): boolean` | 复制选中节点（+ 两端都在选的内连边）到共享剪贴板；同时写系统剪贴板载荷 |
| `cut` | `cut(): boolean` | 复制后删除选中节点（可撤销） |
| `paste` | `paste(): boolean` | 粘贴共享剪贴板里的内容 |
| `duplicate` | `duplicate(): boolean` | 就地复制一份选中节点（不走系统剪贴板） |
| `pasteFromCommand` | `pasteFromCommand(): boolean` | 从**菜单**进来时的粘贴（没有原生事件）：先贴本页快照，没有再去读系统剪贴板 |
| `hasData` | `get hasData(): boolean` | 共享剪贴板里有没有可贴的节点 |

## 它依赖什么

`doc`（数据读写）、`selection`（当前选中集）；
另外**可选**探测 `view`（屏幕坐标换算 + 节点绝对坐标，父链逐级累加）。

## 复制时为什么要"绝对坐标提供者"

复制**只选了子节点、父没被选**时，光靠快照算不出绝对坐标 —— 必须回到整张画布的父链上问，
所以走渲染层的 `view.absolutePosition`；缺服务时退化成"把自身 position 当绝对坐标"。

## 使用方式与示例

```ts
// 位置：任意插件里想"复制一份选中节点"
const ok = ctx.get('clipboard').duplicate()
if (!ok) console.warn('没有选中节点可复制')
```

## 注意事项

1. **`copy` 会同时写系统剪贴板**（markSystemClipboard）：这样"菜单里复制 → 另一个页面 Ctrl+V"才贴得出东西。
2. **`hasData` 是 `getter`**（不是方法）：用 `clipboard.hasData`，别加括号。
3. **粘贴位置**：有视口服务时按最近一次画布内鼠标位置，无则按级联偏移。

