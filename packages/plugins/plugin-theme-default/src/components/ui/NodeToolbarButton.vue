<script setup lang="ts">
/**
 * NodeToolbarButton —— 节点上/下插槽里用的**通用按钮**（图标 / 图标+文字 / 纯文字）。
 *
 * 为什么有这个组件（用户要求："你这里可以实现一个通用的按钮什么的"）：
 * 插件往节点插槽里放按钮时，此前各自抄了一份 32×32 / 圆角 8 / 灰底 / hover 加深 /
 * focus 青环 的样式（图片顶部条 .it-btn、图片生成栏 .ig-icon-btn、文本生成栏 .tg-icon-btn），
 * 三份数值已经开始漂移。这里按 docs/design/ui-style-guide.md §3.3 收成一份，
 * 插件只给"图标 + 文案 + 点了我干什么"。
 *
 * 用法（插件里）：
 *   <NodeToolbarButton title="上传图片" :icon="UPLOAD_SVG" @click="openPicker" />
 *   <NodeToolbarButton variant="primary" icon="…" @click="send">发送</NodeToolbarButton>
 *
 * 无障碍按规范硬性要求做全：纯图标按钮**同时**给 title 与 aria-label（默认共用 title 文案，
 * 想分开写就传 aria-label）；只有真的给了 active（开关类按钮）才报 aria-pressed ——
 * 普通按钮报它会被读屏当成开关，反而误导。禁用是真的加 disabled。
 *
 * 数值一律照 ui-style-guide §3.3：图标按钮 32×32/圆角 8/灰底；带文案时是"文本按钮"
 * （透明底、padding 6px 10px、圆角 6，hover 才出 --fill-hover）；primary 是主按钮
 * （青底白字、padding 6px 14px、圆角 8）。**不提供 size 参数**：§5 第 4 条要求交互目标
 * ≥32px，给个 size 等于给一条违规的捷径（此前各面板的 28px 就是这么来的）。
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import { iconRenderMode } from '@mini-canvas/kernel'

const props = withDefaults(
  defineProps<{
    /** 按钮文案；纯图标按钮时它就是无障碍名称 */
    title: string
    /** 悬停说明与无障碍名称；缺省 = title（想给更细的读屏文案时单独传） */
    ariaLabel?: string
    /** 图标句柄（opaque：SVG 字符串或 Vue 组件，与节点类型 icon 同源）；不传则只渲染文案 */
    icon?: unknown
    /** 视觉语义：ghost（默认，图标=灰底/带文案=文本按钮）/ primary 主按钮 / danger 悬停转红 */
    variant?: 'ghost' | 'primary' | 'danger'
    disabled?: boolean
    /** 开关类按钮的当前状态；**不传**就不当开关（不报 aria-pressed） */
    active?: boolean
  }>(),
  {
    ariaLabel: undefined,
    icon: undefined,
    variant: 'ghost',
    disabled: false,
    active: undefined,
  },
)

const emit = defineEmits<{ (e: 'click', ev: MouseEvent): void }>()

/** 无障碍名称：没单独给就用 title（纯图标按钮必须两者都有） */
const label = computed(() => props.ariaLabel || props.title)

/** 图标形态：'html' 走 v-html、'component' 走 <component :is>、'none' 不渲染图标位 */
const iconMode = computed(() => iconRenderMode(props.icon))
const htmlIcon = computed(() => (iconMode.value === 'html' ? String(props.icon) : ''))
const componentIcon = computed<Component | null>(() =>
  iconMode.value === 'component' ? (props.icon as Component) : null,
)

</script>

<template>
  <button
    class="ntb-btn"
    :class="['ntb-btn--' + variant, { 'is-active': active === true, 'is-icon-only': !$slots.default }]"
    type="button"
    :title="title"
    :aria-label="label"
    :aria-pressed="active === undefined ? undefined : active ? 'true' : 'false'"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <span v-if="iconMode !== 'none'" class="ntb-icon" aria-hidden="true">
      <span v-if="iconMode === 'html'" v-html="htmlIcon" />
      <component v-else :is="componentIcon" />
    </span>
    <span v-if="$slots.default" class="ntb-label"><slot /></span>
  </button>
</template>

<style scoped>
/* 尺寸/圆角/色值全部来自 ui-style-guide §2.1 灰阶与 §3.3 按钮规范。 */
.ntb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: none;
  box-sizing: border-box;
  /* 图标按钮档：32×32 / 圆角 8（§3.3），同时满足 §5 第 4 条"交互目标 ≥32px" */
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-muted, #6b7280);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition:
    background-color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1),
    color 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}

/* 带文案 → 走规范里的"文本按钮"：透明底 + 圆角 6 + padding 6px 10px，hover 才出 --fill-hover */
.ntb-btn:not(.is-icon-only) {
  width: auto;
  padding: 0 12px;
  border-radius: 6px;
  background: transparent;
}
.ntb-btn:not(.is-icon-only) .ntb-icon :deep(svg),
.ntb-btn:not(.is-icon-only) .ntb-icon > svg {
  /* 文本按钮内的图标按规范用 12px 档 */
  width: 12px;
  height: 12px;
}

.ntb-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
/* 图标尺寸按规范只允许 12 / 14 / 16：32 档用 16、更小的档位回落到 14（微元件） */
.ntb-icon :deep(svg),
.ntb-icon > svg {
  width: 16px;
  height: 16px;
  display: block;
}

.ntb-btn:hover:not(:disabled) {
  background: var(--fill-active, rgba(0, 0, 0, 0.06));
  color: var(--text-strong, #111827);
}
/* 文本按钮的 hover 是更浅的一档（规范 §3.3） */
.ntb-btn:not(.is-icon-only):hover:not(:disabled) {
  background: var(--fill-hover, rgba(0, 0, 0, 0.05));
}

.ntb-btn:active:not(:disabled) {
  transform: scale(0.97);
}

/* 焦点环：去掉默认 outline 就必须补上（规范 §5 第 1 条） */
.ntb-btn:focus-visible {
  outline: 2px solid rgba(8, 145, 178, 0.6);
  outline-offset: 1px;
}

.ntb-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* —— 主按钮档：同一时刻全界面只允许一个实心主按钮（§2.1），primary 要谨慎使用 ——
   选择器写成 .ntb-btn.ntb-btn--primary（而不是单个 .ntb-btn--primary）是有原因的（实测缺陷）：
   带文案的按钮会命中上面的 `.ntb-btn:not(.is-icon-only)`（特异度 0,2,0）把它设成透明底，
   而单类选择器 `.ntb-btn--primary`（0,1,0）特异度更低 —— 于是"确认"变成白字透明底，
   放在白色工具栏上完全看不见。抬到同等特异度、且排在后面，才能稳定压住那条通用规则。 */
  .ntb-btn.ntb-btn--primary {
    width: auto;
    padding: 0 14px;
    border-radius: 8px;
    background: #0891b2;
    color: #fff;
  }
  .ntb-btn.ntb-btn--primary:hover:not(:disabled) {
    background: #0e7490;
    color: #fff;
  }

  /* 危险档：平时与 ghost 同，悬停才转红。同上抬特异度，保证带文案时也能压住通用规则。 */
  .ntb-btn.ntb-btn--danger:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

/* 激活（开关打开）：浅青底 + 青字，表示"当前生效" */
.ntb-btn.is-active {
  background: rgba(8, 145, 178, 0.12);
  color: #0e7490;
}
.ntb-btn.is-active:hover:not(:disabled) {
  background: rgba(8, 145, 178, 0.2);
  color: #0e7490;
}

@media (prefers-reduced-motion: reduce) {
  .ntb-btn {
    transition: none !important;
  }
  .ntb-btn:active:not(:disabled) {
    transform: none;
  }
}
</style>
