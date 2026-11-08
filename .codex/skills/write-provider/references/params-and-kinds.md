# 参数控件与 kind 全表

这份文件回答两件事：`fields` 里能写什么、每种写法在底栏长什么样。
结论来自 `packages/plugins/plugin-theme-components/src/components/ui/paramKind.ts`
和 `ToolParamField.vue`，不是猜的。

## 一、type：4 种内置控件

| type | 需要什么 | 底栏画成什么 |
| --- | --- | --- |
| `select` | `options` | 下拉，始终是下拉（没写 kind 时不改形状） |
| `number` | `min` / `max` | 滑块 + 右侧数字框；`unit` 显示在标题后面 |
| `number` | 不给 min/max | 普通数字输入框 |
| `boolean` | 无 | 开关，标签写在开关右边 |
| `text` | 无（可给 `placeholder`） | 单行文本输入框 |

后台的 `ActionParam.type` 只声明 `select` / `number` / `boolean` / `text` 这四值。
内核词表里叫 `string`，两边指同一个控件；provider 里写 `text` 就好。

数字参数不给 `default` 时滑块从 `min ?? 0` 开始。`step` 不给按 1。

## 二、kind：12 个语义类型

写 `kind` 是为了让前端挑一个更贴切的控件。`kind` 不参与后台执行，
只是渲染提示；认不出就回落 `type`，不会报错。

| kind | 需要什么 | 渲染结果 |
| --- | --- | --- |
| `ratio` | `options`，值形如 `16:9` | 比例网格。每格画按真实宽高比缩放的描边小矩形；解析不出的值画虚线方框 |
| `quality` | `options` | 按钮网格，3 列 |
| `resolution` | `options` | 按钮网格，3 列 |
| `background` | `options` | 按钮网格，3 列 |
| `count` | `options` | 按钮网格，3 列 |
| `camera` | `options` | 按钮网格，3 列 |
| `duration` | `options` 且 ≤3 个 | 按钮网格 |
| `duration` | `min` / `max` / `step` / `unit` | 滑块 + 数字框 |
| `speed` | `min` / `max` / `step` / `unit` | 滑块 + 数字框 |
| `model` | `options` | 普通下拉，永远不铺成网格 |
| `speaker` | `options` | 普通下拉，永远不铺成网格 |
| `style` | — | 底栏把它整条过滤掉，永远不显示（见第四节） |
| `format` 等其它字符串 | `options` | 选项 ≤3 个铺成按钮网格，≥4 个走下拉 |

几条容易踩的边界：

1. `ratio` / `quality` / `resolution` / `background` / `count` / `camera` 必须给
   `options`；没给等于没声明 kind，回落 `type` 的控件。
2. `duration` 超过 3 个选项时走滑块，而滑块只读 `min` / `max`，
   不读 `options` 的文案。要多档时长就用 ≤3 个选项，或直接给数字区间。
3. `speed` 必须是数值参数（type 为 number，或给了 min/max），否则回落 `type`。
4. **没写 kind 就不会改形状**：`select` 永远是下拉。只有写了 kind、但 kind 不在
   上面已知那 11 个里时，才会因为选项 ≤3 个而铺成按钮网格。

## 三、底栏的参数面板

1. 参数按声明顺序渲染，一个参数一整块：第一行标题，第二行控件。
2. 恰好只有 1 个参数、且它是普通下拉时，不套面板，直接铺在模型下拉旁边。
3. 面板宽 340～420px，高度封顶约 420px / 60vh，超出由面板内部滚动。
4. kind 命中预设件的参数，标题由预设件自己画，面板不再重复。

## 四、坑：kind 写 style 不显示

`packages/plugins/plugin-bottom-bar/src/node-bottom-bar/useBottomBarActions.ts` 里：

```ts
const paramDefs = computed(() =>
  ((currentAction.value?.fields ?? []) as ToolParamDef[]).filter((p) => p.kind !== 'style'),
)
```

底栏故意不给风格参数留位置（风格写在提示词里）。它的 `default` 仍会进 `values`，
但你既看不到也改不了。要展示风格选项，用 `kind: 'model'` 或 `format` 这类会渲染的 kind。

## 五、其它字段

1. `default`：`select` 没给时取第一个选项；其余类型没给就是空。
2. `unit`：只对滑块生效，显示在标题右侧。
3. `placeholder`：只对 `text` 和无范围的 `number` 生效。
4. `description`：内置控件不显示它，只有自定义组件能读到。
5. `span`：底栏参数面板不读它。

