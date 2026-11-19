<script setup lang="ts">
/**
 * ToolParamGroup —— 「多参数收敛成一个下拉」的展示件（参考 LibTV 底行的
 * 「16:9 · 标准画质 · 2K · 1张 ⌄」那种一串点分 + 一个箭头）。
 *
 * 为什么单独一件：节点底栏的参数是工具声明式给的（比例/画质/分辨率/张数…），
 * 一参数一个下拉会把底行挤爆；参考实现把它们收成一个按钮 + 一个浮层，
 * 点击后在浮层里逐项改。放在设计系统目录里（ui 场按名 toolParamGroup 取），
 * 换主题时它跟着一起换。
 *
 * **两种形态**（按参数内容自动选，见 `resolveInlineSoleSelect`）：
 * 1. **收成面板**（默认）：≥2 个参数、或那一个是滑块/按钮网格这类预设件 —— 点开面板逐项改；
 * 2. **直接铺一个下拉**：只有一个参数、且它就是普通下拉时不再套面板（用户口径 2026-10-14
 *    「没有必要做成这种二级菜单……如果里面只有唯一的一项，并且它是下拉的话，
 *    就直接把它做成外部的形式」）—— 省掉「先开面板、再开下拉」那一次点击。
 *
 * 依赖方向：只 import 内核 ToolParamDef 类型 + 本包自家 UI 组件，不反向依赖节点插件。
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { ToolParamDef } from '@plume-canvas/kernel'
import { Popover, PopoverContent, PopoverTrigger, ScrollArea, usePopupGroup } from '@plume-canvas/ui-kit'
import ToolParamField from './ToolParamField.vue'
import ToolParamHint from './ToolParamHint.vue'
import { drawsOwnTitle, resolveInlineSoleSelect } from './paramKind'

/**
 * 参数面板里的下拉不该把面板关掉（用户 2026-11-18）。
 *
 * 插槽内容不属于外层 Popover 的子孙，provide 的链是断的，只能靠分组认亲。
 */
usePopupGroup()

const props = withDefaults(
  defineProps<{
    params?: ToolParamDef[]
    values?: Record<string, unknown>
    disabled?: boolean
    /** 参数都没值时的占位文案 */
    placeholder?: string
    /**
     * 外部指定的标题（用户 2026-11-17）。
     *
     * 底栏让 provider 用 selectLabel 算标题（例如带当前档位的花费）。
     * 给了它就用它；**同时不再铺成单个下拉** —— 那个形态没有标题位，会把它吞掉。
     */
    title?: string
    /** id 前缀（同一面板多份时保证 label/for 唯一） */
    idPrefix?: string
  }>(),
  { params: () => [], values: () => ({}), disabled: false, placeholder: '默认参数', idPrefix: 'tpg', title: '' },
)

const emit = defineEmits<{
  change: [key: string, value: string | number | boolean]
}>()

/**
 * 该参数是不是走「预设件」渲染（比例网格 / 按钮网格 / 滑块）。
 *
 * 用途只剩一个：**预设件自己在块内画标题**（各预设件的 h4），所以外层不再重复画一遍；
 * 非预设件（普通下拉 / 开关 / 输入）没有标题，由外层补一行标题。
 *
 * 版式**只有一种**（2026-10-14 统一）：每个参数都占一整块 ——
 * 第一行标题、第二行控件，块间 12 间距 + 一条分割线。
 * 从前非预设件走「标签 + 控件」横排，与预设件的竖排块并排出现两种观感，用户要求统一。
 */
/** 控件自己画标题的（比例网格 / 按钮网格），外层不再补标题 */
const isPreset = (p: ToolParamDef): boolean => drawsOwnTitle(p)
/**
 * 全部参数（**按声明顺序**渲染）。
 *
 * 从前这里分成 presetParams / rowParams 两批、先渲染预设块再渲染横排行 —— 混合面板里
 * 参数的先后会被打乱（声明在中间的那个下拉会被排到最后）。现在统一成一种块，就按声明顺序走。
 */
const blocks = computed(() => props.params ?? [])

/**
 * 铺到外面的那一个下拉（命中时不再套面板）。
 *
 * 判定在 `paramKind.ts` 的纯函数里（可单测）：恰好一项 + 是内置下拉 + 不是长名单大类。
 * 命中时宿主（底栏）那格不再出现「参数摘要按钮」，直接就是一个和左边模型下拉并排的下拉。
 */
const inlineParam = computed(() => {
  // 有自定义标题时必须走摘要按钮：单个下拉那种形态没有标题位，标题会被吞掉
  if ((props.title ?? '').trim() !== '') return undefined
  return resolveInlineSoleSelect(props.params ?? [])
})

/** 每项当前值的显示文案（有 options 就用 option 的 label，否则原样字符串化） */
function labelOf(p: ToolParamDef): string {
  const v = props.values?.[p.key]
  if (v === undefined || v === null || v === '') return ''
  const opt = p.options?.find((o) => o.value === v)
  return opt ? opt.label : String(v)
}

/**
 * 摘要：**只显示改过默认值的参数**（用户 2026-11-16）。
 *
 * 从前是把每个参数的值都铺出来（`MP3 · 24 kHz · 0 · 0 · 0`），
 * 底栏那格只有一百多像素，结果把左边的模型名挤成省略号，也读不出重点。
 * 现在：全默认 → 「参数 5」；改了一两个 → 只写那两个；再多用「+N」收尾。
 */
const summary = computed(() => {
  const rows = props.params ?? []
  if (rows.length === 0) return ''
  const changed: string[] = []
  for (const p of rows) {
    const v = props.values?.[p.key]
    if (v === undefined || v === null || v === '') continue
    if (p.default !== undefined && String(p.default) === String(v)) continue
    const label = labelOf(p)
    if (!label) continue
    // 有选项的值自带含义（WAV / 48 kHz）；裸数字才补上参数名（语速 20）
    const hasOptions = (p.options?.length ?? 0) > 0
    const name = (p.label ?? '').trim()
    changed.push(!hasOptions && name ? name + ' ' + label : label)
  }
  // 全默认只说「参数」：挂个数字会被读成第几个参数（用户 2026-11-16）
  if (changed.length === 0) return '参数'
  if (changed.length <= 2) return changed.join(' · ')
  return changed.slice(0, 2).join(' · ') + ' +' + (changed.length - 2)
})

/**
 * 触发器上真正显示的标题：外部给的 title 优先（用户 2026-11-17）。
 *
 * 底栏用它显示 provider 算出来的花费；没给就是原来的摘要，表现完全不变。
 */
const triggerTitle = computed(() => {
  const custom = (props.title ?? '').trim()
  return custom !== '' ? custom : summary.value
})

/**
 * 这次「点外面」是不是其实点在面板 / 二级浮层里（用户 2026-11-18）。
 *
 * 二级浮层（Select / DropdownMenu）会 portal 到 body，不在面板 DOM 树内，
 * 所以除了 .tpg-popover 本身，还要认浮层内容那几个 data-slot。
 *
 * 判在内层 → preventDefault，外层 Popover 保持打开；
 * 点画布空白 → 不拦，交给 Popover 正常关闭。
 */
function isInsidePanel(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const inside =
    Boolean(target.closest('.tpg-popover')) ||
    Boolean(
      target.closest(
        '[data-slot="popover-content"], [data-slot="dropdown-menu-content"], [data-slot="select-content"], [role="listbox"], [role="menu"]',
      ),
    )
  return inside
}

/**
 * 最近一次按下鼠标时，起点是不是在面板（含它弹出的二级浮层）里。
 *
 * 为什么需要记起点（用户 2026-11-18 的第三步）：在面板内部空白处点一下，
 * 内层下拉会收起、焦点随之掉到画布节点上。此时 focus-outside 的事件目标
 * 是画布节点（vue-flow__node），光看「目标在不在面板里」必然判成外部，
 * 于是外层参数面板跟着一起被关掉。
 *
 * 鼠标按下的那一下目标才是真实意图：起点在面板里 → 这一下属于面板内部操作。
 * 300ms 宽限足够覆盖 pointerdown → focusout 这条链。
 */
let lastPanelPointerAt = 0
function onPanelPointerDown(ev: PointerEvent): void {
  // 起点在面板外 → 立刻作废这次「面板内操作」的记录，
  // 这样紧接着点画布空白能马上把面板关掉，不会被上一条 300ms 窗口误拦。
  lastPanelPointerAt = isInsidePanel(ev.target) ? performance.now() : 0
}
const pressedInsidePanel = (): boolean => performance.now() - lastPanelPointerAt < 300

/**
 * 点面板里的二级下拉时不要关面板（用户 2026-11-18 报的 BUG）。
 *
 * 三个事件都要拦：interact（指针 + 焦点合集）、pointer-down，以及 focus-outside。
 * 判据是「这次操作起点在面板里」，而不是「事件目标在面板里」：
 * 收起内层下拉时焦点会跳到画布节点上，目标不在面板里，但操作确实发生在面板内。
 *
 * 注意监听器必须挂在 PopoverContent 上：Reka 只由 Content 发这几个事件，
 * 挂在 Popover 根组件上等于没挂（之前就是这个错，所以怎么改都没效果）。
 */
function onOutside(e: Event): void {
  /**
   * 焦点事件**一律不关面板**（用户 2026-11-18 第三次复现后的定论）。
   *
   * 实测链条：参数面板里开了内层下拉 → 再点它的触发器收起 → 焦点先回触发器、
   * 再甩到输入框（ProseMirror），外层收到 focus-outside，而事件目标已经是编辑器。
   * 试过用「起点在面板里」「焦点在面板里」「内层浮层还开着」来判断，
   * 都会在焦点被组件库移走的那一帧失效，所以这里直接不看目标。
   *
   * 为什么这样安全：参数面板本身是非模态的，用户在里面改参数时焦点本来就该能
   * 自由移动（输入框、下拉、滚动条）。真正表示「点了外面」的是 pointer-down-outside
   * 和 interact-outside，那两条仍按目标判断 —— 点画布空白照样会正常关闭。
   */
  /*
   * 注意事件名带命名空间：实测是 `dismissableLayer.focusOutside`（不是 focusoutside）。
   * 之前写成全等比较，永远不成立，于是"焦点事件不关面板"这条根本没生效
   * —— 这就是这个问题反复复现三次的真正原因。
   */
  if (/focus.?outside$/i.test(e.type)) {
    e.preventDefault()
    return
  }
  if (isInsidePanel(e.target) || pressedInsidePanel()) e.preventDefault()
}

// 用捕获阶段挂在 document 上：内层下拉收起时它的 pointerdown 可能被
// 别的图层先消费掉，冒泡到面板时已经来不及记「起点」了。
onMounted(() => {
  document.addEventListener('pointerdown', onPanelPointerDown, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPanelPointerDown, true)
})
</script>

<template>
  <!--
    形态 2：**只有唯一一个普通下拉参数** → 直接铺到外面（不套面板）。

    用户口径（2026-10-14）：「没有必要做成这种二级菜单……如果里面只有唯一的一项，
    并且它是下拉的话，就直接把它做成外部的形式」。复用 ToolParamField 渲染，
    于是它在底栏的外观与左边那个「模型下拉」完全同款（同一个 Select）。
  -->
  <div v-if="inlineParam" class="tpg-inline">
    <ToolParamField
      :param="inlineParam"
      :model-value="(values?.[inlineParam.key] as string | number | boolean) ?? ''"
      :disabled="disabled"
      :id-prefix="idPrefix + '-inline'"
      @update:model-value="(v: string | number | boolean) => emit('change', inlineParam!.key, v)"
    />
  </div>

  <!--
    默认左侧展开 + 自动翻转：底栏这个按钮靠近右侧时，向右展开会被屏幕边缘裁掉
    （2026-11-03 实测：面板右缘被切掉一格）。reka 默认 `avoidCollisions` 会翻到左侧。
  -->
  <!--
    浮层开合**交给 Popover 自己管**，这里不再存一份 `ref(false)`。

    为什么要去掉（2026-11-04 排查「两个浮层同时打开」）：
    自己接管 `v-model:open` 之后，组件内建的「点外面关闭」只是通知外面改那个变量；
    业务侧一旦漏处理（或与另一个浮层各存一份状态），就会出现两个面板同时挂着。
    不受控时由组件统一执行点外关闭 / Esc / 切换，和菜单、选择器行为一致。

    按钮的开启态视觉改用 Popover 透传的 slot 状态（`data-state`），不需要我们自己维护变量。
  -->
  <!--
    点面板里的二级下拉时**不要关面板**（用户 2026-11-18 报的 BUG：
    「点同一个下拉的 trigger，第二次点击会把整个菜单关掉」）。

    外层是 Popover，内层的 Select / DropdownMenu 会 portal 到 body，
    于是那次点击在 Popover 看来就是「点了外面」。这里在 interact-outside 里拦下：
    只要点击目标还在面板里、或在任一层浮层内容里，就不关闭。
  -->
  <Popover v-else>
          <PopoverTrigger as-child>
      <button
        type="button"
        class="tpg-trigger"
        :disabled="disabled"
        aria-haspopup="dialog"
        :aria-label="triggerTitle || placeholder"
      >
        <span class="tpg-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="6" width="18" height="12" rx="2" />
          </svg>
        </span>
        <span class="tpg-text">{{ triggerTitle || placeholder }}</span>
        <span class="tpg-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
          </PopoverTrigger>

    <!--
      统一定位：左对齐（align="start"）+ 向下（side="bottom"），与底栏/provider 面板同一口径。
      以前这里写 align="end"（右对齐），于是「provider 面板的模型」左对齐、
      「走 ToolParamGroup 的模型」右对齐 —— 用户 2026-11-08 截图指出的正是这个不一致。
    -->
    <PopoverContent
      align="start"
      side="bottom"
      :side-offset="4"
      :collision-padding="12"
      data-tpg-build="v3"
      class="tpg-popover tpg-menu-body tpg-menu-body--blocks"
      @interact-outside="onOutside"
      @pointer-down-outside="onOutside"
      @focus-outside="onOutside"
    >
      <!--
        内容用 shadcn ScrollArea 滚动（用户 2026-11-08）：滚动条贴面板最右侧。
        父容器右 padding 收窄到 4px、内层再补 12px，左右视觉留白仍一致，
        滚动条不再浮在内容中间。
      -->
      <ScrollArea type="always" class="tpg-scroll">
        <div class="tpg-menu tpg-menu--blocks">
        <!--
          统一版式：一个参数 = 一整块（第一行标题、第二行控件），按声明顺序排。
          预设件（比例网格 / 按钮网格 / 滑块）自己就画标题，所以这里只在**非预设件**
          前面补一行标题 —— 从前非预设件走横排「标签 + 控件」，与预设件的竖排块两种观感并存，
          用户要求统一成竖排这一种。
        -->
        <div v-for="p in blocks" :key="p.key" class="tpg-block">
          <div v-if="!isPreset(p)" class="tpg-head">
            <h4 class="tpg-title">{{ p.label || p.key }}</h4>
            <!-- 参数说明（用户 2026-11-09）：标题下面一行灰字，与各预设件的排版一致 -->
            <ToolParamHint :text="p.description" />
          </div>
          <ToolParamField
            :param="p"
            :model-value="(values?.[p.key] as string | number | boolean) ?? ''"
            :disabled="disabled"
            :id-prefix="idPrefix + '-b'"
            hide-hint
            @update:model-value="(v: string | number | boolean) => emit('change', p.key, v)"
          />
        </div>
          <div v-if="blocks.length === 0" class="tpg-empty">该动作没有额外参数</div>
        </div>
      </ScrollArea>
    </PopoverContent>
  </Popover>
</template>

<style scoped>
/*
 * 形态 2（铺到外面）的根：与宿主那一格等宽，内部就是一个普通下拉。
 * `display: block` + `width: 100%`：底栏给它多宽就多宽（与左边模型下拉对齐）。
 */
.tpg-inline {
  display: block;
  /*
   * 宽度**跟着内容走**（用户 2026-11-09 第二次纠正）：
   * 值就两个字就只占两个字那么宽，长名字才变宽。
   *
   * 不写 `width: 100%`：那会让它去填满宿主那一格，
   * 值很短时右边空出一大片（用户截图里"占那么大空间"就是这个）。
   * `max-content` + 上限：内容多宽就多宽，撑到上限就省略号。
   *
   * `!important` 是用户明确要求的（SelectTrigger 自带的 min-width 会压住这一层）。
   * 下限 80px 也是用户给的具体值：再窄连"模型 A"都放不下，箭头和文字会挤在一起。
   */
  width: max-content;
  max-width: 100%;
  min-width: 80px !important;
}
/* 触发器照参考：h32、圆角 8、透明底、hover 浅底、13px 正文 */
.tpg-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  /* 跟着根一起撑满；摘要仍靠 .tpg-text 的 ellipsis 截断，不会把底行挤爆 */
  flex: 1 1 auto;
  width: 100%;
  min-width: 0;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-ink, #18202b);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease-out;
}
.tpg-trigger:hover:not(:disabled),
.tpg-trigger[data-state='open'] {
  background: var(--ui-hover, rgb(0 0 0 / 0.06));
}
.tpg-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.tpg-trigger:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ui-accent, #0891b2) 60%, transparent);
  outline-offset: 1px;
}
.tpg-glyph {
  display: inline-flex;
  flex: none;
  width: 17px;
  height: 17px;
  color: var(--ui-ink-dim, #6b7280);
}
.tpg-glyph svg {
  width: 17px;
  height: 17px;
}
/* 摘要超长省略（参考图是 truncate） */
.tpg-text {
  min-width: 0;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpg-arrow {
  display: inline-flex;
  flex: none;
  width: 14px;
  height: 14px;
  color: var(--ui-ink-mute, #8c95a3);
  transition: transform 0.15s ease-out;
}
.tpg-arrow svg {
  width: 14px;
  height: 14px;
}
.tpg-trigger[data-state='open'] .tpg-arrow {
  transform: rotate(180deg);
}
@media (prefers-reduced-motion: reduce) {
  .tpg-trigger,
  .tpg-arrow {
    transition: none !important;
  }
}
</style>

<style>
/*
 * 内联下拉的触发器：撑满**外层那一格**。
 *
 * 关键区别（用户 2026-11-09 两次截图的差别就在这）：
 * 外层 `.tpg-inline` 是 `width: max-content` + 下限 80 + 上限 100%，
 * 所以「格子有多宽」已经由内容和上下限定死了；触发器只是把那一格填满。
 * `width: auto` 反而会让它比格子窄 7px（内容宽 73，格子被 min-width 撑到 80），
 * 看起来按钮比格子小一圈。
 *
 * 必须写在**全局**样式里：Trigger 是调用方通过 slot 传进来的（ToolParamField → Select），
 * 它的 DOM 不带本组件的 scoped 属性，`:deep()` 也命中不了。
 */
.tpg-inline [data-slot='select-trigger'] {
  width: 100%;
}
/*
 * 长名字走省略号，不要硬切（实测超长值：内容 474px、显示区 184px，
 * 默认的 text-overflow 是 clip，最后一句话被拦腰截断，看不出还有下文）。
 *
 * 选择器放在触发器内部的 SelectValue 上；已用 min-width: 0 让它能收缩
 * —— flex 子项默认 min-width: auto，不给 0 的话它会坚持跟内容一样宽、压根不省略。
 */
.tpg-inline [data-slot='select-trigger'] [data-slot='select-value'] {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 浮层内容（经 Teleport 到 body，必须用全局样式）。
   浮层本身交给 shadcn PopoverContent（圆角/阴影/动画/点外关闭都是它的），
   这里只覆盖参数面板自己的宽度与内边距：宽 288（参考稿 w-72）、内边距 16（p-4）。 */
/*
 * 宽度随内容自适应（用户口径 2026-11-03：「宽度没有自适应」）。
 *
 * 从前写死 288px：6 档比例按 5 列排成两行，第二行剩一格、右侧留一大片空白。
 * 现在宽度交给内容决定，再用上下限兜住极端情况：
 * - `min-width` 保住「比例 6 列」放得下（6 × 50 格 + 5 × 8 间距 + 32 内边距 ≈ 372）；
 * - `max-width` 不超过视口可用宽度，窄屏也不会被顶出屏幕。
 */
.tpg-popover {
  /* 纵向 flex：面板封顶后让内容区（.tpg-menu）自己滚 */
  display: flex;
  flex-direction: column;
  /* 宽度随内容（比例 6 列），但不能超过视口可用宽度，否则右侧会被裁掉 */
  width: max-content;
  /* 最小 340（用户 2026-11-08：下拉最小宽度统一 340） */
  min-width: 340px;
  max-width: min(420px, calc(100vw - 32px));
  /*
   * 高度上限 + 内部滚动（用户 2026-11-08 截图）：比例 14 格 + 分辨率 + 数量
   * 会让面板长到 600px+，既没滚动也超出弹窗。这里封顶后由 .tpg-menu 自己滚。
   */
  max-height: min(420px, 60vh);
  /*
   * 内边距分两层：外层只留滚动条通道 + 左侧让位，视觉留白都在内容层（见 .tpg-menu）。
   *
   * 右侧 4：滚动条通道（用户 2026-11-08：滚动条要贴右边缘，不能飘在内容里）。
   * 左侧 12 而不是 16：ScrollArea 的 viewport 是 `overflow: hidden`，按边框盒裁剪，
   * 而 shadcn 的聚焦环是向外扩 3px 的 box-shadow —— 输入框紧贴左边缘时，
   * 左边那圈环会被裁成一条竖线（用户 2026-11-09 截图，12 倍放大确认）。
   *
   * 为什么不直接 `overflow-x: visible`：CSS 规定一轴 visible、另一轴不是时，
   * visible 会被当成 auto。纵向必须能滚，横向就永远是 hidden。
   * 也不给输入框加 margin / padding：那会让它比同列标题更窄，看着变形。
   *
   * 所以把这 4px 从外层挪到内容层：12 + 4 = 16，内容位置与总宽都不变，
   * 变的只是裁剪边界向右让出 4px，正好容纳聚焦环（3px + 1px 余量）。
   */
  padding: 16px 4px 16px 12px;
  gap: 12px;
  border-radius: var(--plume-radius, 16px);
  background: var(--ui-overlay-solid, #fff);
  overflow: hidden;
}
/* ScrollArea 本体：撑满面板可用高度，滚动条贴到最右 */
.tpg-scroll {
  flex: 1 1 auto;
  min-height: 0;
}
/*
 * 高度上限必须写在**视口**上（ScrollArea 真正滚动的是 viewport）。
 *
 * 只给面板 max-height 时，viewport 是 size-full（height:100%），
 * 父级高度又由内容决定 —— 实测 viewport 撑到 443，被面板 420 裁掉，反而不出滚动条。
 * 这里直接给 viewport 上限，内容超出即滚。
 */
.tpg-scroll [data-slot='scroll-area-viewport'] {
  max-height: calc(min(420px, 60vh) - 32px);
}
/*
 * 内层内容补回视觉留白：外层右 4 是滚动条通道、左 12 是给聚焦环的让位，
 * 内容再补左 4 / 右 12，四周合计仍是 16px。
 *
 * 注意不能写「viewport 的直接子级」选择器：reka 会在视口里再包一层 div，
 * 那条规则永远不命中（实测内层一直是 0 padding，内容贴着滚动条）。
 * 直接给 .tpg-menu 自己加内边距才生效。
 */
.tpg-scroll .tpg-menu {
  box-sizing: border-box;
  /* 宽度跟随滚动视口（不按内容撑），padding 才能真的把内容从滚动条上推开 */
  width: 100%;
  max-width: 100%;
  padding-left: 4px;
  padding-right: 12px;
  padding-bottom: 4px;
}
/* 参数面板里的滑块走**黑白**（用户口径 2026-10-12：这里不用主题色，与右键菜单同口径）：
   填充与圆球改用主按钮那档深墨，白底黑轨一眼能看出进度，不再是一条青色的条。 */
.tpg-menu-body {
  --ps-accent: var(--ui-primary-bg, #1f2937);
  --ps-accent-hover: var(--ui-primary-bg-hover, #111827);
}
.tpg-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 260px;
  /* 滚动交给外层 ScrollArea（用户 2026-11-08：统一用 shadcn 滚动） */
  min-height: 0;
}
/* 块间 gap 12 + 块间分割线（参考稿在「比例网格」与「滑块」之间就是一条 border-t） */
.tpg-menu--blocks {
  gap: 12px;
  min-width: 0;
}
.tpg-menu--blocks .tpg-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 预设块之间一条分割线（参考稿在「比例网格」与「参数滑块」之间就是一条 border-t） */
.tpg-menu--blocks .tpg-block + .tpg-block {
  padding-top: 12px;
  border-top: 1px solid var(--ui-line, #e2e5ea);
}
/* 非预设件（普通下拉 / 开关 / 输入）的标题：与各预设件自己的 h4 逐条对齐
   （12px / 700 / 深墨 / 20 行高），这样两类块并排时标题看起来是同一档。 */
.tpg-menu--blocks .tpg-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tpg-menu--blocks .tpg-title {
  margin: 0;
  height: 20px;
  display: flex;
  align-items: center;
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  font-weight: 700;
  line-height: 20px;
}
.tpg-menu .tpg-empty {
  padding: 6px 4px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
}
</style>
