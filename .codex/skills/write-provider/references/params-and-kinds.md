# 参数控件全表

这份文件回答两件事：`fields` 里能写什么、每种写法在底栏长什么样。
结论来自 `packages/plugins/plugin-theme-components/src/components/ui/paramKind.ts`
与 `ToolParamField.vue`，不是猜的。

## 先说结论：`type` 是主体，`kind` 只剩一个

| 用什么 | 覆盖什么 | 取值 |
| --- | --- | --- |
| `type` | 所有常规需求 | `select` / `grid` / `number` / `string` / `boolean` |
| `kind` | 基础控件画不出来的专属 UI | 只有 `ratio` |

以前有 12 个 kind（quality / resolution / background / count / camera / duration /
model / style / speaker / format / speed），它们画出来的东西和基础控件一模一样，
现在全删了。**写这些旧名字不会报错，只是不起作用** —— 控件按 `type` 画。

## 一、五种基础控件

| type | 需要什么 | 画成什么 |
| --- | --- | --- |
| `select` | `options` | 下拉。永远是下拉，哪怕只有 2 个选项 |
| `grid` | `options`，可选 `columns` | 按钮网格，点一下就切换 |
| `number` | `options` | 按钮网格（几档里选一个，如 5 秒 / 10 秒） |
| `number` | `min` / `max`（可加 `step` / `unit`） | 滑块 + 右侧数字框 |
| `number` | 都不给 | 普通数字输入框 |
| `string` | 可给 `placeholder` | 单行文本输入框 |
| `boolean` | 无 | 开关，标签在右边 |

注意 `number` 有三种形态，按你给的字段决定，不用写 kind：

```js
// 1. 按钮网格：几档里选一个
{ key: 'count', label: '数量', type: 'number', default: 1,
  options: [{ label: '1 张', value: 1 }, { label: '2 张', value: 2 }] }

// 2. 滑块 + 数字框
{ key: 'durationSec', label: '时长', type: 'number', default: 6,
  min: 4, max: 15, step: 1, unit: '秒' }

// 3. 普通输入框（无范围）
{ key: 'seed', label: '种子', type: 'number', default: 42 }
```

`unit` 只对滑块有意义，显示在数值那一侧。

## 二、按钮网格：`type: 'grid'` 与 `columns`

按钮网格是基础控件，不是预设件。`type: 'grid'` 直接画它：

```js
{ key: 'quality', label: '画质', type: 'grid', default: 'hd',
  options: [
    { label: '标准', value: 'sd' },
    { label: '高清', value: 'hd' },
    { label: '超清', value: 'uhd' },
  ] }
```

`columns` 控制一行几格。省略时按选项数自动排一行（最多 6 列）：

| 写法 | 结果 |
| --- | --- |
| 不写 `columns`，3 个选项 | 一行 3 格 |
| 不写 `columns`，9 个选项 | 6 格一行，第二行 3 格 |
| `columns: 1` | 竖排一列（适合两个字一档的低 / 中 / 高） |
| `columns: 2` | 两列两行 |
| `columns: 4` | 一行 4 格 |

什么时候该自己定列数：选项文字很短（两个字）铺成 3 列会很空，铺 1 列反而清爽；
选项多到 12 个时排一行每格只剩 30px，得折成 2～3 列。这类排版判断只有写 provider 的人知道。

`type: 'number'` 带 `options` 时也是网格，`columns` 一样生效。

## 三、专属 UI：`kind: 'ratio'`

只有比例参数需要它 —— 每格画一个按真实宽高比缩放的描边小矩形，
一眼能分出 16:9 与 9:16，普通下拉表达不了这个信息。

```js
{ key: 'ratio', kind: 'ratio', label: '比例', type: 'select', default: '16:9',
  columns: 6,   // 可选：一行几格，省略则按选项数排
  options: [
    { label: '1:1', value: '1:1' },
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
  ] }
```

几个边界：

1. `kind: 'ratio'` 必须给 `options`，没给就回落 `type` 的控件。
2. 值解析不出比例（如 `auto`）时画虚线方块，与真比例区分。
3. `columns` 同样可以用在这里。

## 四、底栏的参数面板

1. 参数按声明顺序渲染，一个参数一整块：第一行标题，第二行控件。
2. 恰好只有 1 个参数、且它是普通下拉时，不套面板，直接铺在模型下拉旁边。
3. 面板宽 340～420px，高度封顶约 420px / 60vh，超出由面板内部滚动。
4. 按钮网格与比例网格自己画标题，面板不会在它上面再画一遍。

## 五、坑：`kind: 'style'` 被底栏过滤

`packages/plugins/plugin-bottom-bar/src/node-bottom-bar/useBottomBarActions.ts` 里：

```ts
const paramDefs = computed(() =>
  ((currentAction.value?.fields ?? []) as ToolParamDef[]).filter((p) => p.kind !== 'style'),
)
```

底栏故意不给风格参数留位置（风格写在提示词里）。它的 `default` 仍会进 `values`，
但你既看不到也改不了。要展示风格选项，用 `type: 'grid'` 或 `type: 'select'`，别写 `kind: 'style'`。

## 六、其它字段

1. `default`：`select` / `grid` 没给时取第一个选项；其余类型没给就是空。
2. `unit`：只对滑块生效。
3. `placeholder`：只对 `string` 和无范围的 `number` 生效。
4. `description`：内置控件不显示它，只有自定义组件能读到。
5. `span`：底栏参数面板不读它。
6. `component`：作者自带 Vue 组件，优先级最高，什么都不抢。

