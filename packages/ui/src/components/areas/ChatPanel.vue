<script setup lang="ts">
// AI 对话面板：浮动(可拖) ⇄ 停靠(右缘, 带左缘拖宽手柄)，被外壳计入 right-width。
import {
  MessageSquarePlus, History, Share2, Settings2, Puzzle, PanelRight, X,
  Video, Paperclip, Cpu, WandSparkles, ArrowUp, Hand, Search, Pencil, Trash2,
} from 'lucide-vue-next'
import AxDropdown from '../AxDropdown.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
</script>

<template>
  <section
    v-show="s.chatOpen"
    class="chat-panel fixed z-[60] flex flex-col overflow-hidden rounded-[28px] border border-line bg-overlay text-ink shadow-[0_4px_10px_rgba(0,0,0,0.1)] backdrop-blur-sm"
    :class="{ 'inset-y-0 right-0 h-full rounded-none border-0 bg-panel-soft': s.chatDocked, 'bottom-[74px] left-1/2 -translate-x-1/2': !s.chatDocked && !s.chatPos }"
    :style="s.chatDocked
      ? { width: s.chatWidth + 'px' }
      : (s.chatPos
        ? { left: s.chatPos.x + 'px', top: s.chatPos.y + 'px', bottom: 'auto', transform: 'none', width: s.chatWidth + 'px', height: s.chatHeight + 'px' }
        : { bottom: '74px', height: s.chatHeight + 'px', width: s.chatWidth + 'px' })
    "
    aria-label="AI 对话面板"
  >
    <div v-if="s.chatDocked" class="absolute bottom-0 left-0 top-0 z-20 w-3 cursor-col-resize touch-none" role="separator" aria-label="调整 AI 助手面板宽度" aria-orientation="vertical" @pointerdown.prevent="ui.startChatResize($event)"></div>
    <header class="flex items-center justify-between gap-2 px-4 pb-3.5 pt-2.5" :class="s.chatDocked ? '' : 'cursor-grab'" @pointerdown="ui.startChatDrag($event)">
      <span class="min-w-0 flex-1 truncate text-[13px] font-medium leading-5" :title="s.chatTitle">{{ s.chatTitle }}</span>
      <div class="flex flex-none items-center gap-0.5">
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="新建对话" @click="s.chatMessages = []; ui.showToast('已新建对话')"><MessageSquarePlus :size="16" /></button>
        <AxDropdown placement="bottom-end" :offset="6" menu-width="320px">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="历史对话"><History :size="16" /></button></template>
          <template #default="{ close }">
            <div class="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-veil px-2.5 text-ink-dim"><Search :size="13" /><input class="w-full bg-transparent text-xs text-ink outline-none" aria-label="搜索历史对话" placeholder="搜索历史对话" /></div>
            <div v-for="(h, hi) in s.chatHistories" :key="h.title" class="flex items-center gap-1 rounded-lg px-1 hover:bg-hover-soft">
              <button class="flex min-w-0 flex-1 items-baseline gap-2 py-2 text-left" @click="s.chatTitle = h.title; close(); ui.showToast('打开 ' + h.title)">
                <strong class="text-xs text-ink">{{ h.title }}</strong><span class="text-[10px] text-ink-dim">{{ h.date }}</span>
              </button>
              <button class="grid size-6 place-items-center rounded-md text-ink-dim hover:bg-hover hover:text-ink" :aria-label="'重命名 ' + h.title" @click="ui.renameChat(hi)"><Pencil :size="13" /></button>
              <button class="grid size-6 place-items-center rounded-md text-ink-dim hover:bg-hover hover:text-danger" :aria-label="'删除「' + h.title + '」'" @click="s.chatHistories.splice(hi, 1); ui.showToast('已删除「' + h.title + '」')"><Trash2 :size="13" /></button>
            </div>
          </template>
        </AxDropdown>
        <AxDropdown placement="bottom-end" :offset="6" menu-width="334px">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="分享"><Share2 :size="16" /></button></template>
          <template #default="{ close }">
            <div class="p-2"><strong class="mb-2 block text-xs text-ink">公开浏览权限</strong><p class="mb-3 text-[11px] leading-relaxed text-ink-dim">点击下方按钮生成链接。有链接的人可以浏览对话内容，不能编辑。</p><button class="h-8 w-full rounded-lg bg-chip text-xs text-ink transition-colors hover:bg-hover-strong" @click="close(); ui.showToast('已生成并复制分享链接')">生成分享链接</button></div>
          </template>
        </AxDropdown>
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="Agent 偏好" @click="s.directorOpen = true"><Settings2 :size="16" /></button>
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="插件" @click="ui.showToast('插件')"><Puzzle :size="16" /></button>
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" :aria-label="s.chatDocked ? '切换为浮窗' : '停靠到右侧'" @click="s.chatDocked = !s.chatDocked"><PanelRight :size="16" /></button>
        <button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="关闭对话" @click="s.chatOpen = false"><X :size="16" /></button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4">
      <template v-for="(m, i) in s.chatMessages" :key="i">
        <div v-if="m.refs" class="mb-3">
          <p class="text-xs leading-relaxed text-ink/90">
            <span
              v-for="ref in m.refs" :key="ref.name"
              class="mr-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-chip px-1.5 py-0.5 text-[11px] align-middle transition-colors hover:bg-hover-strong"
              :title="ref.name + ' · 点击定位到画布节点'"
              @click="ui.showToast('定位到 ' + ref.name)"
            ><Video :size="13" /> {{ ref.name }}</span>
            {{ m.refs[0]?.prompt }}
          </p>
        </div>
        <div class="mb-3 flex items-start gap-2">
          <span class="mt-0.5 grid size-6 flex-none place-items-center rounded-full text-[9px] font-bold" :class="m.role === 'user' ? 'bg-hover-strong text-ink' : 'bg-brand text-ink'">{{ m.role === 'user' ? 'ME' : 'AI' }}</span>
          <p class="text-xs leading-relaxed text-ink/90">{{ m.text }}</p>
        </div>
      </template>
      <div v-if="!s.chatMessages.length" class="py-10 text-center text-xs text-ink-dim">开始一段新对话，或从画布节点总结 Skill。</div>
      <div class="flex flex-col items-end gap-2 pb-4">
        <button v-for="g in s.chatSuggestions" :key="g" class="rounded-lg bg-veil px-3 py-1.5 text-xs text-ink/90 transition-colors hover:bg-hover" @click="s.chatInput = g">{{ g }}</button>
      </div>
    </div>

    <div class="flex-none px-4 pb-4">
      <div class="mb-2 flex items-center gap-2">
        <textarea v-model="s.chatInput" rows="1" class="min-h-9 max-h-24 flex-1 resize-none rounded-2xl border border-line bg-veil px-3 py-2 text-xs text-ink outline-none placeholder:text-ink-dim" placeholder="开始你的创作，或者 @ 引用工作流/节点/资源" aria-label="对话输入" @keydown.enter.prevent="ui.sendChat()"></textarea>
        <button class="grid size-9 flex-none place-items-center rounded-full bg-primary-bg text-primary-ink transition-opacity hover:brightness-110 disabled:opacity-40" aria-label="Send" :disabled="!s.chatInput.trim()" @click="ui.sendChat()"><ArrowUp :size="16" /></button>
      </div>
      <div class="flex items-center gap-1">
        <AxDropdown placement="top-start" :offset="8">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="添加附件"><Paperclip :size="15" /></button></template>
          <template #default="{ close }">
            <AxMenu>
              <AxMenuItem @click="close(); ui.showToast('本地上传')"><Paperclip :size="14" /> 本地上传</AxMenuItem>
              <AxMenuItem @click="close(); ui.openDrawer('left')"><Search :size="14" /> 素材库添加</AxMenuItem>
            </AxMenu>
          </template>
        </AxDropdown>
        <AxDropdown v-model="s.chatModeOpen" placement="top-start" :offset="8">
          <template #trigger><button class="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-ink transition-colors hover:bg-hover" aria-label="选择创作模式">{{ s.chatMode }} <span class="text-[9px]">▼</span></button></template>
          <template #default="{ close }"><AxMenu><AxMenuItem v-for="m in s.chatModes" :key="m" @click="s.chatMode = m; close()">{{ m }}</AxMenuItem></AxMenu></template>
        </AxDropdown>
        <AxDropdown placement="top" align="center" :offset="8" menu-width="370px">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" :aria-label="'选择模型 ' + s.currentModel"><Cpu :size="15" /></button></template>
          <template #default="{ close }">
            <div class="mb-1 flex items-center justify-between px-2 py-1"><strong class="text-xs text-ink">选择模型</strong>
              <span class="flex gap-1"><button class="rounded-md px-2 py-0.5 text-[11px]" :class="s.modelTab === 'image' ? 'bg-chip text-ink' : 'text-ink-dim'" @click="s.modelTab = 'image'">图片</button><button class="rounded-md px-2 py-0.5 text-[11px]" :class="s.modelTab === 'video' ? 'bg-chip text-ink' : 'text-ink-dim'" @click="s.modelTab = 'video'">视频</button></span>
            </div>
            <button v-for="m in s.models" :key="m.name" class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover-soft" :class="{ 'bg-chip': s.currentModel === m.name }" @click="s.currentModel = m.name; close()">
              <span class="min-w-0 flex-1"><span class="block truncate text-xs text-ink">{{ m.name }}</span><span class="block truncate text-[10px] text-ink-dim">{{ m.desc }}</span></span>
            </button>
          </template>
        </AxDropdown>
        <AxDropdown placement="top" align="center" :offset="8" menu-width="450px">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" aria-label="Skill"><WandSparkles :size="15" /></button></template>
          <template #default>
            <div class="mb-1 flex items-center justify-between px-2 py-1"><strong class="text-xs text-ink">Skill</strong>
              <span class="flex gap-1"><button v-for="t in (['all','fav','mine'] as const)" :key="t" class="rounded-md px-2 py-0.5 text-[11px]" :class="s.skillTab === t ? 'bg-chip text-ink' : 'text-ink-dim'" @click="s.skillTab = t">{{ t === 'all' ? '全部' : t === 'fav' ? '收藏' : '我的' }}</button></span>
            </div>
            <div class="mb-1 flex h-8 items-center gap-1.5 rounded-lg bg-veil px-2.5 text-ink-dim"><Search :size="13" /><input class="w-full bg-transparent text-xs text-ink outline-none" aria-label="搜索 Skill" placeholder="搜索 Skill" /></div>
            <div v-for="sk in s.skills" :key="sk.name" class="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-hover-soft">
              <button class="grid size-6 flex-none place-items-center rounded-full border border-line text-[11px]" :class="s.currentSkill === sk.name ? 'bg-brand text-ink' : 'text-ink-dim'" @click="s.currentSkill = s.currentSkill === sk.name ? null : sk.name; ui.showToast(s.currentSkill === sk.name ? '已启用 ' + sk.name : '已停用 ' + sk.name)">{{ s.currentSkill === sk.name ? '✓' : '＋' }}</button>
              <span class="min-w-0 flex-1"><strong class="block text-xs text-ink">{{ sk.name }}</strong><code class="block truncate text-[10px] text-ink-dim">{{ sk.path }}</code><small class="block truncate text-[10px] text-ink-mute">{{ sk.desc }}</small></span>
              <button class="rounded-md px-2 py-1 text-[11px] text-ink-dim hover:bg-hover hover:text-ink" :aria-label="'详情 ' + sk.name" @click="ui.showToast('查看 ' + sk.name + ' 详情')">详情</button>
            </div>
          </template>
        </AxDropdown>
        <AxDropdown placement="top-end" :offset="8">
          <template #trigger><button class="grid size-7 place-items-center rounded-lg text-ink transition-colors hover:bg-hover hover:text-ink" :aria-label="s.genMode === 'manual' ? '手动生成' : '自动生成'"><Hand :size="15" /></button></template>
          <template #default="{ close }">
            <AxMenu>
              <AxMenuItem :active="s.genMode === 'manual'" @click="s.genMode = 'manual'; close()"><span class="flex-1"><span class="block text-xs">手动生成 <em class="ml-1 text-[9px] not-italic text-brand">TV Director</em></span><span class="block text-[10px] text-ink-dim">每次生成前询问</span></span></AxMenuItem>
              <AxMenuItem :active="s.genMode === 'auto'" @click="s.genMode = 'auto'; close()"><span class="flex-1"><span class="block text-xs">自动生成 <em class="ml-1 text-[9px] not-italic text-brand">TV Director</em></span><span class="block text-[10px] text-ink-dim">可直接消耗积分</span></span></AxMenuItem>
            </AxMenu>
          </template>
        </AxDropdown>
        <span class="ml-auto text-[11px] text-ink-dim">上下文剩余 {{ s.contextLeft }}%</span>
      </div>
    </div>
    <!-- 右下角缩放手柄：宽高一起拖，最小 320×400 -->
    <div
      v-if="!s.chatDocked"
      class="absolute bottom-0 right-0 z-30 size-4 cursor-nwse-resize touch-none select-none"
      role="separator"
      aria-label="调整浮窗大小"
      @pointerdown.prevent="ui.startChatCornerResize($event)"
    ></div>
  </section>
</template>
