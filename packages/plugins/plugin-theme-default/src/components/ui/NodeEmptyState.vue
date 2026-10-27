<script setup lang="ts">
/**
 * NodeEmptyState —— 节点内容区的**统一空状态**（默认主题提供，节点插件按名取用）。
 *
 * 为什么要有它：图片 / 视频 / 音频 / 3D 预览这些节点，没素材时各自手写一套
 * 「图标 + 一行灰字」（有的有图标、有的没有，字号与间距也各不相同）。用户要的是
 * 一个共用件：换文案、换说明、换图标、加一个可选动作就够了，不必每加一种节点
 * 再抄一份空态。
 *
 * 用法（插件不要直接 import 本文件，按设计系统目录取，换主题时一起换；
 * 登记处：`D:\Code\Git\mini-canvas\packages\plugins\plugin-theme-default\src\index.ts`）：
 *   const Empty = useUiComponent('nodeEmptyState')
 *   <Empty text="（无图片）" description="上传一张图片，或把图片节点连进来" />
 *
 * 分工：
 * - 本组件只画「卡片里面」的空态；端口 / 标题 / 上传入口仍归节点壳与上控制栏；
 * - 根层 pointer-events:none —— 按住空态区域照样能拖节点；只有真正的动作按钮可点，
 *   并带 nodrag/nopan/nowheel，避免点按钮时把画布拖走 / 缩放画布；
 * - 颜色与字号全走主题 token，不引入新的灰阶（配色卫生测试会拦裸色值）。
 */
withDefaults(
  defineProps<{
    /** 主文案（一句话说清「这里还缺什么」） */
    text: string
    /** 可选说明：更次要的一行（怎么补上、连什么进来） */
    description?: string
    /** 可选动作文案；给了才渲染按钮（例如「上传」「打开」） */
    actionText?: string
    /** 动作按钮是否禁用（例如正在上传） */
    actionDisabled?: boolean
    /** 语义色：danger=失效、warning=需要注意；缺省是普通空态 */
    tone?: 'muted' | 'warning' | 'danger'
  }>(),
  { description: '', actionText: '', actionDisabled: false, tone: 'muted' },
)

const emit = defineEmits<{
  /** 点了动作按钮（只在给了 actionText 时可能触发） */
  (e: 'action'): void
}>()
</script>

<template>
  <div class="nes-root" :class="`is-${tone}`" role="status">
    <div class="nes-icon" aria-hidden="true">
      <!-- 节点可以换自己的图标；没给就用默认的「素材占位」图形 -->
      <slot name="icon">
        <svg class="nes-icon-default" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="M4 17l5-5 4 4 2-2 5 5" />
        </svg>
      </slot>
    </div>
    <div class="nes-text">{{ text }}</div>
    <div v-if="description" class="nes-description">{{ description }}</div>
    <button
      v-if="actionText"
      class="nes-action nodrag nopan nowheel"
      type="button"
      :disabled="actionDisabled"
      @click.stop="emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>

<style scoped>
.nes-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  text-align: center;
  /* 空态本身不吃手势：按住空白处仍然拖节点（只有下面的 action 按钮例外） */
  pointer-events: none;
  color: var(--canvas-node-text-muted, #9ca3af);
}

.nes-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--canvas-node-border-hover, #d1d5db);
}

.nes-icon-default {
  width: 100%;
  height: 100%;
}

.nes-text {
  /* 中文正文最低 12px（UI 规范） */
  font-size: 12px;
  line-height: 1.5;
}

.nes-description {
  max-width: 260px;
  color: var(--canvas-node-text-faint, var(--canvas-node-text-muted, #9ca3af));
  font-size: 12px;
  line-height: 1.5;
}

.nes-action {
  margin-top: 2px;
  padding: 5px 12px;
  border: 0;
  border-radius: 8px;
  background: var(--ui-accent-soft, rgba(8, 145, 178, 0.12));
  color: var(--ui-accent-hover, #0e7490);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  /* 按钮可点：把根层放行的手势事件收回来 */
  pointer-events: auto;
  transition: background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.nes-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ui-accent, #0891b2) 20%, transparent);
}

.nes-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nes-action:focus-visible {
  outline: 2px solid var(--ntb-accent-ring, rgb(8 145 178 / 0.6));
  outline-offset: 1px;
}

/* 语义色只换「图 + 主文案」，说明保持次要灰，避免整块变红 */
.nes-root.is-warning .nes-icon,
.nes-root.is-warning .nes-text {
  color: var(--ui-warn, #b45309);
}

.nes-root.is-danger .nes-icon,
.nes-root.is-danger .nes-text {
  color: var(--ui-danger, #ef4444);
}

@media (prefers-reduced-motion: reduce) {
  .nes-action {
    transition: none;
  }
}
</style>
