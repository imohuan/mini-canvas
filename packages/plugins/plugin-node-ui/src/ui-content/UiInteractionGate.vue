<script setup lang="ts">
import { useUiComponent } from '@plume-canvas/canvas-render'

defineEmits<{
  enter: []
  debug: []
}>()

const Button = useUiComponent('Button')
</script>

<template>
  <!--
    交互遮罩：平时盖在 iframe 上，把鼠标事件让回画布。
    双击摘掉它，里面的界面才开始吃点击；失去聚焦时自动盖回来。

    ⚠️ **不要**给这一层加 nodrag / nopan —— 那两个类的意思正好是"这一层不参与拖拽/平移"，
    而遮罩盖满整张卡，等于把整个节点的拖拽彻底禁掉（2026-10-12 用户实测「依然无法拖拽」的根因）。
    它必须是**普通的一层**：pointerdown 落上去后正常冒泡，VueFlow 才知道用户要拖这个节点。
  -->
  <div
    class="ui-gate"
    title="双击进入交互（点击界面里的按钮等）"
    @dblclick.stop="$emit('enter')"
  >
    <span class="ui-gate-badge">双击交互</span>
    <!--
      调试入口：把这份界面复制进一个**普通窗口**（同源），
      于是 DevTools 能点进去、能读变量、能打断点。

      ⚠️ 它**不碰**画布上那个沙箱 iframe —— 沙箱边界原样不动
      原样不动。副本点坏了大不了重开，节点上那份不受影响。
      2026-10-15 用户报「无法操作、无法调试」，根因就是沙箱本身（见 uiDebug.ts 文件头）。
    -->
    <Button
      type="button"
      class="ui-gate-debug"
      variant="ghost"
      size="sm"
      title="在新窗口里调试这份界面（可读变量 / 打断点）"
      @mousedown.stop
      @dblclick.stop
      @click.stop="$emit('debug')"
    >
      调试
    </Button>
  </div>
</template>

<style scoped>
/* 交互遮罩：透明、盖满，负责"把事件让回画布" */
.ui-gate {
  position: absolute;
  inset: 0;
  z-index: 2;
  /* 透明但要"摸得到"：pointer-events 必须是 auto，否则事件又落回 iframe 了 */
  background: transparent;
  cursor: default;
}
/* 提示角标：只在鼠标停到节点上时淡淡地露一下，不打扰看内容 */
.ui-gate-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-faint, #9ca3af);
  font-size: 11px;
  line-height: 18px;
  opacity: 0;
  transition: opacity 160ms ease;
  pointer-events: none;
}
.ui-gate:hover .ui-gate-badge {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  .ui-gate-badge {
    transition: none;
  }
}

/*
 * 调试按钮：开一份同源副本，让这份界面能被 DevTools 调试。
 *
 * 为什么放在遮罩层上、且只 hover 才露出来：遮罩平时是透明的（要把事件让回画布），
 * 常驻一个按钮会挡视线；而「调试」是个低频动作，藏起来不影响日常使用。
 *
 * 为什么用按钮而不是 <span>：键盘要能 Tab 到它、回车要能触发
 * （a11y 硬性规则，见 docs/design/ui-style-guide.md）。
 */
.ui-gate-debug {
  position: absolute;
  left: 8px;
  bottom: 8px;
  height: auto;
  padding: 2px 10px;
  border-radius: 999px;
  background: var(--fill-subtle, rgba(0, 0, 0, 0.04));
  color: var(--text-faint, #9ca3af);
  font-size: 11px;
  line-height: 18px;
  opacity: 0;
  transition: opacity 160ms ease;
}
.ui-gate:hover .ui-gate-debug,
.ui-gate-debug:focus-visible {
  opacity: 1;
}
.ui-gate-debug:hover {
  color: var(--text-muted, #6b7280);
}
@media (prefers-reduced-motion: reduce) {
  .ui-gate-debug {
    transition: none;
  }
}
</style>
