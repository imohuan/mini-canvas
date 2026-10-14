# 设置项

> 插件：可视化节点 node-ui · [返回总览](/plugins/parsed/node-ui/)

**一句话**：本插件声明 3 个设置项 —— 一个管"界面能不能调后台"，两个管默认尺寸。

## 声明的设置项

| 键 | 类型 | 缺省 | 范围 | 分组 | 作用 |
| --- | --- | --- | --- | --- | --- |
| `uiNodeAllowNetwork` | boolean | `true` | — | 常规/可视化节点 | 打开后节点里的界面**可以直接调画布接口**（改节点、下单生成）；关掉 = 纯展示、连不上网络 |
| `uiNodeDefaultWidth` | number | 420 | 120–2000，步 10 | 布局/可视化节点尺寸 | 没被手动拖过尺寸的节点用的宽 |
| `uiNodeDefaultHeight` | number | 320 | 100–2000，步 10 | 布局/可视化节点尺寸 | 同上，高 |

## 默认尺寸怎么接进面板

```ts
bindTypeDefaultSize(ctx, UI_NODE_TYPE, { w: 420, h: 320 }, {
  widthKey: 'uiNodeDefaultWidth',
  heightKey: 'uiNodeDefaultHeight',
})
```

改设置**立刻**影响"没被手动拖过尺寸"的可视化节点。

## 注意事项

1. **键名带 `uiNode` 前缀**：settings 是全局同一张表、先声明者独占，通用名会跟别的插件抢键。
2. **`uiNodeAllowNetwork` 是安全阀**：关掉后界面连不上后台 —— 适合"只想给客户看一张图、不想让它动数据"的场景。

