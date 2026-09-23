<script setup lang="ts">
// 浮层区：快捷键 / 生成历史 / TV Director 设置 / Toast（全部走独立状态，可与抽屉共存）。
import { X, Grid2x2, LayoutGrid, ChevronDown, ArrowDownUp, ListChecks, Video, Image as ImageIcon, AudioLines, CheckSquare } from 'lucide-vue-next'
import { motion } from 'motion-v'
import AxDialog from '../AxDialog.vue'
import AxDropdown from '../AxDropdown.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import AxScrollArea from '../AxScrollArea.vue'
import AxButton from '../AxButton.vue'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
const kindIcon = (k: string) => (k === '视频' ? Video : k === '音频' ? AudioLines : ImageIcon)
</script>

<template>
  <!-- 快捷键：毛玻璃，相对**整个视口**居中；底部箭头指向 dock 的「快捷键」按钮（中轴对齐） -->
  <div v-if="s.shortcutsOpen" class="fixed inset-0 z-[90] flex flex-col items-center justify-end pb-[74px]" @pointerdown.self="s.shortcutsOpen = false">
    <!-- 箭头：与面板同宽居中，指向上一个元素（dock） -->
    <span class="relative z-[1] -mb-[7px] size-[14px] rotate-45 rounded-[3px] border-b border-r border-line bg-arrow backdrop-blur-[28px]" aria-hidden="true"></span>
    <motion.section
      class="shortcut-modal relative flex h-[437px] w-[min(1152px,calc(100vw-48px))] flex-col rounded-2xl border border-line bg-glass text-ink shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-[28px] backdrop-saturate-[1.4]"
      role="dialog" aria-modal="true" aria-label="快捷键"
      :initial="{ opacity: 0, scale: 0.96, y: 8 }" :animate="{ opacity: 1, scale: 1, y: 0 }"
      :transition="{ duration: 0.22, ease: [0.34, 1.56, 0.64, 1] }" @pointerdown.stop
    >
      <div class="flex items-center justify-end p-1.5">
        <button class="grid size-8 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink" aria-label="关闭快捷键面板" @click="s.shortcutsOpen = false"><X :size="15" /></button>
      </div>
      <div class="grid flex-1 grid-cols-4 gap-x-6 gap-y-1 overflow-y-auto px-5 pb-5">
        <div v-for="col in ui.shortcuts" :key="col.group" class="shortcut-col">
          <h4 class="mb-2 mt-1.5 text-xs font-bold text-brand">{{ col.group }}</h4>
          <div v-for="row in col.items" :key="row[0]" class="flex min-h-[34px] items-center justify-between gap-2.5 border-b border-line-soft text-xs text-ink">
            <span>{{ row[0] }}</span>
            <span class="flex items-center gap-1"><template v-for="(k, i) in row[1]" :key="k + i"><kbd class="rounded-md border border-line bg-veil px-1.5 py-0.5 text-[10px] text-ink">{{ k }}</kbd><em v-if="i < row[1].length - 1" class="not-italic text-ink-dim">+</em></template></span>
          </div>
        </div>
      </div>
    </motion.section>
  </div>

  <!-- 生成历史：无遮罩大弹窗（照 LibTV 实测 min(90vw,1600px) × calc(100vh-160px)） -->
  <AxDialog
    :model-value="s.historyOpen"
    :with-overlay="true"
    width="min(90vw, 1600px)"
    height="calc(100vh - 160px)"
    radius="24px"
    overlay-class="axdlg-overlay--soft"
    @update:model-value="!$event && (s.historyOpen = false)"
  >
    <div class="flex flex-none items-center justify-between gap-4 px-6 pb-5 pt-6">
      <span class="text-lg font-medium leading-[26px] text-ink">生成历史</span>
      <div class="flex items-center gap-4">
        <div class="hist-zoom-wrap flex items-center gap-2 rounded-lg bg-veil p-2" role="group" aria-label="缩放">
          <Grid2x2 :size="16" class="text-ink" />
          <input v-model.number="s.histZoom" type="range" min="1" max="5" step="1" class="hist-zoom h-3 w-[100px] cursor-pointer appearance-none bg-transparent" aria-label="调整卡片密度" />
          <LayoutGrid :size="16" class="text-ink" />
        </div>
        <AxButton variant="ghost" size="icon" aria-label="关闭生成历史" @click="s.historyOpen = false"><X :size="16" /></AxButton>
      </div>
    </div>
    <div class="h-px flex-none bg-line"></div>
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex flex-none flex-wrap items-center justify-between gap-3 px-6 py-3">
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-0.5 rounded-xl bg-veil p-0.5" role="tablist">
            <button v-for="sc in s.histScopes" :key="sc" class="relative h-8 rounded-[10px] px-3 text-sm transition-colors" :class="s.histScope === sc ? 'text-ink' : 'text-ink/60 hover:text-ink'" role="tab" :aria-selected="s.histScope === sc" @click="s.histScope = sc">
              <span v-if="s.histScope === sc" class="absolute inset-0 rounded-[10px] border border-line bg-canvas-bg"></span>
              <span class="relative">{{ sc }}</span>
            </button>
          </div>
          <span class="h-4 w-px bg-line"></span>
          <div class="flex items-center gap-4 pl-1">
            <button v-for="t in s.histTypes" :key="t" class="flex h-8 items-center gap-1.5 text-[13px] transition-colors" :class="s.histType === t ? 'text-brand' : 'text-ink'" @click="s.histType = s.histType === t ? '' : t">
              <span>{{ t }}</span><span class="inline-flex h-4 min-w-4 items-center justify-center rounded bg-chip px-1 text-[11px]">{{ ui.histCount(t) }}</span>
            </button>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <AxDropdown v-model="s.histRatingOpen" placement="bottom-end" menu-width="140px">
            <template #trigger><button class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="所有评级">{{ s.histRating }} <ChevronDown :size="14" /></button></template>
            <template #default="{ close }"><AxMenu><AxMenuItem v-for="r in ['所有评级','已通过','待审核','已拒绝']" :key="r" @click="s.histRating = r; close()">{{ r }}</AxMenuItem></AxMenu></template>
          </AxDropdown>
          <span class="h-4 w-px bg-line"></span>
          <button class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="时间倒序" @click="s.histSortDesc = !s.histSortDesc"><ArrowDownUp :size="14" /> {{ s.histSortDesc ? '时间倒序' : '时间正序' }}</button>
          <button class="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-ink transition-colors hover:bg-hover" aria-label="批量操作" @click="ui.showToast('批量操作')"><ListChecks :size="16" /> 批量操作</button>
        </div>
      </div>
      <AxScrollArea class="min-h-0 flex-1" direction="y" body-class="px-10 pb-6">
        <div v-if="ui.histVisible.length" class="grid gap-3" :style="{ gridTemplateColumns: 'repeat(' + (s.histZoom + 2) + ', minmax(0, 1fr))' }">
          <article v-for="item in ui.histVisible" :key="item.title" class="flex cursor-pointer flex-col gap-1 rounded-[10px] border border-line bg-veil p-2 text-left transition-colors hover:border-brand hover:bg-hover" @click="ui.showToast('打开 ' + item.title)">
            <div class="mb-1 grid h-[92px] place-items-center rounded-lg bg-gradient-to-br from-[#3a3550] to-[#23242c] text-brand"><component :is="kindIcon(item.kind)" :size="22" /></div>
            <strong class="text-xs font-semibold">{{ item.title }}</strong>
            <span class="text-[10px] text-ink-mute">{{ item.kind }} · {{ item.time }}</span>
          </article>
        </div>
        <p v-else class="pt-24 text-center text-[13px] text-ink/50">暂无历史记录</p>
      </AxScrollArea>
    </div>
  </AxDialog>

  <!-- TV Director 全局设置：独立全局弹窗（不在 Agent 面板内） -->
  <AxDialog :model-value="s.directorOpen" width="600px" height="532px" radius="12px" @update:model-value="!$event && (s.directorOpen = false)">
    <div class="flex items-center justify-between px-4 pb-2.5 pt-4">
      <div><span class="block text-[9px] font-extrabold tracking-[0.12em] text-ink-dim">TV DIRECTOR</span><strong class="text-[15px]">全局设置</strong></div>
      <AxButton variant="ghost" size="icon" aria-label="关闭全局设置" @click="s.directorOpen = false"><X :size="15" /></AxButton>
    </div>
    <div class="mx-4 mb-3 rounded-lg bg-veil px-3 py-2 text-xs text-gold">非会员每天免费对话 3 轮，即刻体验！</div>
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
      <div class="mb-4 rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">协作模式</strong><p class="text-xs text-ink-dim">自动生成图片/视频/音频/剧本</p><small class="block text-[11px] text-ink-mute">开启后，TV Director 可直接消耗积分，提交生成任务，无需逐次确认</small><em class="block text-[10px] not-italic text-ink-dim">新建会话默认生效，当前会话请前往输入框底部切换</em></div>
          <button class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform" :class="{ 'after:translate-x-4 bg-brand': s.director.collab }" role="switch" :aria-checked="s.director.collab" aria-label="协作模式" @click="s.director.collab = !s.director.collab"></button>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">积分预算管理</strong><p class="text-xs text-ink-dim">开启后，当本项目累计消耗积分达到设置阈值时，会提醒你留意用量</p></div>
          <button class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform" :class="{ 'after:translate-x-4 bg-brand': s.director.budget }" role="switch" :aria-checked="s.director.budget" aria-label="积分预算管理" @click="s.director.budget = !s.director.budget"></button>
        </div>
        <div v-if="s.director.budget" class="flex items-center justify-between gap-3 border-t border-line pt-2">
          <span class="text-xs text-ink-dim">提醒阈值设置</span>
          <input v-model.number="s.director.budgetLimit" type="number" min="100" step="100" class="h-8 w-28 rounded-lg border border-line bg-veil px-2 text-xs text-ink outline-none" aria-label="提醒阈值设置" />
        </div>
      </div>
      <div class="rounded-xl border border-line p-3">
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">浏览器通知</strong><p class="text-xs text-ink-dim">TV Director 回复完成后，会在系统通知提醒</p></div>
          <button class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform" :class="{ 'after:translate-x-4 bg-brand': s.director.notify }" role="switch" :aria-checked="s.director.notify" aria-label="浏览器通知" @click="s.director.notify = !s.director.notify"></button>
        </div>
        <div class="flex items-center justify-between gap-3 py-2">
          <div><strong class="text-[13px] text-ink">通知声音</strong><p class="text-xs text-ink-dim">开启后，收到通知时播放提示音</p></div>
          <button class="relative h-6 w-10 flex-none rounded-full bg-hover-strong transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-white after:transition-transform" :class="{ 'after:translate-x-4 bg-brand': s.director.sound }" role="switch" :aria-checked="s.director.sound" aria-label="通知声音" @click="s.director.sound = !s.director.sound"></button>
        </div>
      </div>
    </div>
    <div class="flex flex-none justify-end border-t border-line p-3">
      <button class="rounded-lg border border-line px-3 py-1.5 text-xs text-ink transition-colors hover:bg-hover hover:text-ink" @click="s.directorOpen = false; ui.showToast('设置已保存')">完成</button>
    </div>
  </AxDialog>

</template>

<style scoped>
/* 缩放滑块：轨道/滑块用主题变量，亮暗都可读 */
.hist-zoom::-webkit-slider-runnable-track { height: 2px; border-radius: 9999px; background: var(--ui-hover-strong); }
.hist-zoom::-webkit-slider-thumb { margin-top: -3.5px; width: 9px; height: 9px; appearance: none; border-radius: 9999px; background: var(--ui-ink); }
.hist-zoom::-moz-range-track { height: 2px; border-radius: 9999px; background: var(--ui-hover-strong); }
.hist-zoom::-moz-range-thumb { width: 9px; height: 9px; border: 0; border-radius: 9999px; background: var(--ui-ink); }
</style>
