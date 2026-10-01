<script setup lang="ts">
// 底部中央 dock：添加节点 / 移动 / 素材库(hover) / 角色造型室 / 生成历史 / 快捷键 / 教程 + TV Director。
// 「移动 / 抓手工具」是**真开关画布交互**的：经 ui.setCanvasMode 写宿主级设置
// （nodesDraggable / panOnDrag），详见 composables/ui.ts 的「画布开关」段。
import {
  Plus, Hand, FolderOpen, Shapes, History, Keyboard, CircleQuestionMark, Sparkles,
  Type, Image as ImageIcon, Video, Film, Box, Images, AudioLines, ScrollText,
  Upload, Search, Move,
} from 'lucide-vue-next'
import AxDropdown from '../AxDropdown.vue'
import AxTooltip from '../AxTooltip.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import { useUi } from '../../composables/ui'

const ui = useUi()
const s = ui.state
</script>

<template>
  <div class="flex h-[50px] items-center gap-2 rounded-xl border border-line bg-panel px-2" aria-label="画布工具栏"
    @pointerdown.stop>
    <AxDropdown v-model="s.addMenuOpen" placement="top" align="center" :offset="10" menu-width="240px">
      <template #trigger>
        <AxTooltip content="添加节点" placement="top">
          <button
            class="grid size-8 place-items-center rounded-lg bg-primary-bg text-primary-ink transition-colors hover:brightness-110"
            :class="{ 'brightness-105': s.addMenuOpen }" aria-label="添加节点">
            <Plus :size="17" />
          </button>
        </AxTooltip>
      </template>
      <template #default="{ close }">
        <div class="mb-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-veil px-2.5 text-ink-dim">
          <Search :size="13" /><input class="w-full bg-transparent text-xs text-ink outline-none" aria-label="搜索画布节点"
            placeholder="搜索画布节点" />
        </div>
        <AxMenuItem @click="ui.createNode('text'); close()">
          <Type :size="15" /> 文本
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('image'); close()">
          <ImageIcon :size="15" /> 图片
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('video'); close()"><Video :size="15" /> 视频</AxMenuItem>
        <AxMenuItem @click="ui.createNode('text'); close()">
          <Film :size="15" /> 智能剪辑 <em
            class="ml-auto rounded border border-gold/40 px-1.5 py-px text-[9px] not-italic text-gold">Beta</em>
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('image'); close()">
          <Box :size="15" /> 导演台 <em
            class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
        </AxMenuItem>
        <AxMenuItem @click="ui.createNode('image'); close()">
          <Images :size="15" /> 逐帧拉片 <em
            class="ml-auto rounded border border-line px-1.5 py-px text-[9px] not-italic text-ink-dim">SD 2.5</em>
        </AxMenuItem>
        <AxMenuItem @click="ui.showToast('音频节点即将支持'); close()">
          <AudioLines :size="15" /> 音频
        </AxMenuItem>
        <AxMenuItem @click="ui.showToast('脚本节点即将支持'); close()">
          <ScrollText :size="15" /> 脚本
        </AxMenuItem>
        <div class="px-2 py-1.5 text-[10px] font-bold tracking-wider text-ink-dim">素材库</div>
        <AxMenuItem @click="ui.openDrawer('left')">
          <FolderOpen :size="15" /> 添加资源
        </AxMenuItem>
        <AxMenuItem @click="ui.showToast('上传资源'); close()">
          <Upload :size="15" /> 上传
        </AxMenuItem>
        <AxMenuItem @click="ui.toggleHistory()">
          <History :size="15" /> 从生成历史选择
        </AxMenuItem>
      </template>
    </AxDropdown>
    <!-- 移动：中轴对齐的下拉（菜单中心 = 按钮中心，箭头居中指按钮），V/H 切换 -->
    <AxDropdown v-model="s.moveMenuOpen" placement="top" align="center" :offset="10" menu-width="200px">
      <template #trigger>
        <button class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
          :class="{ 'bg-chip': s.moveMenuOpen }" aria-label="移动" :aria-expanded="s.moveMenuOpen">
          <component :is="s.canvasMode === 'move' ? Move : Hand" :size="16" />
        </button>
      </template>
      <template #default="{ close }">
        <AxMenu>
          <AxMenuItem :active="s.canvasMode === 'move'" hint="V"
            @click="ui.setCanvasMode('move'); close(); ui.showToast('已切换到移动工具')">
            <Move :size="15" /> 移动
          </AxMenuItem>
          <AxMenuItem :active="s.canvasMode === 'hand'" hint="H"
            @click="ui.setCanvasMode('hand'); close(); ui.showToast('已切换到抓手工具')">
            <Hand :size="15" /> 抓手工具
          </AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
    <!-- 素材库：**点击触发**（与移动一致；方向键/素材库都点开才展开，不再 hover 弹出） -->
    <AxDropdown v-model="s.libraryMenuOpen" placement="top" align="center" :offset="10" menu-width="228px">
      <template #trigger>
        <button class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
          :class="{ 'bg-chip': s.libraryMenuOpen || s.drawer === 'left' }" aria-label="素材库"
          :aria-expanded="s.libraryMenuOpen">
          <FolderOpen :size="16" />
        </button>
      </template>
      <template #default="{ close }">
        <AxMenu>
          <AxMenuItem @click="close(); ui.showToast('风格库')">
            <Shapes :size="15" /> 风格库 <em
              class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
          </AxMenuItem>
          <AxMenuItem @click="close(); ui.showToast('特效库')">
            <Sparkles :size="15" /> 特效库 <em
              class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
          </AxMenuItem>
          <AxMenuItem @click="close(); ui.openDrawer('left')">
            <FolderOpen :size="15" /> 打开工具箱
          </AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
    <AxTooltip content="角色造型室" placement="top"><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="角色造型室"
        @click="ui.openDrawer('roles')">
        <Shapes :size="16" />
      </button></AxTooltip>
    <AxTooltip content="生成历史" placement="top"><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
        :class="{ 'bg-chip': s.historyOpen }" aria-label="生成历史" @click="ui.toggleHistory()">
        <History :size="16" />
      </button></AxTooltip>
    <span class="h-6 w-px bg-line"></span>
    <AxTooltip content="快捷键" placement="top"><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover"
        :class="{ 'bg-chip': s.shortcutsOpen }" aria-label="快捷键" @click="ui.toggleShortcuts()">
        <Keyboard :size="16" />
      </button></AxTooltip>
    <AxTooltip content="教程" placement="top"><button
        class="grid size-8 place-items-center rounded-lg text-ink transition-colors hover:bg-hover" aria-label="教程"
        @click="ui.showToast('教程')">
        <CircleQuestionMark :size="16" />
      </button></AxTooltip>
    <AxTooltip content="TV Director" placement="left"><button
        class="absolute left-full top-1/2 ml-1.5 grid size-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-panel text-ink"
        aria-label="TV Director" :class="{ 'bg-panel-active': s.chatOpen }" @click="s.chatOpen = !s.chatOpen">
        <Sparkles :size="19" />
      </button></AxTooltip>
  </div>
</template>
