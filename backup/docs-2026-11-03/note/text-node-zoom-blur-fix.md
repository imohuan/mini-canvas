# 文本节点缩放字体模糊修复记录

## 背景

文本节点在 Vue Flow 画布中缩放时，文字会出现明显发虚、边缘糊成一层的情况。

当前文本节点是普通 DOM 内容，外层由 Vue Flow 统一放在可缩放的 viewport 中。画布缩放时，节点和节点内部文字一起被 CSS transform 缩放。

现象可以概括为：

```text
Vue Flow viewport transform
  → 节点整体被 scale
  → 文本也作为 DOM 图层一起被缩放
  → 浏览器在非整数缩放和子像素位置下重新采样
  → 字体抗锯齿变重，看起来模糊
```

## 网络资料结论

查询到的相关资料主要集中在 CSS transform 缩放文字模糊问题上。

共同结论：

- 这不是 Vue Flow 独有问题。
- Vue Flow、React Flow、无限画布、流程图编辑器这类组件通常都会通过 CSS transform 做平移和缩放。
- `transform: scale()` 作用到包含文字的 DOM 上时，浏览器可能把内容作为合成图层处理。
- 在非整数缩放比例、非整数像素位置、GPU 合成图层、Chrome 抗锯齿策略下，文字会出现发虚或边缘发灰。
- `translateZ(0)`、`backface-visibility`、`font-smoothing` 这类 CSS 可以缓解，但不能从根上解决“文字被整层拉伸”的问题。

常见解决方向：

```text
方向一：接受 transform 缩放
  优点：实现简单
  缺点：缩放比例变化时文字容易模糊

方向二：尽量让缩放比例落在更接近整数像素的值
  优点：某些场景有效
  缺点：不适合自由缩放画布

方向三：文字层反向缩放
  优点：文字可以按当前 zoom 重新排版，减少直接拉伸
  缺点：需要单独处理文字层尺寸和 transform

方向四：把文字浮到 viewport 外部，用屏幕坐标渲染
  优点：文字完全不受画布 transform 影响
  缺点：复杂度高，节点内容、编辑态、命中区域都要重做
```

本次选择方向三。

## 方案选择

本次修复只放在文本节点内部，不改 Vue Flow 全局 viewport，不影响图片、视频、连线和节点拖拽。

核心思路：

```text
画布仍然正常缩放节点
文本节点内部单独创建一个文字层
文字层根据当前 zoom 放大排版
再用反向 scale 抵消外层画布缩放
```

视觉结果目标：

```text
画布缩小时：
  文字先以更大的 font-size 排版
  再被内部反向缩放回节点尺寸
  最终减少低分辨率文字被直接压缩采样的问题

画布放大时：
  文字继续按 zoom 放大排版
  避免浏览器只拉伸旧文字图层
```

## 当前实现

文本节点读取 Vue Flow 当前 viewport：

```text
useVueFlow('main-canvas')
  → viewport.value.zoom
```

然后得到当前缩放比例：

```text
zoom = max(viewport.zoom, 0.01)
```

文字层样式按 zoom 派生：

```text
width: zoom * 100%
height: zoom * 100%
font-size: 14px * zoom
transform: scale(1 / zoom) translateZ(0)
transform-origin: top left
```

整体效果：

```text
外层 Vue Flow scale(zoom)
  ×
内层文字 scale(1 / zoom)
  =
屏幕上的文字层尺寸保持稳定

但文字排版用的是 14px * zoom
所以浏览器会按更接近当前显示精度的字号重新绘制文本
```

同时补充了文字渲染相关 CSS：

```text
text-rendering: geometricPrecision
-webkit-font-smoothing: antialiased
backface-visibility: hidden
will-change: transform, font-size
```

这些不是主修复，只是降低 transform 图层下的渲染噪声。

## 修改范围

本次只修改：

- `mini-canvas/src/canvas/core/components/nodes/text/TextNode.vue`

没有修改：

- Vue Flow viewport
- 节点尺寸系统
- 拖拽逻辑
- 图片节点
- 视频节点
- BaseNode 装饰层
- 连线系统

## 为什么不改全局缩放

全局 Vue Flow viewport 缩放是画布坐标系统的基础。

如果从全局层面改 transform，影响范围会扩大到：

```text
节点定位
连线定位
端口命中
框选坐标
拖拽坐标
插件坐标换算
工具栏位置
```

文本模糊是文本节点内容层的问题，所以更适合局部处理。

## 为什么不把文字浮到画布外

把文字完全移出 Vue Flow viewport，可以彻底避免 transform 对文字的影响，但代价较高。

需要额外维护：

```text
节点 flow 坐标 → 屏幕坐标
文字层位置同步
滚动和缩放同步
编辑态 textarea 定位
节点裁剪区域
事件穿透和命中
选中态遮挡关系
```

这更适合以后做“高精度文本渲染层”时统一设计，不适合作为当前 bug 的局部修复。

## 已验证结果

执行构建：

```text
npm run build
```

结果：

```text
vue-tsc 通过
vite build 通过
```

构建过程中出现 `@vueuse/core` 依赖内部的 Rolldown `INVALID_ANNOTATION` 警告。

该警告来自 `node_modules` 内部注释位置，不是本次文本节点修改引入的问题。

`TextNode.vue` 文件级诊断没有新增 linter 问题。

## 后续可选优化

如果后续还要继续提升无限画布里的文字清晰度，可以考虑两条路线：

```text
轻量路线：
  把文本节点的字号、行高、padding 做成数据化配置
  让反向缩放方案适配不同字号

重型路线：
  建立独立的 screen-space 文本渲染层
  文字完全脱离 Vue Flow viewport transform
  所有文本节点通过屏幕坐标投影渲染
```

当前阶段建议维持轻量路线，因为它的影响范围最小，也最符合文本节点局部修复的目标。