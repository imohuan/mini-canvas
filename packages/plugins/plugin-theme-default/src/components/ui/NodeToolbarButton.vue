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
import { Button } from '@mini-canvas/ui-kit'
import { useIconHandle } from './useIconHandle'
import './node-toolbar-button.css'

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
const iconParts = useIconHandle(() => props.icon)

</script>

<template>
  <Button
    class="ntb-btn"
    :class="[
      'ntb-btn--' + variant,
      {
        'is-active': active === true,
        'is-icon-only': !$slots.default,
      },
    ]"
    :variant="variant === 'ghost' ? 'ghost' : variant"
    :icon-only="!$slots.default"
    size="sm"
    type="button"
    :title="title"
    :aria-label="label"
    :aria-pressed="active === undefined ? undefined : active ? 'true' : 'false'"
    :disabled="disabled"
    @click="emit('click', $event)"
  >
    <template v-if="iconParts.mode !== 'none'" #icon>
      <span class="ntb-icon">
        <span v-if="iconParts.mode === 'html'" class="ntb-icon-raw" v-html="iconParts.html" />
        <component v-else :is="iconParts.component" class="ntb-icon-raw" />
      </span>
    </template>
    <template v-if="$slots.default" #default><span class="ntb-label"><slot /></span></template>
  </Button>
</template>
