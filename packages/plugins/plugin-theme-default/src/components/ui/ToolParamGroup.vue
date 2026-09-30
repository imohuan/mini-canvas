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
 * 依赖方向：只 import 内核 ToolParamDef 类型 + 本包自家 UI 组件，不反向依赖节点插件。
 */
import { computed } from 'vue'
import type { ToolParamDef } from '@mini-canvas/kernel'
import Dropdown from './Dropdown.vue'
import ToolParamField from './ToolParamField.vue'
import { resolvePresetKind } from './paramKind'

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
 * 哪些参数走「预设件区块」版式（标题 + 按钮网格 / 滑块，一列竖排），
 * 哪些走旧的「标签 + 控件」一行版式。
 *
 * 为什么两种并存：参考站的面板是**整块竖排**的（画质/清晰度/比例…各占一块），
 * 那正是"按能力显隐"的观感 —— 该模型支持的块才有。但没声明 kind 的参数
 * （普通下拉/开关）在竖排里会很怪，所以它们仍走一行式。
 */
const isPreset = (p: ToolParamDef): boolean => resolvePresetKind(p) !== undefined
const presetParams = computed(() => (props.params ?? []).filter(isPreset))
const rowParams = computed(() => (props.params ?? []).filter((p) => !isPreset(p)))
/** 有预设块 → 面板按参考站的整块版式（宽 342 / padding 12 / 块间 gap 8） */
const blocksMode = computed(() => presetParams.value.length > 0)
const menuClass = computed(() => (blocksMode.value ? 'tpg-menu tpg-menu--blocks' : 'tpg-menu'))

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
  <Dropdown
    :offset="4"
    :body-class="blocksMode ? 'tpg-menu-body tpg-menu-body--blocks' : 'tpg-menu-body'"
    :menu-width="blocksMode ? '342px' : ''"
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

    <div :class="menuClass">
      <!-- 预设块（照参考站：整块竖排，每块自带标题 + 按钮网格 / 滑块） -->
      <div v-for="p in presetParams" :key="'b-' + p.key" class="tpg-block">
        <ToolParamField
          :param="p"
          :model-value="(values?.[p.key] as string | number | boolean) ?? ''"
          :disabled="disabled"
          :id-prefix="idPrefix + '-b'"
          @update:model-value="(v: string | number | boolean) => emit('change', p.key, v)"
        />
      </div>
      <div v-for="p in rowParams" :key="'r-' + p.key" class="tpg-row">
        <span class="tpg-label">{{ p.label || p.key }}</span>
        <ToolParamField
          :param="p"
          :model-value="(values?.[p.key] as string | number | boolean) ?? ''"
          :disabled="disabled"
          :id-prefix="idPrefix + '-g'"
          @update:model-value="(v: string | number | boolean) => emit('change', p.key, v)"
        />
      </div>
      <div v-if="(params ?? []).length === 0" class="tpg-empty">该动作没有额外参数</div>
    </div>
  </Dropdown>
</template>

<style scoped>
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
/* 浮层内容（经 Teleport 到 body，必须用全局样式） */
.tpg-menu-body {
  padding: 6px;
}
/* 整块版式（有预设块时）：照参考站实测 —— 面板宽 342、圆角 16、内边距 12 */
.tpg-menu-body--blocks {
  padding: 12px;
  border-radius: 16px;
}
.tpg-menu {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 260px;
}
/* 块间 gap 8（参考站实测）；块内间距由各预设件自己给 */
.tpg-menu--blocks {
  gap: 8px;
  min-width: 0;
}
.tpg-menu--blocks .tpg-block {
  display: block;
}
.tpg-menu .tpg-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tpg-menu .tpg-label {
  flex: none;
  width: 56px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
  font-weight: 600;
}
.tpg-menu .tpg-row > *:not(.tpg-label) {
  flex: 1;
  min-width: 0;
}
.tpg-menu .tpg-empty {
  padding: 6px 4px;
  color: var(--ui-ink-mute, #8c95a3);
  font-size: 12px;
}
</style>
