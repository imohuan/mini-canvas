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
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import { useCatalogDropdown } from './useCatalogDropdown'
import ToolParamField from './ToolParamField.vue'
import { resolvePresetKind, resolveInlineSoleSelect } from './paramKind'

/** 下拉容器：优先用注册场登记的那一份（成品应用顶替了就用它），取不到回落本包自带 */
const Dropdown = useCatalogDropdown()

const props = withDefaults(
  defineProps<{
    params?: ToolParamDef[]
    values?: Record<string, unknown>
    disabled?: boolean
    /** 参数都没值时的占位文案 */
    placeholder?: string
    /** id 前缀（同一面板多份时保证 label/for 唯一） */
    idPrefix?: string
  }>(),
  { params: () => [], values: () => ({}), disabled: false, placeholder: '默认参数', idPrefix: 'tpg' },
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
const isPreset = (p: ToolParamDef): boolean => resolvePresetKind(p) !== undefined
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
const inlineParam = computed(() => resolveInlineSoleSelect(props.params ?? []))

/** 每项当前值的显示文案（有 options 就用 option 的 label，否则原样字符串化） */
function labelOf(p: ToolParamDef): string {
  const v = props.values?.[p.key]
  if (v === undefined || v === null || v === '') return ''
  const opt = p.options?.find((o) => o.value === v)
  return opt ? opt.label : String(v)
}

/** 摘要：把有值的参数用 · 连起来（比例 · 标准画质 · 2K · 1张） */
const summary = computed(() => {
  const parts = (props.params ?? []).map((p) => labelOf(p)).filter((s) => s !== '')
  return parts.join(' · ')
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

  <Dropdown
    v-else
    :offset="4"
    body-class="tpg-menu-body tpg-menu-body--blocks"
    menu-width="288px"
    class="tpg-root"
  >
    <template #trigger="{ open }">
      <button
        type="button"
        class="tpg-trigger"
        :class="{ 'is-open': open }"
        :disabled="disabled"
        :aria-expanded="open"
        aria-haspopup="dialog"
        :title="summary || placeholder"
      >
        <span class="tpg-glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="6" width="18" height="12" rx="2" />
          </svg>
        </span>
        <span class="tpg-text">{{ summary || placeholder }}</span>
        <span class="tpg-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </span>
      </button>
    </template>

    <div class="tpg-menu tpg-menu--blocks">
      <!--
        统一版式：一个参数 = 一整块（第一行标题、第二行控件），按声明顺序排。
        预设件（比例网格 / 按钮网格 / 滑块）自己就画标题，所以这里只在**非预设件**
        前面补一行标题 —— 从前非预设件走横排「标签 + 控件」，与预设件的竖排块两种观感并存，
        用户要求统一成竖排这一种。
      -->
      <div v-for="p in blocks" :key="p.key" class="tpg-block">
        <h4 v-if="!isPreset(p)" class="tpg-title">{{ p.label || p.key }}</h4>
        <ToolParamField
          :param="p"
          :model-value="(values?.[p.key] as string | number | boolean) ?? ''"
          :disabled="disabled"
          :id-prefix="idPrefix + '-b'"
          @update:model-value="(v: string | number | boolean) => emit('change', p.key, v)"
        />
      </div>
      <div v-if="blocks.length === 0" class="tpg-empty">该动作没有额外参数</div>
    </div>
  </Dropdown>
</template>

<style scoped>
/*
 * 形态 2（铺到外面）的根：与宿主那一格等宽，内部就是一个普通下拉。
 * `display: block` + `width: 100%`：底栏给它多宽就多宽（与左边模型下拉对齐）。
 */
.tpg-inline {
  display: block;
  width: 100%;
  min-width: 0;
}
.tpg-root {
  display: inline-flex;
  /* 填满宿主给的宽度（用户实测反馈：不填满时触发器按内容收缩，参数下拉只有 ~100px，
     看着又挤又短，和左边的模型下拉不成对）。宿主那边给多宽就多宽。 */
  width: 100%;
  min-width: 0;
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
.tpg-trigger.is-open {
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
.tpg-trigger.is-open .tpg-arrow {
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
/* 浮层内容（经 Teleport 到 body，必须用全局样式）。
   圆角/底色通过 --dd-* 交给 Dropdown 的浮层规则消费（那边是 scoped、特异性更高，
   直接写属性盖不住），取值照右键菜单 .ctx-menu：16 圆角 + 不透明白底。 */
.tpg-menu-body {
  --dd-padding: 6px;
  --dd-radius: 16px;
  --dd-bg: var(--ui-overlay-solid, #fff);
}
/* 整块版式（有预设块时）：面板宽 288（参考稿 w-72）、内边距 16（p-4）、块间 gap 12（gap-3） */
.tpg-menu-body--blocks {
  --dd-padding: 16px;
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
