<script setup lang="ts">
/**
 * AgentPanel —— Agent 对话的**外壳**（归应用，不归插件）。
 *
 * 分工与设置面板完全一致：
 *   SettingsShell（外壳） + 插件里的设置内容（皮）
 *   AgentPanel  （外壳） + 插件里的 agent-conversation 内容
 *
 * 为什么外壳在应用层：停靠时要把**画布挤窄**，用的是 CanvasShell 的 right-width，
 * 那个绑定在 App.vue 里，插件拿不到。
 *
 * 内容经 <SlotHost slot="agent-conversation" /> 渲染 —— 本组件放在 App.vue 的 #ui 插槽里
 * （在 <CanvasHost> 渲染子树内），用 fixed 定位，与 .csurface 里的 mini-map 同一套路。
 *
 * 位置约束（用户口径：**限制它在可视区域内移动**）：
 *   浮窗宽高与坐标一律先夹到视口内再落位 —— 否则窗口一矮（比如 684px），
 *   默认 640 高的浮窗按 bottom:74 摆出来，顶边算成负数、底部探出屏幕，整条输入区点不到。
 *   夹的时候留 8px 边距，保证贴边时仍能看到边框与阴影。
 *
 * 拖拽（用户口径 2026-10-09：「右侧 Agent 面板要能拖拽」）：
 *   面板有两种摆法，**两种都能拖**：
 *     · 浮窗态：拖头部 = 整块移动；右下角 = 自由缩放（宽高一起）。
 *     · 停靠态：拖左缘 = 改宽；**拖头部 = 直接拖出来变成浮窗并跟随鼠标**。
 *   最后一条是关键 —— 以前停靠态头部是死的（startDrag 首行就 return），
 *   用户只能先点「切换为浮窗」再拖，等于停靠时没有拖拽。
 *   拖出时**以抓取点为锚**：面板左上角落在「鼠标 - 抓取点偏移」处，
 *   不会因为切换摆法而跳到别的地方（手感与拖浮窗一致）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { History, MessageSquarePlus, PanelRight, PictureInPicture2, Settings2, SlidersHorizontal, X } from 'lucide-vue-next'
import { SlotHost, useUiComponent, broadcastCloseAllDropdowns } from '@mini-canvas/canvas-render'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state

/**
 * 历史对话用**主题目录里的 dropdown**，不自己画浮层。
 *
 * 用户口径（2026-10-03）：「历史记录应该是个下拉菜单，点击其他区域时它会自动折叠。
 * 请参考底部菜单按钮，Skill 和 MCP 使用了下拉组件，你这边的历史记录也应该使用它」。
 *
 * 好处不只是省代码：定位/翻边/出屏收进/点外关闭/Esc/浮层互斥，全部由它统一负责 ——
 * 自绘那版就是漏了「点外关闭」（只有 toggle、选中、Esc 三条路径），所以浮层会一直挂着。
 */
const ThemedDropdown = useUiComponent('dropdown')

/**
 * 历史列表的标题 / 摘要显示：剥掉引用标记再截断。
 *
 * 后端新会话已改为「剥标记后再入标题」，但**老数据**里还留着 `@[node:图片 4](430c8f1f00b…#12)`
 * 这种机器串（用户截图里历史列表一片机器码就是它）；前端剥一道，同一口径，不改后端存量。
 */
function historyText(raw: string, max: number): string {
  const plain = String(raw ?? '')
    .replace(/@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\([^)]*\))?/g, (_m, _k: string, name: string) => '@' + name)
    // 老数据里标题被 24 字符截断时，标记只剩半截（如 `@图片 4(430c8f1f00b`）——
    // 正则匹配不上完整标记，这里把残留的截断括号段也去掉。
    .replace(/\([0-9a-fA-F#-]{6,}[^)]*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? plain.slice(0, max) + '…' : plain
}

/** 视口尺寸（响应式）：窗口变化时重夹尺寸与坐标，浮窗不会因为缩窗口而跑出屏幕 */
const vw = ref(window.innerWidth)
const vh = ref(window.innerHeight)
function onWinResize(): void {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
  clampIntoView()
}
onMounted(() => window.addEventListener('resize', onWinResize))
onBeforeUnmount(() => window.removeEventListener('resize', onWinResize))

/** 浮窗四周留白（照 LiBTV 实测：浮窗距屏幕右缘/下缘各 16px） */
const MARGIN = 16
/** 浮动态默认离底距离（同实测 16px）；窗口矮时会被下面的夹取收紧 */
const DEFAULT_BOTTOM = 16
/** 按下后位移超过它才算「真在拖」——防止点一下头部（想点标题/按钮）也把面板拖出来 */
const DRAG_THRESHOLD = 4
/**
 * 浮窗缩放下限。
 *
 * 从 320 提到 360（用户口径：「最小宽度设置得稍微大一点」）——
 * 目的是给面板内的下拉留出余量：历史下拉宽 320，面板最窄 360 时，
 * 下拉左右各还有 20px，看起来是「装在面板里」而不是贴着边。
 */
const MIN_W = 360
const MIN_H = 320

/** 按视口夹一遍宽高（上限 = 视口 - 两侧留白） */
const fitW = computed(() => Math.max(MIN_W, Math.min(ui.agent.width, vw.value - MARGIN * 2)))
const fitH = computed(() => Math.max(MIN_H, Math.min(s.chatHeight, vh.value - MARGIN * 2)))

/** 浮窗右下角（贴右缘、离底 74）；没有坐标时按它摆 */
function defaultPos(): { x: number; y: number } {
  return { x: Math.max(MARGIN, vw.value - fitW.value - MARGIN), y: Math.max(MARGIN, vh.value - fitH.value - DEFAULT_BOTTOM) }
}
/** 坐标夹进视口：让整块浮窗（含右下角）都留在屏幕内 */
function clampPos(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, vw.value - fitW.value - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, vh.value - fitH.value - MARGIN)),
  }
}
/** 窗口变小后，原本合法的坐标可能越界 —— 主动收回（只在有坐标时动它） */
function clampIntoView(): void {
  if (ui.agent.docked || !s.chatPos) return
  s.chatPos = clampPos(s.chatPos)
}

/** 浮动态的实际坐标（没有显式坐标就落在右下角） */
const floatPos = computed(() => clampPos(s.chatPos ?? defaultPos()))

/**
 * 抓头部开始拖：浮窗态 = 移动；停靠态 = 拖出来（先脱离停靠，再按抓取点锚定跟手）。
 *
 * 共同点：一按就先把开着的下拉收掉（面板要动了，浮层不能跟着挪）。
 * 差异在「起点」：停靠态没有坐标，起点就是它当前的真实矩形（贴右缘、全高），
 * 于是从右缘往左拖时，面板左缘跟着鼠标走，看起来就是"被从边上拽出来"。
 */
function startDrag(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest('button')) return
  e.preventDefault()
  /**
   * 一按就开始拖 → 先把所有还开着的下拉收掉。
   *
   * 用户口径：「我拖拽的时候，就应该把下拉菜单关闭啊。我看我拖拽的时候，下拉菜单还跟着移动了一下」。
   * 不关的话不止是"多一个浮层"——面板在移动，而浮层是**相对面板/触发器定位**的，
   * 拖到一半它还会跟着挪，看起来像黏在面板上。
   *
   * 用广播（而不是 import 某个下拉组件）：外壳不该知道下拉是谁实现的；
   * 两套实现都监听这条广播，谁家的都收得掉。
   */
  broadcastCloseAllDropdowns()
  const shell = (e.currentTarget as HTMLElement).closest('.agent-shell') as HTMLElement | null
  const rect = shell?.getBoundingClientRect()
  /** 抓取点相对面板左上角的偏移：拖出后保持这个相对位置，面板不跳。 */
  const grabDX = rect ? e.clientX - rect.left : 0
  const grabDY = rect ? e.clientY - rect.top : 0
  /** 停靠态按下时先不动；真的拖过了阈值，才切成浮窗（避免点一下头部就掉出停靠）。 */
  let docked = ui.agent.docked
  let base = floatPos.value
  const startX = e.clientX
  const startY = e.clientY
  const move = (ev: PointerEvent): void => {
    if (docked) {
      if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return
      // 脱离停靠：把「按下那一刻」换算成浮窗坐标，后续移动直接接着算 —— 落点与鼠标严丝合缝，
      // 不会因为「先走过阈值」而跳掉那几像素。
      ui.agent.docked = false
      // 高度跟着当前真实高度走（停靠态是全高），拖出来的瞬间不会突然缩成默认的 640
      if (rect) s.chatHeight = Math.round(rect.height)
      base = { x: startX - grabDX, y: startY - grabDY }
      s.chatPos = clampPos(base)
      docked = false
      return
    }
    s.chatPos = clampPos({ x: base.x + (ev.clientX - startX), y: base.y + (ev.clientY - startY) })
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

/** 停靠态：拖左缘改宽度 */
function startResize(e: PointerEvent): void {
  e.preventDefault()
  // 同上：拖宽也是"环境变了"，开着的下拉先收（否则它会跟着宽度变化来回跳）
  broadcastCloseAllDropdowns()
  const startX = e.clientX
  const startW = ui.agent.width
  const move = (ev: PointerEvent): void => {
    ui.agent.width = Math.min(Math.round(vw.value * 0.55), Math.max(MIN_W, startW + (startX - ev.clientX)))
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}

/** 浮动态：右下角同时改宽高，且宽高不许把浮窗顶出视口 */
function startCornerResize(e: PointerEvent): void {
  e.preventDefault()
  // 同上：拖右下角同时改宽高
  broadcastCloseAllDropdowns()
  const startX = e.clientX
  const startY = e.clientY
  const startW = fitW.value
  const startH = fitH.value
  const startPos = floatPos.value
  const move = (ev: PointerEvent): void => {
    const maxW = Math.max(MIN_W, vw.value - startPos.x - MARGIN)
    const maxH = Math.max(MIN_H, vh.value - startPos.y - MARGIN)
    ui.agent.width = Math.min(maxW, Math.max(MIN_W, startW + (ev.clientX - startX)))
    s.chatHeight = Math.min(maxH, Math.max(MIN_H, startH + (ev.clientY - startY)))
  }
  const stop = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    document.body.style.userSelect = ''
  }
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
</script>

<template>
  <section
    v-show="ui.agent.open"
    class="agent-shell"
    :class="{ 'is-docked': ui.agent.docked }"
    :style="ui.agent.docked
      ? { width: ui.agent.width + 'px' }
      : { left: floatPos.x + 'px', top: floatPos.y + 'px', width: fitW + 'px', height: fitH + 'px' }"
    aria-label="Agent 对话面板"
  >
    <div v-if="ui.agent.docked" class="agent-resize" role="separator" aria-orientation="vertical"
      aria-label="调整 Agent 面板宽度" @pointerdown.prevent="startResize"></div>

    <!-- 头部：两种摆法都能抓（浮窗 = 移动；停靠 = 拖出来），所以 draggable 常开 -->
    <header class="agent-head draggable" @pointerdown="startDrag">
      <span class="agent-title" :title="ui.agent.title">{{ ui.agent.title }}</span>
      <div class="agent-actions">
        <button class="agent-icon" aria-label="新建对话" @click="ui.newAgentChat()"><MessageSquarePlus :size="16" /></button>
        <!-- 历史对话：就是**普通的 dropdown**，居中靠它自己的 placement。
             触发器是这个「历史」按钮，所以居中也是相对**它**（placement="bottom" = 菜单中轴对触发器中轴）。
             之前我加过一个 center-on 去对面板中线，那是错的 —— 覆盖掉了组件自带的"对触发器居中"，
             于是菜单相对按钮偏了一大截（用户点名）。 -->
        <component :is="ThemedDropdown || 'div'" v-model="s.agentHistoryOpen" placement="bottom"
          :offset="10" layout="inner-scroll"
          menu-width="320px" menu-max-width="min(320px, calc(100vw - 40px))" menu-max-height="min(60vh, 460px)" menu-role="menu">
          <!-- 触发器**不要**自己写 @click：dropdown 的触发层已经绑了 toggle，
               再写一遍会变成「开→立刻关」（实测点不开，一轮都不谈）。
               这与技能/MCP 那几个触发器的写法一致。 -->
          <template #trigger="{ open }">
            <button class="agent-icon" aria-label="历史对话" :aria-expanded="open"><History :size="16" /></button>
          </template>
          <template #default="{ close }">
            <div class="agent-history" role="menu" aria-label="历史对话">
              <!-- 分组头：与其它下拉同一套结构（标题 + 计数，固定不滚） -->
              <div class="agent-history-head">
                <span class="agent-history-title">历史对话</span>
                <span class="agent-history-count">{{ ui.agent.conversations.length }}</span>
              </div>
              <!-- 列表区：唯一会滚的那层 -->
              <ul class="agent-history-list">
                <!-- 一个对话一行（用户口径 2026-10-06）：分支不再各占一行；
                     选中 = 当前会话属于这棵树（在任意一条分支上都算「在这个对话里」）。 -->
                <li v-for="c in ui.agent.conversations" :key="c.rootId">
                  <button class="agent-history-item" :class="{ 'is-current': c.memberIds.includes(ui.agent.sessionId || '') }"
                    @click="ui.openAgentConversation(c.rootId, c.memberIds); close()">
                    <strong>{{ historyText(c.meta.title, 24) }}</strong>
                    <small>{{ historyText(c.meta.preview || c.rootId, 60) }}</small>
                  </button>
                  <button class="agent-history-icon" :aria-label="'重命名 ' + c.meta.title" @click="ui.renameAgentSession(c.rootId, c.meta.title)">✎</button>
                  <button class="agent-history-icon danger" :aria-label="'删除 ' + c.meta.title" @click="ui.deleteAgentConversation(c.memberIds)">✕</button>
                </li>
                <li v-if="!ui.agent.conversations.length" class="agent-history-empty">还没有历史对话</li>
              </ul>
            </div>
          </template>
        </component>
        <button class="agent-icon" aria-label="Agent 设置" @click="s.settingsOpen = true"><Settings2 :size="16" /></button>
        <!-- TV Director 全局设置：从旧 ChatPanel 的「Agent 偏好」齿轮搬过来。
             那个组件在这次迁移里被删掉了，如果不在新外壳上补一个入口，
             ModalsArea 里那块 600×532 的全局设置弹窗就**永远打不开**（实测：页面上找不到任何按钮）。 -->
        <button class="agent-icon" aria-label="Agent 偏好" title="Agent 偏好" @click="s.directorOpen = true"><SlidersHorizontal :size="16" /></button>
        <!-- 停靠/浮窗切换：**图标要说明点下去会发生什么**，与 aria-label 同向。
             停靠态 → 这枚按钮做的事是「变成浮窗」，所以画悬浮框（PictureInPicture2）；
             浮窗态 → 做的事是「停靠到右缘」，所以画右侧分栏（PanelRight）。
             以前两种状态都画 PanelRight：停靠时图标指的是右下角那块，和「变浮窗」正好相反（用户点名）。 -->
        <button class="agent-icon" :aria-label="ui.agent.docked ? '切换为浮窗' : '停靠到右侧'"
          :title="ui.agent.docked ? '切换为浮窗' : '停靠到右侧'" @click="ui.agent.docked = !ui.agent.docked">
          <PictureInPicture2 v-if="ui.agent.docked" :size="16" />
          <PanelRight v-else :size="16" />
        </button>
        <button class="agent-icon" aria-label="关闭对话" @click="ui.agent.open = false"><X :size="16" /></button>
      </div>
    </header>

    <!-- ★ 红框内的内容：由插件经槽提供（消息流 + 输入区） -->
    <div class="agent-content">
      <SlotHost slot="agent-conversation" />
    </div>

    <div v-if="!ui.agent.docked" class="agent-corner" role="separator" aria-label="调整浮窗大小"
      @pointerdown.prevent="startCornerResize"></div>
  </section>
</template>

<style scoped>
/* 外框 / 圆角 / 阴影 / 头部归本组件；内容的样式在插件里（各管各的） */
/* z-index 必须**高于画布顶栏**（CanvasShell 的 .shell-topbar 是 60）：
   两者相等时后出现的顶栏会压在面板上，右上角那排按钮就和面板标题叠在一起（实测过）。
   停在 62：压得住顶栏，又低于快捷键盘面板(90)与设置/弹窗。 */
/* 浮动态（= LiBTV 的「浮窗」/ 小窗口）：28 圆角 + 1px 浅线 + **不透明底**。
   早期照参考页实测做过半透明底 + 毛玻璃（rgba(31,31,31,.75) / blur(5px)），
   但实测在画布上**读不下去**：底下的节点与网格会透上来，正文和它糊在一起（用户点名）。
   面板是阅读界面，底色必须实心；圆角/边框/阴影保留，浮起来的层次感不靠透明。 */
.agent-shell { position: fixed; z-index: 62; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--ui-shell-line, var(--ui-line, #e2e5ea)); border-radius: 28px; background: var(--ui-overlay-solid, var(--ui-panel, #fff)); color: var(--ui-ink, #18202b); box-shadow: var(--ui-shadow-md, 0 20px 40px rgb(0 0 0 / 0.08)); }
/* 停靠态：去圆角、去阴影，左缘留一条普通分隔线
   （--ui-line 而不是浮窗那条更亮的 --ui-shell-line：它不是浮起的卡片，是贴在画布边上的一条边）。 */
.agent-shell.is-docked { top: 0; bottom: 0; right: 0; height: 100%; border-radius: 0; border-width: 0 0 0 1px; border-color: var(--ui-line, #e2e5ea); background: var(--ui-overlay-solid, var(--ui-panel, #fff)); box-shadow: none; }
.agent-resize { position: absolute; top: 0; bottom: 0; left: 0; z-index: 20; width: 12px; cursor: col-resize; touch-action: none; }
.agent-head { display: flex; flex: none; align-items: center; gap: 8px; padding: 10px 14px 10px 16px; }
.agent-head.draggable { cursor: grab; user-select: none; }
.agent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; line-height: 20px; }
.agent-actions { display: flex; flex: none; align-items: center; gap: 2px; }
.agent-icon { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink, #18202b); cursor: pointer; transition: background 0.16s ease; }
.agent-icon:hover { background: var(--ui-hover, rgb(0 0 0 / 0.05)); }
.agent-content { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 只剩下**内容**样式：外层浮层（定位/边框/底色/圆角/阴影/滚动/点外关闭）由
   dropdown 组件提供 —— 所以这里不再有 position / border / background / shadow。 */
/* 历史下拉（外框/定位/滚动/点外关闭都由 dropdown 提供；这里只管内容）。
   结构与技能 / MCP 那两个下拉**刻意保持一致**：上下 flex 分栏 —— 标题固定、只有列表滚。 */
.agent-history { display: flex; flex-direction: column; min-height: 0; flex: 1; padding: 2px; }
.agent-history-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 8px 10px 6px; }
.agent-history-title { font-size: 12px; font-weight: 600; color: var(--ui-ink, #f7f7f7); }
.agent-history-count { min-width: 18px; padding: 0 5px; border-radius: 999px; background: var(--ui-chip, rgb(255 255 255 / 0.1)); font-size: 10px; line-height: 16px; text-align: center; color: var(--ui-ink-dim, #919191); }
.agent-history-list { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 0 2px 2px; list-style: none; display: flex; flex-direction: column; gap: 2px; }
/* 每行一张卡片（与技能/MCP 下拉同一套观感）：点主体切会话，右侧两个图标按钮管改名/删除 */
.agent-history li { display: flex; align-items: center; gap: 4px; flex: none; padding: 2px 4px; border-radius: 10px; background: transparent; }
.agent-history li:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); }
.agent-history li:has(.agent-history-item.is-current) { background: var(--ui-accent-soft, rgb(8 145 178 / 0.12)); }
.agent-history li:has(.agent-history-item.is-current):hover { background: var(--ui-accent-soft, rgb(8 145 178 / 0.18)); }
.agent-history-item { flex: 1; min-width: 0; padding: 8px; border: 0; background: transparent; text-align: left; cursor: pointer; }
.agent-history-item.is-current strong { color: var(--ui-accent-hover, #0e7490); }
.agent-history-item strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; color: var(--ui-ink, #f7f7f7); }
.agent-history-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--ui-ink-dim, #919191); }
.agent-history-icon { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border: 0; border-radius: 8px; background: transparent; color: var(--ui-ink-dim, #919191); font-size: 12px; cursor: pointer; }
.agent-history-icon:hover { background: var(--ui-hover, rgb(255 255 255 / 0.1)); color: var(--ui-ink, #f7f7f7); }
.agent-history-icon.danger:hover { color: var(--ui-danger, #ef4444); }
.agent-history-empty { padding: 28px 0; text-align: center; font-size: 12px; color: var(--ui-ink-dim, #919191); }
.agent-corner { position: absolute; right: 0; bottom: 0; z-index: 30; width: 16px; height: 16px; cursor: nwse-resize; touch-action: none; }
</style>
