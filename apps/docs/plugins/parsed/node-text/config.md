# 设置项

> 插件：文本节点 text · [返回总览](/plugins/parsed/node-text/)

**一句话**：本插件声明 2 个设置项，管"没被手动拖过尺寸的文本节点"的默认宽高。

## 声明的设置项

键名带 `text` 前缀（settings 是**全局同一张表、先声明者独占**，通用名会跟别的插件抢键）。

| 键 | 类型 | 缺省 | 范围 | 分组 | 作用 |
| --- | --- | --- | --- | --- | --- |
| `textDefaultWidth` | number | 300 | 80–2000，步 10 | 布局/文本节点尺寸 | 没有自身尺寸的文本节点的宽（改完实时生效） |
| `textDefaultHeight` | number | 200 | 80–2000，步 10 | 布局/文本节点尺寸 | 同上，高 |

## 怎么接进设置面板

```ts
bindTypeDefaultSize(ctx, 'text', { w: 300, h: 200 }, { widthKey: 'textDefaultWidth', heightKey: 'textDefaultHeight' })
```

所以改设置**立刻**影响"没被手动拖过尺寸"的文本节点（改完不用重开画布）。

## 注意事项

1. **键名必须带本包前缀**：settings 的 key 是全局平面命名，`defaultWidth` 这种通用名会跟别的插件撞号。
2. **只管"没被手动拖过"的节点**：用户手动 resize 过的节点有自己的尺寸，不会被设置覆盖。

