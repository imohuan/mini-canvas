<script setup lang="ts">
// CanvasShell —— 画布应用基础布局壳。
//
// 只负责「谁在哪一层、哪一块留多大」，不含任何业务：
//   左上角 / 右上角 / 底部居中 / 左下角状态条 / 中间画布 / 左抽屉 / 右抽屉 / 各种浮层
// 每一块都是一个具名插槽，业务方往里塞 UI 即可。
//
// 左抽屉打开时会把左上角、左下角、底部居中一起右推（照 LibTV 实测：像抽屉挤出来，不是盖住）。
//
// 还有一件职责：把这里几块界面条的真实高度/宽度上报给取景服务（view.setChromeBars）。
// 取景要「避开顶部菜单、避开底部状态栏」必须有这些数字，而它们只在外壳这一层量得到
// （画布 DOM 是外壳的子节点，渲染层顺着自己的 root 找不到它们）。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AppShell } from '../app-shell'
import { APP_SHELL_KEY } from '../app-shell'

const props = withDefaults(
  defineProps<{
    /** 左抽屉宽度（0 = 关闭） */
    leftWidth?: number
    /** 右抽屉宽度（0 = 关闭） */
    rightWidth?: number
    /** 左下状态条是否跟着左抽屉右移 */
    pushStatus?: boolean
    /** 底部居中 dock 是否跟着左抽屉右移 */
    pushDock?: boolean
    theme?: 'dark' | 'light'
  }>(),
  { leftWidth: 0, rightWidth: 0, pushStatus: true, pushDock: true, theme: 'dark' },
)

const leftOpen = computed(() => props.leftWidth > 0)
const rightOpen = computed(() => props.rightWidth > 0)
/** 左抽屉打开时，左上角 / 左下角 / 底部 dock 一起向右「挤」出抽屉的宽度 */
const pushStyle = computed(() => (leftOpen.value ? { transform: `translateX(${props.leftWidth}px)` } : {}))
/** 右抽屉打开时，右上角按钮组 / 底部 dock 一起向左「挤」（它们贴着画布右缘，不被盖住） */
const pullStyle = computed(() => (rightOpen.value ? { transform: `translateX(-${props.rightWidth}px)` } : {}))
/** 状态条只跟左抽屉；右抽屉不影响左下角（它在最左边） */
const statusStyle = computed(() => (props.pushStatus && leftOpen.value ? pushStyle.value : {}))
const dockStyle = computed(() => {
  const shift = (props.leftWidth - props.rightWidth) / 2
  return shift !== 0 ? { transform: `translateX(calc(-50% + ${shift}px))` } : {}
})

// ==================== 界面条尺寸上报（取景用） ====================
const shell = inject<AppShell | undefined>(APP_SHELL_KEY, undefined)
const topbarEl = ref<HTMLElement | null>(null)
const statusEl = ref<HTMLElement | null>(null)
const dockEl = ref<HTMLElement | null>(null)

/** 目前会话里的取景服务（外壳不直接依赖 canvas-render 的类，只按方法名取） */
function viewService(): { setChromeBars?(bars: Record<string, number>): void } | undefined {
  return shell?.sessionHost.value?.ctx.tryGet('view') as
    | { setChromeBars?(bars: Record<string, number>): void }
    | undefined
}

/**
 * 量一遍并上报。
 *
 * 口径：
 * - 顶：顶栏占用的高度 = 它到画布顶边的距离（含定位留白），不是内容自身高度；
 * - 底：状态条与底栏取更高的那个 —— 两者并排挂在底部，取高者才不会压住靠上那一条；
 * - 左右：直接用外壳已知的抽屉宽度（它们就是这个布局的输入）。
 */
function reportChromeBars(): void {
  const svc = viewService()
  if (!svc?.setChromeBars) return
  const top = topbarEl.value
  const status = statusEl.value
  const dock = dockEl.value
  let topPx = 0
  if (top) {
    const r = top.getBoundingClientRect()
    topPx = Math.max(0, Math.round(r.bottom))
  }
  let bottomPx = 0
  for (const el of [status, dock]) {
    if (!el) continue
    const r = el.getBoundingClientRect()
    if (r.height <= 0) continue
    bottomPx = Math.max(bottomPx, Math.round(window.innerHeight - r.top))
  }
  svc.setChromeBars({
    top: topPx,
    bottom: bottomPx,
    left: Math.max(0, Math.round(props.leftWidth)),
    right: Math.max(0, Math.round(props.rightWidth)),
  })
}

let resizeObserver: ResizeObserver | null = null
let observerHooked = false

/** 元素尺寸变化就重量（顶栏/底栏高度会随内容与主题变） */
function syncObservedElements(): void {
  if (typeof ResizeObserver === 'undefined') return
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(() => reportChromeBars())
  }
  resizeObserver.disconnect()
  for (const el of [topbarEl.value, statusEl.value, dockEl.value]) {
    if (el) resizeObserver.observe(el)
  }
}

function hook(): void {
  if (observerHooked) return
  observerHooked = true
  syncObservedElements()
  reportChromeBars()
  window.addEventListener('resize', reportChromeBars)
}

function unhook(): void {
  if (!observerHooked) return
  observerHooked = false
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', reportChromeBars)
}

onMounted(() => {
  hook()
  // 会话可能比外壳晚就绪：到那时再补报一次（否则第一次取景拿到的还是 0）
  if (shell) {
    watch(
      () => shell.sessionHost.value,
      () => {
        syncObservedElements()
        reportChromeBars()
        requestAnimationFrame(reportChromeBars)
      },
      { immediate: true },
    )
  }
})
// 抽屉宽度变化会改布局，跟着重量一次
watch(
  () => [props.leftWidth, props.rightWidth],
  () => {
    reportChromeBars()
    requestAnimationFrame(reportChromeBars)
  },
)
onBeforeUnmount(unhook)

/** 供外部（如调试/测试）主动触发一次上报 */
defineExpose({ reportChromeBars })
</script>

<template>
  <div class="shell" :data-theme="theme" :style="{ '--shell-push': leftWidth + 'px' }">
    <!-- 中间：真实画布（放最底层，其它都是浮层） -->
    <div class="shell-canvas">
      <slot name="canvas" />
    </div>

    <!-- 左上角 -->
    <!-- 顶栏：左组随左抽屉右移；右组随右抽屉左移（flex 三区域共用屏幕，谁也不盖谁） -->
    <header ref="topbarEl" class="shell-topbar">
      <div class="shell-top-left" :class="{ pulled: leftOpen }">
        <slot name="top-left" />
      </div>
      <div class="shell-top-right" :class="{ pulled: rightOpen }" :style="pullStyle">
        <slot name="top-right" />
      </div>
    </header>

    <!-- 左下角状态条：随左抽屉右移 / 随右抽屉左移（画布区变窄，它贴着画布左缘） -->
    <div ref="statusEl" class="shell-status" :style="statusStyle">
      <slot name="status" />
    </div>

    <!-- 底部居中工具条（居中在画布区） -->
    <div ref="dockEl" class="shell-dock" :style="pushDock ? dockStyle : {}">
      <slot name="dock" />
      <slot name="dock-append" />
    </div>

    <!-- 左右抽屉（抽屉本身由插槽渲染，外壳只提供推挤量） -->
    <slot name="left-drawer" />
    <slot name="right-drawer" />

    <!-- 浮层（弹窗 / 菜单 / toast） -->
    <slot name="overlays" />

    <!-- 其它任意内容（抽屉 / 对话面板 / toast…） -->
    <slot />
  </div>
</template>

<style scoped>
/* 外壳底/字走主题 token：亮暗由 <html class="dark"> 切换，不再靠 data-theme 手写两套值 */
/* 字体：跟随主题插件「外观 → 正文字体」；没选时回落到原来的系统栈 */
.shell { position: relative; height: 100vh; overflow: hidden; background: var(--ui-canvas-bg, #141414); color: var(--ui-ink, #f7f7f7); font-family: var(--mct-font-body, system-ui, 'Microsoft YaHei', sans-serif); }
.shell[data-theme='light'] { background: var(--ui-canvas-bg, #f5f6f8); color: var(--ui-ink, #18202b); }
.shell-canvas { position: absolute; inset: 0; }
.shell-topbar { position: absolute; inset: 8px 8px auto; z-index: var(--layer-app-chrome, 700); display: flex; align-items: center; justify-content: space-between; height: 32px; pointer-events: none; }
/* 块 A（项目胶囊）与块 B（视图切换）之间的间隔：照目标实测 8px */
.shell-top-left { display: flex; align-items: center; gap: 8px; pointer-events: auto; transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
.shell-top-left.pulled { transform: translateX(var(--shell-push, 320px)); }
.shell-top-right { display: flex; align-items: center; pointer-events: auto; }
.shell-top-right { gap: 8px; }
.shell-top-right.pulled { transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
/* 外壳只负责「定位」：视觉（背景/边框/圆角）由插槽内容自己带，避免两层重复。 */
.shell-status { position: fixed; left: 8px; bottom: 12px; z-index: var(--layer-app-chrome, 700); display: flex; align-items: flex-end; transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
.shell-dock { position: fixed; left: 50%; bottom: 12px; z-index: var(--layer-app-chrome, 700); display: flex; align-items: center; transform: translateX(-50%); transition: transform .25s cubic-bezier(.4, 0, .2, 1); }
</style>
