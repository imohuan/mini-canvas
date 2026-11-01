# 自动布局问题排查与修复记录

日期：2026-06-18

## 背景

这次新增了 `auto-layout` 插件，用来做自动布局、F 聚焦、以及右侧面板里的布局参数设置。

过程中遇到了几个问题：

1. 按 `F` 聚焦时，视图缩放过大。
2. 在 `Pannel.vue` 修改自动布局参数后，点击自动布局参数会被复位。
3. 自动布局后，分组和单节点之间的距离异常。
4. 连续点击自动布局时，分组和单节点会一次比一次远。
5. console 日志对象默认显示成 `{…}`，不方便定位问题。

## 问题 1：F 聚焦缩放过大

### 现象

按 `F` 聚焦选中节点时，不只是居中，还会把节点放得非常大。

### 原因

之前聚焦时直接调用 `setCenter(centerX, centerY)`，没有明确控制 zoom。

VueFlow 会按内部默认行为处理缩放，导致结果不可控。

### 修复

增加了按比例计算 zoom 的逻辑：

- 默认让选中内容高度占视图高度的 `50%`。
- 这个比例可以在右侧面板「布局」页调整。
- zoom 会受通用设置里的 `minZoom` / `maxZoom` 限制。

相关文件：

- `src/canvas/core/plugins/auto-layout/focusViewport.ts`
- `src/canvas/core/plugins/auto-layout/AutoLayoutPlugin.ts`
- `src/canvas/core/Pannel.vue`
- `src/canvas/core/Canvas.vue`

## 问题 2：自动布局参数被复位

### 现象

在 `Pannel.vue` 中修改方向、簇内间距、簇间间距后，点击「自动布局」，参数会变回默认值。

### 原因

点击自动布局时，代码先执行了 `syncLayoutState()`。

这会把插件里的旧配置读回来，覆盖面板刚改的值。

另外，一开始只有方向会立即写入插件，间距只保存在 `layoutState` 里。按 `Ctrl+L` 时会绕过面板按钮，直接使用插件里的旧配置。

### 修复

- 点击自动布局前，不再先 `syncLayoutState()`。
- 改成先把面板当前值 `pushLayoutConfig()` 到插件，再执行布局。
- 方向、簇内间距、簇间间距、聚焦比例变更时都会同步到插件。
- `Ctrl+L` 也能使用最新参数。

相关文件：

- `src/canvas/core/Canvas.vue`
- `src/canvas/core/Pannel.vue`
- `src/canvas/core/plugins/auto-layout/config.ts`

## 问题 3：自动布局后视角异常

### 现象

自动布局后画布被缩得很小，节点看起来很散。

### 原因

自动布局结束后调用了 `fitView()`。

当节点距离本身已经异常时，`fitView()` 会把整个异常范围都塞进视口里，看起来更小、更散。

### 修复

自动布局完成后不再调用 `fitView()`。

现在只保持当前 zoom，并把布局结果居中。

相关文件：

- `src/canvas/core/plugins/auto-layout/AutoLayoutPlugin.ts`

## 问题 4：连续自动布局，单节点越跑越远

### 现象

场景：一个分组里有两个节点，分组外有一个单节点，且分组内节点连到单节点。

连续点击自动布局后，分组位置基本不变，但单节点会一次比一次远。

日志里能看到：

```txt
第一次输入：node 3 x = 875.08
第一次结果：node 3 x = 1667.08

第二次输入：node 3 x = 1667.08
第二次结果：node 3 x = 2459.08
```

### 错误排查过程

一开始怀疑是分组子节点在相对坐标和绝对坐标之间重复转换。

因此增加了自动布局全链路日志：

- `00-input`：布局前 VueFlow 原始节点。
- `01-groups`：分组和子节点关系。
- `02-absolute-from-computedPosition`：从 VueFlow computedPosition 得到绝对坐标。
- `02-absolute-from-parent-plus-relative`：computedPosition 缺失时，用父组位置 + 子节点相对位置兜底。
- `03-nodeSnapshots-absolute`：送进布局引擎前的绝对坐标。
- `04-layout-result`：布局引擎算完的位置。
- `05-group-frame`：分组重新计算出来的位置和大小。
- `06-reparent-child`：子节点挂回分组时的相对坐标。
- `07-final-vueflow-state`：最终 VueFlow 状态。

日志证明：

- 分组和分组内子节点没有继续漂移。
- 漂移发生在 `layoutEngine` 的 `04-layout-result` 阶段。
- 单节点每次会把上一次的绝对坐标继续加进去。

### 根因

`layoutClusterRecursive()` 处理 `single` 簇时，只设置了 bounds：

```ts
cluster.bounds = { x: 0, y: 0, w: dim.w, h: dim.h }
```

但没有把单节点自己的位置归零。

后续 super-cluster 布局会给子簇加 offset。因为单节点还带着旧的绝对坐标，所以实际变成：

```txt
新位置 = 旧位置 + 本次布局偏移
```

连续布局时旧位置越来越大，于是单节点越跑越远。

### 修复

在处理 single 簇时，把单节点也归一到局部坐标：

```ts
if (cluster.type === 'single') {
  const dim = getNodeDim(cluster.nodes[0])
  cluster.nodes[0].position = { x: 0, y: 0 }
  cluster.bounds = { x: 0, y: 0, w: dim.w, h: dim.h }
  return
}
```

相关文件：

- `src/canvas/core/plugins/auto-layout/layoutEngine.ts`

## 问题 5：console 日志不方便复制和定位

### 现象

浏览器 console 中对象会显示成 `{…}`，复制给别人看时缺少细节。

另外浏览器默认日志位置可能只显示转接器文件，或者函数名显示成 `Object.info`。

### 处理

在 `main.ts` 里安装了一个开发环境 console 转接器：

- 拦截 `console.log/info/warn/error/debug`。
- 给输出加上相对文件路径、行、列。
- 去掉 `http://localhost:5173` 和 `?t=...`。
- 对对象做 `JSON.stringify`。
- 过滤 `Object.info` / `Object.log` 这类包装函数名。

相关文件：

- `src/main.ts`
- `src/installConsoleInterceptor.ts`

## 新增测试

新增了自动布局相关测试：

- 聚焦 zoom 计算。
- 聚焦居中 viewport 计算。
- 配置合并不能丢嵌套字段。
- 分组 frame 计算必须使用绝对坐标。
- 分组连接单节点时，连续布局必须稳定，不能越跑越远。

测试目录：

- `src/canvas/core/plugins/auto-layout/__tests__/`

验证命令：

```bash
node --test --experimental-strip-types src\canvas\core\plugins\auto-layout\__tests__\*.test.ts
pnpm build
```

当前结果：

- 自动布局测试通过。
- `pnpm build` 通过。
- 构建中仍有 `@vueuse/core` 的 PURE 注释警告，这不是本次改动引入的功能问题。

## 经验总结

1. 自动布局算法里，所有子簇进入上层布局前都必须使用局部坐标。
2. 分组子节点在 VueFlow 里是相对坐标，参与布局前必须转换成绝对坐标。
3. 布局结果写回分组时，需要再从绝对坐标转回相对坐标。
4. 连续执行自动布局必须是幂等的：同一结构重复布局，结果不能持续漂移。
5. 复杂坐标问题不要只靠猜，要打印每一层输入输出。
