# PrecisionSlider（Ctrl 精细微调 + step 吸附）网络调研

> 任务：为 Vue3 设置面板抽一个干净可复用的 slider 组件。原生 `<input type=range>` 反复出现"圆球乱跑 / 不跟 value / 松手回跳 / 闪烁"，调研业界成熟做法。
> 纯网络调研，未改任何代码。每个结论附来源 URL。

---

## A. 原生 `<input type=range>` 的 min/max/step/value 校验规则；给非网格值会发生什么？

### 结论
1. **value 是字符串**，永远不会是空串。默认值算法：`max<min ? min : min + (max-min)/2`。
2. **钳制是硬性的**：试图把 value 设得比 min 小→被设成 min；比 max 大→被设成 max。（这是唯一"值被改写"的情况）
3. **step 是校验用的，不是强改 value 用的**：只有"value = min(或 value/max 作步进基) + step 的整数倍"才是合法值。**给 `el.value` 赋一个不在网格上的数字，浏览器不会主动帮你四舍五入成网格值——它保留你赋的值**，只是会触发 constraint validation（`:invalid` / `:out-of-range` / `stepMismatch` 伪类）。
4. **step 默认 1**（整数）；`step="any"` 表示不设网格。步进基（step base）优先取 `min`，min 未给则取 `value`，都没有则 `0`。例：min=0.2、step=0.2 → 合法值 0.2, 1.2, 3.2, 5.2…（注意：从 step 基累加，**不是**所有 0.2 倍数都合法）。
5. **"四舍五入到最近网格值"是用户操作时 UA 做的**（点击/拖动轨道、方向键），不是赋 value 时做的。文档原话：当用户输入不满足 stepping 时，"user agent may round off the value to the nearest valid value, preferring to round up when two equally close"。
6. 拖动时赋给 `el.value` 的中间值若不在网格上 → 事件照发，但画面上 UA 可能先把 thumb 画在离网格最近的位置，于是"**圆球和 value 进度不一致 / 像在跳**"的观感往往源于此：**你自己不该依赖浏览器去 round，拖动每帧就该自己吸附好再赋**。
7. **坑（本任务 flicker 的一个已知根因）**：Vue 里 range 的 `value` 必须在 `min/max/step` 挂载之后才设，否则会出现"首帧显示 100/默认值 → 下一 tick 被纠正"的跳动。Vue 已修（见 D 节），但自己手写时要保证 props 顺序。

### 关键来源 URL
- MDN `<input type="range">`: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/range （Value / Validation / min / max / step 小节）
- MDN `step` attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/step
- MDN Constraint Validation 表（rangeUnderflow/rangeOverflow/stepMismatch）: https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation
- Vue 关于 range 跳动 issue #2325: https://github.com/vuejs/core/issues/2325

### 可直接抄的实现思路
- **吸附自己算，别交给浏览器**：`roundToStep(v) = Math.round((v - min)/step) * step + min`，再 clamp 到 [min,max]。小数误差用按 step 小数位 round（见 B/E 节 reka 的 `roundValue`）。
- 视觉"网格外中间值"也照常赋，但要跟 value 走同一吸附源，避免圆球自己跳到另一个位置。
- 赋 `el.value` 前确保 min/max/step 已存在（顺序问题）。

---

## B. 业界可复用 slider 如何解耦"视觉 thumb 位置"与"逻辑 value"？（shadcn/radix/HeadlessUI/Vue Flow/daisyUI/antd/element-plus）

### 结论
- **通行架构 = 三态分离**，几乎所有现代组件库一致：
  1. **受控/非受控 value 态**（`value`/`modelValue` + `defaultValue`）——逻辑值，吸附在网格上的最终值；
  2. **live 回调** `onValueChange`/`input`（拖动每一帧都发，值已吸附）——用于跟手 + 显示 tooltip/数字；
  3. **提交回调** `onValueCommit`/`change`/`onChangeComplete`（鼠标松开/keyup 才发一次）——用于真正写 store / 记 undo。
- **"视觉 thumb 位置"从不直接存**：thumb 是纯 `CSS position:absolute + left/translateX(百分比)`，百分比由 `value→percentage` 纯函数现算：`percent = (value - min) / (max - min) * 100`（reka `convertValueToPercentage`）。逻辑值变了，thumb 跟着动；反之拖动时 `指针位置→percent→value(吸附)` 再回写 value。**同一份 value 既驱动进度条又驱动 thumb，天然不会"圆球不跟 value"**。
- **受控组件风险**：若 value 被父组件 / store 异步化（delayed/coalesced），松开瞬间浏览器已把 DOM `el.value` 画在某处，而父层下发的旧 value 会把它"拽回"→ 回跳/闪烁。**业界解法是组件内部保持一个"正在拖的本地值"当视觉权威，外部 store 只决定"提交后的值"**（详见 C/D 的 pascalorg 方案）。
- 各家情况：
  - **shadcn/ui**：`Slider` = radix `SliderPrimitive` 薄壳（value 数组 + onValueChange），只管样式与 a11y；具体逻辑全在 radix。文档 https://ui.shadcn.com/docs/components/slider 。
  - **radix-ui slider**（React 鼻祖）：受控 value + `onValueChange`（live）+ `onValueCommit`（松手/按键结束）。thumb 定位用 `calc(% + offset)`，拖动含 `getThumbInBoundsOffset` 防越界。源码 `Slider.tsx`。
  - **reka-ui slider**（Vue3 的 radix 移植，shadcn-vue 底层）：`v-model(modelValue)` + `updateValues(value,index,{commit})`，吸附公式与 `handleSlideEnd` 发 `valueCommit`，结构与 radix 一致。这是**本任务最该直接抄的 Vue3 参考**。
  - **element-plus el-slider**（Vue3）：`v-model` 受控 + `input`（拖动实时）+ `change`（鼠标松开才发）。`step` 吸附在内部 `setValue` 里做；有 `show-tooltip`+`format-tooltip`、`show-input` 配合精确输入、`show-stops`。**不内置 Ctrl 缩放**。
  - **antd slider**（React）：`value` 受控 + `onChange`（live）+ `onChangeComplete`（mouseup/keyup 一次）。**原生不内置 Ctrl 精细调**，靠 `marks`/`step`/`tooltip.formatter` 做展示与离散；v6 用 `tooltip` 子对象（formatter 显示当前值）。可用受控在 onChange 里做 modifier 缩放（= pascalorg 那套）。
  - **HeadlessUI / Vue Flow**：HeadlessUI 侧重行为+a11y、Vue Flow 是流程图库不是设置滑块；无通用"ctrl 精细调滑块"直接可用品，需自己做。
  - **daisyUI range**：纯 CSS 美化原生 range（`range` + step），不改逻辑，依赖原生 input 事件。

### 关键来源 URL
- shadcn slider 文档: https://ui.shadcn.com/docs/components/slider
- radix slider 文档: https://www.radix-ui.com/primitives/docs/components/slider
- radix Slider 源码: https://github.com/radix-ui/primitives/blob/main/packages/react/slider/src/Slider.tsx
- reka-ui (Vue) SliderRoot/SliderHorizontal 源码: https://github.com/unovue/reka-ui/blob/49d1d32b/packages/core/src/Slider/SliderRoot.vue
- reka-ui utils（吸附/百分比/小数位）: https://cdn.jsdelivr.net/npm/reka-ui@2.10.3/src/Slider/utils.ts
- element-plus slider 属性/事件: https://element-plus.org/es-ES/component/slider （及仓库 docs slider.md）
- antd Slider API（onChange/onChangeComplete/tooltip）: https://github.com/ant-design/ant-design/blob/master/components/slider/index.en-US.md
- daisyUI range: https://daisyui.com/components/range/
- UI5 Web Components Slider（Ctrl/Cmd=1/10 步）: https://ui5.github.io/webcomponents/nightly/components/Slider/

### 可直接抄的实现思路（reka 的吸附 + 双回调）
```ts
// value→thumb 百分比（视觉定位唯一来源）
const percent = computed(() =>
  clamp(((model.value - min) / (max - min)) * 100, 0, 100)
)
// 拖动每帧：指针位移 → 吸附 → 更新本地/emit input（跟手）
function snap(v: number, step: number, min: number) {
  const dec = getDecimalCount(step)
  const r = 10 ** dec
  const snapped = Math.round(((v - min) / step) * r) / r
  return clamp(snapped * step + min, min, max)
}
// 松手：emit change / valueCommit（一次，写 store）
```

---

## C. "按住修饰键(ctrl/shift/alt)拖动 = 步进缩放/细调"现成实现有哪些？怎么处理 thumb 跟手 vs 值吸附？

### 结论
1. **键盘方向已经是标配**：
   - radix/reka：方向键=±step；`PageUp/PageDown` 与 **`Shift+方向键` = 大步**（大步默认 = `(max-min)/10`，reka 里 stepKey 翻倍）；Home/End=min/max。即"修饰键改变步长"在键盘上有规范可循，文档都列了 a11y 键盘表。
   - UI5 Slider：**`Ctrl/Cmd + 方向键` = 以整范围的 1/10 步进**；PageUp/PageDown 同样=1/10 范围。这是"Ctrl=粗调/跳步"的现成先例。
2. **指针拖动 + 修饰键缩放**（你要的 ctrl 精调）最完整的现成参考是 **pascalorg/editor 的 `slider-control.tsx`**（一个专业参数面板的"带单位+精度+修饰键"滑块），它明确处理了 C 问的核心冲突：
   - **step 乘子**：`Shift=×10`（粗），`Ctrl/Cmd/Alt=×0.1`（细），无=×1。
   - **灵敏度**：水平拖动 `每 4px = 一个当前 step`（`(dx/4)*s`），让细调也有"物理距离可拖"，不粘手。
   - **修修饰键中途改 → 重新锚点（re-anchor）**：拖动中按/放 Ctrl，若继续用"起点锚+累计 dx×新步长"会**瞬间跳回起点方向**；它在乘子变化那一刻把锚点重置为"当前指针位置 + 当前 value"，此后新 dx 按新步长走。这是"thumb 跟手"的核心——**步长缩放只影响"增量换算"，不影响"从当前位置继续"**。
   - **值吸附**：增量在 display 单位算好后按当前精度 `toFixed` round，再 clamp——即最终必落在显示精度网格上，但每帧值都是当前指针累计位置的合法吸附值，所以 thumb 一直贴着鼠标。
   - **live/commit 分离**：拖动中 `onChange`(live 更新视觉/数字)，松手 `onCommit`(一次) 写最终值；配合 editor 的 undo/redo 用 `originValue→restore→finalVal` 技巧。
3. **为什么 thumb 跟手与吸附不冲突**：业界不把"吸附"做成"松开瞬间把值弹到网格"，而是**让吸附作为每帧增量换算的一部分**——指针位移多少 px 折成多少 step（含修饰键缩放），得到目标值后立刻吸附到 step，再赋 value。鼠标每一帧都在"某个合法值"上，thumb 从不与指针脱节，也就没有"跳"的观感。

### 关键来源 URL
- pascalorg/editor slider-control.tsx（最强参考，含完整 modifier/re-anchor 逻辑）: https://github.com/pascalorg/editor/blob/main/packages/editor/src/components/ui/controls/slider-control.tsx
- UI5 Slider 键盘（Ctrl=1/10 范围）: https://ui5.github.io/webcomponents/nightly/components/Slider/
- radix slider 键盘交互表（Page/Shift+Arrow）: https://www.radix-ui.com/primitives/docs/components/slider
- reka-ui SliderRoot（updateValues 吸附 + valueCommit）: https://github.com/unovue/reka-ui/blob/49d1d32b/packages/core/src/Slider/SliderRoot.vue

### 可直接抄的片段（pascalorg 精化后）
```ts
const MOD = { shift: 10, ctrl: 0.1, alt: 0.1, meta: 0.1 } // 例
function stepFor(e) { // 返回当前步长
  const base = props.step
  if (e.shiftKey) return base * 10
  if (e.ctrlKey || e.metaKey || e.altKey) return base * 0.1
  return base
}
// pointerdown: 记起点 { anchorX, anchorValue, step }
// pointermove:
if (stepFor(e) !== cur.step) {       // 修饰键中途变了 → 重新锚点防跳
  cur.anchorX = e.clientX; cur.anchorValue = cur.currentValue; cur.step = stepFor(e); return
}
const dx = e.clientX - cur.anchorX
const v = clamp(cur.anchorValue + (dx / PX_PER_STEP) * cur.step, min, max)
setLocal(v); emit('live', v)          // 跟手，值已吸附
// pointerup:
emit('commit', cur.currentValue)      // 一次，写 store
```

---

## D. Vue3 受控 `:value` + 每帧 set 到异步合并器时 thumb 会不会滞后/闪烁？推荐写法？

### 结论
1. **会，这就是你"圆球乱跑/回跳/闪烁"的一大来源，机制如下**：
   - Vue `v-model`/`:value` 对 range 的 `beforeUpdate` 会回写 `el.value = newValue`（源码里对 `type!=='range'` 才跳过 activeElement，**range 会一路回写**）。如果你拖动每帧 emit 一个 value，而父层把值经过 **异步 coalescer / rAF 合并 / debounce** 再回传，那么：手指已到 x=60% 时 DOM value 还是旧的 x=40% → 浏览器每收到一个新值都把它**"拽"回**旧位置 → 明明在拖却原地抖/回跳/滞后。
   - 父层若把"中间值也吞掉只发最终值"，还会造成"拖动中数字不跟手、松手一下跳到位"。
2. **根因不是吸附，是"视觉权威"跑到了异步链路上**。业界（radix/reka/pascalorg 都如此）的处理 = **拖动期间组件内部本地值当唯一视觉权威**，直接、同步地喂给 thumb/进度/DOM，**不经过任何异步合并**；外部 store 只在"提交(松手)"时收一次值。这样拖动帧是原生同步的（跟手），写库是节流/合并的（不卡）。
3. **推荐写法（两种都成立，看你要不要复用原生 input）**：
   - **(a) 原生 range 受控但"本地缓冲"**：`:value` 绑"本地正在拖的 ref"(本地同步更新)，`@input` 只做"更新本地 + 可选 live emit"，真正异步提交只放 `@change`(松手) 里。本地值不经异步，thumb 全程跟手。
   - **(b) 干脆不用响应式回写，拖动期间直接 `el.value =`**（pascalorg/很多专业控件做法）：拖动帧直接设原生 DOM `el.value` 或更新一个 `--position` CSS 变量，跳过 Vue 渲染；松手才 `emit('commit')` 进 store，再由 store 反哺稳态 value。**最不易抖，代价是"拖动中的值不进响应式"**。
   - 无论哪种，**thumb/进度条都只由本地视觉值算百分比**，别拿"store 值"当拖动中的视觉源。
4. **Vue 特有坑**：
   - range 的 value 必须在 min/max/step 就位后再设（#2325 抖动已修复，自己写仍注意）；Vue `vModelRange` 的赋值与 .number 修饰也走同一回写逻辑。
   - 若必须用"每帧 set 进 store 的 rAF coalescer"，则 coalescer 只负责"更新逻辑值/触发下游效果"，**绝不要让它成为 thumb 定位的数据源**——thumb 用独立本地值。
   - 用 Pointer Events + `setPointerCapture` 拿拖动（键盘 a11y 另加），比原生 input 事件更可控、天然防"点轨道 vs 拖 thumb"混淆（radix/reka 都这么做，且能同时支持"contain/overflow 两种 thumb 定位策略"）。

### 关键来源 URL
- Vue v-model runtime 源码（range 回写逻辑 / mounted 在 min 后设 value）: https://github.com/vuejs/core/blob/7df0edd4/packages/runtime-dom/src/directives/vModel.ts
- Vue issue #2325 range 首帧跳动: https://github.com/vuejs/core/issues/2325
- Vue forum 讨论 range VDOM 更新时序: https://forum.vuejs.org/t/range-input-virtual-dom-update-sequence/104705
- reka-ui SliderRoot（本地 `modelValue` 同步 + commit 分离，即"本地视觉权威"范例）: https://github.com/unovue/reka-ui/blob/49d1d32b/packages/core/src/Slider/SliderRoot.vue
- pascalorg editor slider（拖动直接 setLocal/直写，commit 才交 store）: https://github.com/pascalorg/editor/blob/main/packages/editor/src/components/ui/controls/slider-control.tsx

### 推荐写法骨架
```vue
<!-- 拖动期间只动 local，不把 store 值当视觉源；异步提交放 @change/松手 -->
const local = ref(props.value)              // 视觉权威，拖动期间同步更新
watch(() => props.value, v => { if (!dragging.value) local.value = v })
function onInput(e) { local.value = snap(+e.target.value, step, min); emit('update:modelValue', local.value) /* 或仅 live */ }
function onChange(e)  { emit('commit', local.value) }   // 一次，真正写 store
```
> 若拖动帧要走 rAF coalescer：`onInput` 里 `coalescer.add(local.value)`（异步更新逻辑），但 `local.value` 与 `e.target.value` 同步设，thumb 不依赖 coalescer。

---

## E. 现成的 Vue3/JS "precision slider（带缩放拖动手感）"源码示例

### 结论（按可抄程度排序）
1. **pascalorg/editor `slider-control.tsx`（React，但算法可直接平移 Vue）**：最完整的"修饰键步长缩放 + 中途 re-anchor + live/commit 分离 + 精度单位换算"，直接给出 URL + 上面 C/D 已贴关键片段。**本任务第一参考**。
2. **reka-ui Slider（Vue3 radix 移植，shadcn-vue 底层）**：吸附公式 `roundValue(Math.round((v-min)/step)*step+min, dec)`、`convertValueToPercentage`、本地同步 value + `valueCommit`、Pointer capture、contain/overflow thumb 定位——**完整可读的 Vue3 生产实现**。`SliderRoot.vue`/`SliderHorizontal.vue`/`utils.ts`。
3. **Vuetify `createSlider` composable（Vue3 纯数学层）**：把 `snap`/`fromValue`(value→%)/`fromPercent`(%→吸附值)/clamp 做成无 UI 的纯 composable，驱动任意自定义指针交互（示例是音频 scrubber，正好演示"fromPercent→set→fromValue→UI"每帧跟手回路）。
4. **ktsn/vue-range-slider**：老牌 Vue 组件，演示 `actualValue`(本地)+`round()`+`input`(live)/`change`(松手) 分离的朴素写法，适合理解最小骨架。
5. radix（React）Slider.tsx：想看非 Vue 的精细交互细节（getThumbInBoundsOffset、focus、键盘大步）可参考。

### 关键来源 URL
- pascalorg slider-control: https://github.com/pascalorg/editor/blob/main/packages/editor/src/components/ui/controls/slider-control.tsx
- reka-ui Slider 源码目录: https://github.com/unovue/reka-ui/blob/49d1d32b/packages/core/src/Slider/ （SliderRoot.vue / SliderHorizontal.vue / utils.ts）
- Vuetify createSlider: https://0.vuetifyjs.com/composables/forms/create-slider
- ktsn/vue-range-slider: https://github.com/ktsn/vue-range-slider/blob/HEAD/src/RangeSlider.vue
- radix Slider.tsx: https://github.com/radix-ui/primitives/blob/main/packages/react/slider/src/Slider.tsx

### 可直接抄的吸附 + 百分比（合并自 reka utils）
```ts
const getDecimalCount = (n: number) => (String(n).split('.')[1] || '').length
const roundValue = (v: number, dec: number) => { const r = 10 ** dec; return Math.round(v * r) / r }
// 吸附（含小数误差修正），再 clamp
const snapToStep = (v: number, min: number, step: number, max: number) => {
  const dec = getDecimalCount(step)
  return clamp(roundValue(Math.round((v - min) / step) * step + min, dec), min, max)
}
// value → thumb 百分比
const valueToPct = (v: number, min: number, max: number) => clamp(((v - min) / (max - min)) * 100, 0, 100)
```

---

## 给本项目的推荐方案：PrecisionSlider 设计

前提：后端 schema 提供 `min/max/step/default`；前端用 coalescer 合帧提交；要支持 Ctrl 缩放、thumb 跟手、值吸附 step 网格。

### 架构一句话
**拖动期间用"组件内部本地视觉值"当唯一权威（同步、不经异步），吸附/缩放全在每帧增量换算里做；store 只收松手的一次 commit（走 coalescer 由外层决定合帧策略）。**

### prop / emit 划分（借鉴 radix/reka + element-plus + antd）
- **props（逻辑契约，来自 schema）**：
  - `modelValue: number`（受控值，稳态）
  - `defaultValue?: number`（非受控时可留）
  - `min/max/step: number`（必给；吸附与百分比都以它们为准）
  - `allowDecimals?: boolean`（决定"step 网格是否可真小数"，本质 = schema 精度信息；或直接由 schema 提供 `step` 推导小数位）
  - `precision?: number`（显示/吸附用小数位，兜底 = `getDecimalCount(step)`）
  - `modifierStep?: { ctrl?: number; shift?: number }` 或 `modifierMultiplier?: boolean`（默认 ctrl=×0.1 / shift=×10，参考 pascalorg+UI5；可配）
  - 视觉类：`format-tooltip`、`show-tooltip`、`show-value`（element-plus 风格，纯展示）
- **内部状态（逻辑值）**：
  - `localValue`（= 正在拖的本地值，**拖动期间视觉与 emit 的唯一权威**，拖动中与 store 解耦）
  - `dragging: boolean`
  - 锚点 `{ anchorX, anchorValue, stepMultiplier }`（实现 re-anchor，拖动中换修饰键不跳）
- **内部状态（视觉，纯派生）**：`percent = valueToPct(localValue, min, max)`（thumb 与进度条都吃它，永不各自为政）；thumb 用 CSS transform 定位，不重复存位置。
- **emit**：
  - `update:modelValue`（live，值已吸附）——若你的语义是"拖动中也要把值同步给父做实时预览"则发；**否则别在拖动帧硬发**。
  - `change` / `commit`（**松手一次**，值=吸附最终值）——**真正进 store / undo 的通道**；外层在这里接 coalescer（把 `commit` 的连续值合帧提交），从而"逻辑合并"与"视觉跟手"彻底解耦。
- **要不要包原生 `<input type=range>`**：建议**不依赖它的 thumb 渲染**。可拿原生 range 只当"可访问的隐藏输入/点按轨道读位置"，自己用 Pointer Events + `setPointerCapture` 渲染自定义 thumb/track（radix/reka 路线），进度与 thumb 都由 `percent` 驱动。这样 ctrl 缩放、precision、吸附、跟手全部你自己控制，原生 step 校验那套"网格外不帮你 round"的坑直接绕开。若想省事用原生 range，就按 D 节本地缓冲写法。
- **step 网格语义**：值永远 = `snapToStep(pointer→value)`；`allowDecimals=false` 时 step 强制 ≥1 整数网格；字段允许小数则 step 可为小数，吸附公式天然支持。
- **Ctrl 缩放**：拖动中 `stepMultiplier = ctrl?0.1 : 1`，位移换算 `anchorValue + (dx/pxPerStep)*step*multiplier`；换修饰键瞬间 re-anchor。吸附在换完步长后再做，值必在**当前**精细网格上，thumb 跟手且合法。
- **键盘 a11y（建议一并做）**：方向键=±step，`PageUp/Down` 与 `Shift+方向`=大步（`(max-min)/10`），Home/End=min/max，并配 `aria-valuemin/max/now`（element-plus/radix 都有此实现可抄）。

### 推荐最小依赖
自研一个 `<PrecisionSlider>` 组件（+ 可选 `usePrecisionSlider` composable 纯数学层，参照 Vuetify createSlider），不引入重型组件库。业务里"每字段一个实例"时：schema → props(min/max/step/default)，`@commit` 接到现有 coalescer。

### 一句话落地检查表（对应你反复踩的坑）
- [ ] thumb 位置只来自 `percent(localValue)`，绝不来自"store 回传值"
- [ ] 拖动帧只改 local，store 收 `commit`（松手），经 coalescer 合帧
- [ ] 吸附在每帧增量换算里做，value 永远在 step 网格上（含小数 step）
- [ ] ctrl 缩放只改步长换算，换键即 re-anchor，不跳回起点
- [ ] 原生 range（若用）的 min/max/step 先于 value 就位
