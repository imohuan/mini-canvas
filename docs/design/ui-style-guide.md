# mini-canvas UI 样式规范（Style Guide）

> **本文件是所有画布浮层 / 菜单 / 面板 / 弹窗 UI 的唯一视觉规则来源。新写 UI 前先读本文件；数值不许凭感觉发明，要改规则先改本文件。**
>
> 风格定性：**浅色「软扁平」（Soft Minimalism）+ 开发者工具级紧凑密度**——中性灰阶承载层级、单一青色强调、柔和大阴影、嵌套圆角、弹性微交互。视觉对标 Linear / Notion / Vercel / shadcn-ui 的浮层语言。

## 0. 金标准参考实现（改样式前对照看）

| 角色 | 文件 |
|---|---|
| 浮层菜单母体（类名 `canvas-menu-*` 即全局通用类） | `packages/canvas-core/src/components/Menu/CanvasMenu.vue` |
| 模态对话框样板 | `packages/canvas-core/src/plugins/shortcut-manager/ShortcutHelpPanel.vue` |
| 内嵌卡片 / 表单 / 按钮样板 | `packages/canvas-core/src/plugins/shortcut-manager/RemapPanel.vue` |
| 键帽 Kbd | `packages/canvas-core/src/plugins/shortcut-manager/ShortcutKeys.vue` |

新组件必须与上述四个文件视觉一致；拿不准时直接复用其数值与类名。

---

## 1. 五条设计原则

1. **灰度建立层级，颜色只表语义。** 90% 的界面由灰阶 + 黑色透明度构成；青色只表示"可交互/当前/品牌"，琥珀=警告，红=危险，除此之外不引入新彩色。
2. **柔和分层，不要硬边。** 层级靠大偏移、超低透明度的柔和阴影 + 1px 发丝边，不靠粗边框、不靠重投影。
3. **外圆大于内圆。** 容器圆角必须严格大于其内部元素圆角（16→12→10→8→6），形成嵌套秩序。
4. **紧凑但不拥挤。** 桌面工具字号可以小，但交互行高不低于 44px，元素间隙不低于 4px。
5. **动效短、统一、可关闭。** 微交互 150–240ms，统一回弹曲线；必须写 `prefers-reduced-motion` 降级。

---

## 2. Design Tokens

### 2.1 颜色

#### 文字灰阶（只允许这四档）

| Token | 值 | 用途 |
|---|---|---|
| `--text-strong` | `#111827` | 标题、行主标签、输入文字 |
| `--text-body` | `#374151` | 面板默认文字 |
| `--text-muted` | `#6b7280` | 图标、次要按钮文字 |
| `--text-faint` | `#9ca3af` | 分组标题、placeholder、eyebrow、分割提示 |

#### 中性填充（用黑色透明度叠加，禁止再发明灰色 hex）

| Token | 值 | 用途 |
|---|---|---|
| `--fill-quiet` | `rgba(0,0,0,0.03)` | 凹陷录制区底 |
| `--fill-subtle` | `rgba(0,0,0,0.04)` | 图标托 / 图标按钮 / 搜索框静态底 |
| `--fill-hover` | `rgba(0,0,0,0.05)` | 行/按钮 hover |
| `--fill-active` | `rgba(0,0,0,0.06)` | 搜索框 focus-within、静态加深 |
| `--fill-divider` | `rgba(0,0,0,0.06)` | 分割线 |
| `--line-hair` | `rgba(0,0,0,0.08)` | 1px 发丝边框 |
| `--line-dashed` | `rgba(0,0,0,0.18)` | 虚线录制框 |
| `--scrollbar` | `rgba(0,0,0,0.12)`（hover `0.2`） | 细滚动条 |

> 为什么用黑色透明度而不是灰 hex：翻转暗色主题时只需换底色，填充层级自动成立。

#### 品牌与语义色（每种只有"文字/实心"+"浅底"两种用法）

| 语义 | 实心/文字 | 浅底 | 用途 |
|---|---|---|---|
| 品牌青 Primary | `#0891b2`（hover 加深 `#0e7490`） | `rgba(8,145,178,0.10/0.12/0.20/0.22)` | 主按钮、Badge、展开态、focus ring |
| 警告 Warning | `#b45309` | `rgba(245,158,11,0.14/0.16)` | 冲突、系统保留键提醒 |
| 危险 Danger | `#ef4444` | `rgba(239,68,68,0.10)` | 删除类行、关闭按钮 hover |
| 焦点环 Ring | — | `2px solid rgba(8,145,178,0.6)` | `:focus-visible`，见 §5 第 1 条 |

主按钮为青底白字（`#0891b2` + `#fff`），hover `#0e7490`。**全界面同一时刻只允许一个实心主按钮。**

### 2.2 圆角（嵌套阶梯，不许跳级）

| Token | 值 | 用于 |
|---|---|---|
| `--radius-badge` | 6px | Badge、Kbd、文本按钮 |
| `--radius-control` | 8px | 图标按钮、图标托、输入、主按钮 |
| `--radius-row` | 10px | 菜单行、搜索框、内嵌卡片 |
| `--radius-open` | 12px | 展开态行 |
| `--radius-panel` | 16px | 浮层面板 / 菜单容器 |
| `--radius-pill` | 999px | 计数/冲突胶囊 |

### 2.3 字号与字重（桌面工具密度）

| Token | 字号 | 字重 | 用于 |
|---|---|---|---|
| `--text-xs` | 10px | 700 | Badge 内文字 |
| `--text-sm` | 11px | 400–700 | 描述副标题、Kbd、分组辅助、反馈 |
| `--text-label` | 12px | 600–700 | 分组标题、小按钮文字 |
| `--text-base` | 13px | 500–600 | 行标签、搜索输入、面板正文 |
| `--text-title` | 15px | 700 | 面板标题 |

- 中文正文最低 12px；10–11px 只允许出现在徽章/键帽等微元件上。
- 层级用字重拉开：标题 700 → 行标签 600 → 正文 400/500。
- eyebrow / 固定宽度小标签加 `letter-spacing: 0.04em`。
- 键帽与键位序列一律 `font-family: var(--font-mono)` 等宽字体。

字体栈：继承宿主系统字体栈，不另引网络字体；等宽用 `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`。

### 2.4 间距

- 基础倍数 2px，常用档：4 / 6 / 8 / 10 / 12（浮层内部属于紧凑场景，不用 16 以上的大内边距）。
- 面板内边距 12px；菜单容器内边距 10px。
- 同行元素 gap：行内 10px；按钮组 4px。
- 分割线：`height:1px; margin:6px 4px; background:var(--fill-divider)`。

### 2.5 阴影与高度（Elevation）

| 层级 | 值 | 用于 |
|---|---|---|
| e0 | 无阴影 | 行、静态控件 |
| e1（内嵌卡） | `0 2px 10px rgba(0,0,0,0.04)` | 面板内展开的白卡 |
| e2（浮层） | `0 20px 40px rgba(0,0,0,0.08)` | 菜单 / 模态面板 |

浮层一律搭配 `border:1px solid var(--line-hair)`。禁止使用偏移小、边缘黑的"硬阴影"。

### 2.6 浮层材质（两档，按用途选）

| 档 | 背景 | 模糊 | 用于 |
|---|---|---|---|
| 毛玻璃菜单 | `rgba(255,255,255,0.82)` | `backdrop-filter: blur(20px)` | 右键菜单、轻量弹出菜单（CanvasMenu） |
| 不透光对话框 | `#ffffff`（不写 blur） | — | 承载表单/长列表的模态（ShortcutHelpPanel） |

遮罩层（scrim）：`background:linear-gradient(180deg, rgba(15,23,42,0.06), rgba(15,23,42,0.18)); backdrop-filter: blur(2px);`，刻意保持很淡，不遮挡画布阅读。

> 技术债：ShortcutHelpPanel 当前在纯白底上残留了无效的 `blur(20px)`，新代码不要照抄——要么半透明配 blur，要么纯白不写 blur。

### 2.7 动效

| Token | 值 | 用于 |
|---|---|---|
| `--dur-press` | 0.15s | 按钮 hover/active |
| `--dur-hover` | 0.18s | 行、图标按钮、Badge 的状态过渡 |
| `--dur-item` | 0.2s | 列表项入场 |
| `--dur-card` | 0.22s | 内嵌卡片展开 |
| `--dur-panel` | 0.24s | 浮层入场 |
| `--dur-reveal` | 0.3s | 行副标题 hover 揭示 |
| `--ease-back` | `cubic-bezier(0.34,1.56,0.64,1)` | 入场/展开（带轻微回弹的签名曲线） |
| `--ease-out` | `ease-out` | 位移揭示 |
| stagger | 每项延迟 18ms（菜单 25ms） | `animation-delay: calc(var(--item-index) * 18ms)` |

- 浮层入场：`scale(0.94) translateY(-4px) → 正常`，配 `--ease-back`。
- 列表项入场：`translateY(4px) + opacity 0 → 正常`，按索引交错。
- 主按钮按下：`transform: scale(0.97)`。
- 录制/等待态：1.2s 青色脉冲环（`box-shadow` 扩散），这是唯一允许的循环动画。
- **只允许动画 `opacity / transform`，不动画 width/height/top/left。**

### 2.8 z-index

| 层级 | 值 |
|---|---|
| 浮层（菜单/模态） | `100000` |

同一时刻只允许一个浮层；新浮层类型沿用该值，禁止自增魔法数字，确需多层时先在本表登记。

---

## 3. 组件规范

### 3.1 浮层骨架（所有模态/菜单统一）

```html
<Teleport to="body">
  <div class="x-layer" @pointerdown.self="close" @contextmenu.prevent>
    <div class="x-panel" @pointerdown.stop><!-- 内容 --></div>
  </div>
</Teleport>
```

- `position:fixed; inset:0; z-index:100000;` flex 居中，模态四周留 32px padding。
- 点遮罩（`.self`）关闭、`@pointerdown.stop` 阻止面板内穿透、统一拦截右键菜单。
- **Esc 必须能关闭**：`onMounted` 注册 `document.addEventListener('keydown')`，`onUnmounted` 卸载。
- 模态尺寸参考：宽 `min(640px,100%)`，高 `min(80vh,720px)`；纵向 flex，列表区 `flex:1; min-height:0; overflow-y:auto`。

### 3.2 菜单行 MenuRow

- 高 44px、padding 6px、gap 10px、圆角 10px、默认透明底、hover `--fill-hover`，过渡 `background .18s var(--ease-back)`。
- 左侧图标托：28×28、圆角 8、`--fill-subtle` 底、`--text-muted` 色，内嵌 SVG 16×16。
- 文案区：label 13px/600/`--text-strong`；可选 description 11px/`--text-faint`，默认隐藏，**hover/focus-within 时 label 上移到 top:3px、description 从 translateY(6px) 淡入**（0.3s ease-out）。
- 右侧依次放：Kbd 序列 → 语义 Badge。
- 禁用：`cursor:not-allowed; opacity:.38`。危险：文字 `--danger`，hover 底 `rgba(239,68,68,.1)`。

### 3.3 按钮

| 类型 | 规格 |
|---|---|
| 图标按钮 | 32×32、圆角 8、`--fill-subtle` 底、`--text-muted`，hover 升 `--fill-active` + `--text-strong`；SVG 16px；关闭按钮 hover 文字转红 |
| 文本按钮 | 无边框透明底、padding 6px 10px、圆角 6、12px/600、`--text-muted`，hover `--fill-hover`；带图标时间距 4px、SVG 12px |
| 主按钮 | 青底白字、padding 6px 14px、圆角 8、12px/700，hover `#0e7490`，active `scale(.97)` |

- 禁用：`opacity:.4; cursor:not-allowed`，并真正加 `disabled`。
- 异步/录制进行中主按钮必须 disabled。

### 3.4 Badge / 内联反馈

- 通用：padding 2px 6px、圆角 6、10px/700；青色款 = 青字 + `rgba(8,145,178,.12)` 底，hover 底色 .2。
- 警告款：`#b45309` 字 + `rgba(245,158,11,.16)` 底，无 hover。
- 计数胶囊（如"N 个冲突"）：圆角 999、11px/700，嵌在搜索框右侧。
- 待生效提示：青底 .1 + `#0e7490` 字。

### 3.5 Kbd 键帽

- md：高 22px、min-width 22px、padding 0 6px；sm：18px / padding 0 5px。
- `background:#fff; border:1px solid var(--line-hair); border-bottom-width:2px;`（2px 底边模拟物理键厚度，是本风格唯一拟物细节，保留）。
- 圆角 6（sm 为 5）、等宽字体、11px/700（sm 10px）、`--text-body`。
- 多键之间用 10px/700 的 `+`（`--text-faint`）连接，gap 4px。
- 空态占位用 dashed 边 + `--fill-quiet` 底。

### 3.6 搜索输入

- 容器：flex、gap 8px、padding 6px 10px 6px 12px、圆角 10、`--fill-subtle`，`:focus-within` 升 `--fill-active`，过渡 .18s。
- 前置搜索 SVG 14px、`--text-faint`；input 去边框去 outline、透明底、13px/500、`--text-strong`，placeholder 用 `--text-faint`。
- 打开浮层时输入框 `autofocus`。

### 3.7 标题区

- 双行结构：eyebrow（11px/700/`--text-faint`/字距 .04em）+ 标题（15px/700/`--text-strong`），两行 gap 2px。
- 右侧放图标按钮组，gap 4px。
- 分组小标题：12px/700/`--text-faint`，margin 4px 6px。

### 3.8 内嵌展开卡（行内展开二级面板）

- 外层行展开后变纵向：青色浅底 `rgba(8,145,178,.1)`、圆角 12；内嵌白卡：白底、1px `rgba(8,145,178,.16)` 青调边、圆角 10、e1 阴影、0.22s `--ease-back` 上滑淡入。
- 表单行：label 固定 48px 宽、11px/700/`--text-muted`/字距 .04em，value 区 `flex:1`，保证上下行对齐。
- "录制/选择类"输入框：dashed 1px `--line-dashed` + `--fill-quiet` 凹陷感；hover 转青边青底；进行中转实线青边 + 脉冲环；有值转白底实线灰边。
- 底部动作条：左反馈信息、右按钮组，`justify-content:space-between`。

### 3.9 滚动条

```css
.list::-webkit-scrollbar { width: 8px; }
.list::-webkit-scrollbar-thumb { border-radius:4px; background:rgba(0,0,0,.12); }
.list::-webkit-scrollbar-thumb:hover { background:rgba(0,0,0,.2); }
.list { scrollbar-width: thin; }
```

### 3.10 图标

- 统一线性图标：`viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`（Lucide/Feather 规范）。
- 尺寸档：12（文本按钮内）/ 14（输入框前）/ 16（行、图标按钮），不允许其他尺寸。
- 一律内联 SVG + `currentColor`，禁止位图、禁止用 emoji 充当结构图标（警示也优先用 alert 类 SVG；现有 `⚠` 字符属于待还技术债）。
- 同一界面内描边宽度、圆角风格必须一致，不混用填充/线性两套图标。

---

## 4. 动效落地模板

```css
.panel { animation: panel-in .24s cubic-bezier(0.34,1.56,0.64,1); }
.row   { animation: item-in .2s ease both;
         animation-delay: calc(var(--item-index, 0) * 18ms); }
@keyframes panel-in { from { opacity:0; transform:scale(.94) translateY(-4px);} to {opacity:1; transform:none;} }
@keyframes item-in  { from { opacity:0; transform:translateY(4px);}        to {opacity:1; transform:none;} }

/* 强制：每个带动画/过渡的组件都必须带降级 */
@media (prefers-reduced-motion: reduce) {
  .panel, .row { animation:none !important; transition:none !important; }
}
```

---

## 5. 无障碍（硬性，不达标不算完成）

1. **focus-visible**：去掉浏览器默认 outline 的同时必须补青色环：`outline:2px solid rgba(8,145,178,.6); outline-offset:1px`（行/内嵌用 -1px）。
2. 可点行加 `role="button" tabindex="0"`；但**不要在 role=button 容器里再嵌套真实 `<button>`**（读屏冲突）——需要两个动作时改用 listitem + 内部按钮的结构。
3. 纯图标按钮必须同时有 `title` 和 `aria-label`；输入框必须有可见 label 或 `aria-label`，不能只靠 placeholder。
4. 交互目标 ≥ 32px（图标按钮），列表/行级目标 44px。
5. 文字对比度 ≥ 4.5:1；浅底彩字（青/琥珀）只用于 ≥700 字重的小字徽章。
6. 模态三要素：Esc 关闭、点遮罩关闭、打开后焦点进入面板（并逐步补 focus trap 与关闭后焦点归还）。
7. 不允许把关键信息只放在 hover 里——触屏无 hover；需要 hover 揭示的内容同时保证 focus-within 可达，或提供常显/点按展开路径。
8. 全部动画遵守 `prefers-reduced-motion`。

---

## 6. Do / Don't 速查

| ✅ Do | ❌ Don't |
|---|---|
| 用四档灰阶 + 黑色透明度做层级 | 自造灰色 hex、用彩色铺大面积底 |
| 强调只用青，警告琥珀、危险红 | 引入第二个品牌色、多彩混用 |
| 圆角 16→12→10→8→6 逐级嵌套 | 内外同圆角或内层比外层圆 |
| 浮层用 `0 20px 40px rgba(0,0,0,.08)` 柔影 | 小偏移硬黑边阴影 |
| 150–240ms + 统一回弹曲线 | >500ms 的慢动画、linear 匀速、装饰性循环动画 |
| 内联线性 SVG、currentColor | emoji/位图当图标、同一层混两套图标风格 |
| 状态过渡 .18s、主按钮 active scale(.97) | 状态瞬切 0ms、按下无反馈 |
| 新组件复用 `canvas-menu-*` 既有类与数值 | 在组件里另写一套近似但不同的数值 |
| 半透明底才配 backdrop-blur | 纯白底上写无效 blur |

---

## 7. 新 UI 交付前验收清单

- [ ] 颜色全部来自 §2.1，无散落的临时 hex；语义色用法正确
- [ ] 圆角符合嵌套阶梯；间距只用 4/6/8/10/12 档
- [ ] 字号/字重来自字号表，中文不小于 12px（微元件除外）
- [ ] 阴影来自 e1/e2，浮层有发丝边
- [ ] 图标全部 24-viewBox 线性 SVG，尺寸只用 12/14/16
- [ ] 行 44px、图标按钮 32px；hover/disabled/active/focus-visible 四态齐全
- [ ] 动效时长与缓动来自 token 表，且写了 reduced-motion 降级
- [ ] Esc / 点遮罩关闭、aria-label、focus ring、对比度达标
- [ ] 与四个金标准组件并排目测无风格跳变

---

## 8. 已知技术债（新代码不要复制，逐步偿还）

1. 颜色/圆角/动效目前以硬编码散落在各组件，尚未落成全局 CSS 变量；**目标态以 §2 token 表为准**，后续应抽到共享样式层，新组件优先引用变量。
2. `ShortcutHelpPanel.vue` 纯白底上的 `backdrop-filter:blur(20px)` 无效，待删或改半透明。
3. 冲突/警告处使用了 Unicode `⚠`，应统一替换为线性 SVG 警示图标。
4. 模态缺 focus trap 与焦点归还，待补。
5. 行 `role=button` 内嵌 `<button>` 的嵌套交互问题，待按 §5 第 2 条重构。
6. `z-index:100000` 待收敛为统一层级变量/常量。

---

## 9. 变更规则

- 本文件是 UI 契约的一部分：**新增/修改 token 或组件规则必须先改本文件，再改组件**，并在 PR 说明中写明对哪几个金标准组件有影响。
- 与 `docs/STATUS.md` 主线冲突时，以主线任务为先；纯样式重构不进入进行中的最小闭环任务，另开任务执行。
