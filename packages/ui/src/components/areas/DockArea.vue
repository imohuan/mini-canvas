<script setup lang="ts">
// 底部中央 dock：添加节点 / 移动 / 素材库(hover) / 角色造型室 / 生成历史 / 快捷键 / 教程 + TV Director。
// 「移动 / 抓手工具」是**真开关画布交互**的：经 ui.setCanvasMode 写宿主级设置
// （nodesDraggable / panOnDrag），详见 composables/ui.ts 的「画布开关」段。
import {
  Plus, Hand, FolderOpen, Shapes, History, Keyboard, CircleQuestionMark, Sparkles,
  Type, Image as ImageIcon, Video, AudioLines,
  // 下面四个只给「智能剪辑 / 导演台 / 逐帧拉片 / 脚本」用 —— 这几项按用户口径（2026-10-11）暂时隐藏，
  // 图标一并注释掉；日后恢复菜单项时把这行也一起放开。
  // Film, Box, Images, ScrollText,
  Upload, Search, Move,
} from 'lucide-vue-next'
import AxDropdown from '../AxDropdown.vue'
import AxTooltip from '../AxTooltip.vue'
import AxMenu from '../AxMenu.vue'
import AxMenuItem from '../AxMenuItem.vue'
import AgentOrb from '../AgentOrb.vue'
import { useUi } from '../../composables/ui'
import { queueUploadFiles } from '../../composables/assetUploadBus'
import { ref } from 'vue'

const ui = useUi()
const s = ui.state

/**
 * 「+ → 上传」：挑本地文件（可多选，图片 / 视频 / 音频）→ 交给上传弹窗预填。
 *
 * 为什么要绕一步进弹窗（用户口径 2026-10-11「这边可以上传多个文件，支持图片、视频、音频批量上传」）：
 * 批量上传必须还能**改名 / 选保存位置 / 打标签**，静默直传就没有这些了；
 * 所以走的是与「+ → 上传资产」同一个弹窗、同一条落库路径
 * （经 assetUploadBus → 常驻的 AssetUploadHost 开窗）。
 */
const uploadInput = ref<HTMLInputElement | null>(null)
function pickUploadFiles(): void {
  uploadInput.value?.click()
}
function onUploadPick(e: Event): void {
  const input = e.target as HTMLInputElement
  const list = Array.from(input.files ?? []).filter((f) => f.size > 0)
  input.value = ''
  if (!list.length) return
  queueUploadFiles(list)
}
</script>

<template>
  <div class="flex h-[50px] items-center gap-2 rounded-xl border border-line bg-panel px-2" aria-label="画布工具栏"
    @pointerdown.stop>
    <!--
      隐藏的文件选择器：菜单项「上传」触发它。
      放在**下拉之外**（菜单会被 Teleport 且点完就关）—— 若放进菜单里，
      关掉菜单会把 input 一起卸载，用户选完文件时 change 已经没人接了。
    -->
    <input ref="uploadInput" type="file" multiple class="hidden" aria-hidden="true"
      accept="image/jpeg,image/png,image/webp,video/mp4,audio/mpeg,audio/wav" @change="onUploadPick" />
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
        <!--
          以下四项（智能剪辑 / 导演台 / 逐帧拉片 / 脚本）按用户口径（2026-10-11）暂时先注释掉，
          恢复时删掉这一对注释标记即可（对应的图标导入也一并注释在 script 里）。
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
        -->
        <AxMenuItem @click="ui.showToast('音频节点即将支持'); close()">
          <AudioLines :size="15" /> 音频
        </AxMenuItem>
        <!-- 脚本（同样暂时隐藏）
        <AxMenuItem @click="ui.showToast('脚本节点即将支持'); close()">
          <ScrollText :size="15" /> 脚本
        </AxMenuItem>
        -->
        <div class="px-2 py-1.5 text-[10px] font-bold tracking-wider text-ink-dim">素材库</div>
        <AxMenuItem @click="ui.openDrawer('left')">
          <FolderOpen :size="15" /> 添加资源
        </AxMenuItem>
        <AxMenuItem @click="pickUploadFiles(); close()">
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
          <!-- 「风格库」由 plugin-style-library 提供：这里执行它注册的命令（未装该插件则 no-op，不报错） -->
          <AxMenuItem @click="close(); ui.runCommand('style-library:open')">
            <Shapes :size="15" /> 风格库 <em
              class="ml-auto rounded border border-brand/40 px-1.5 py-px text-[9px] not-italic text-brand">NEW</em>
          </AxMenuItem>
          <!-- 「特效库」由 plugin-style-library 提供（与风格库同一插件、两套数据）：执行它注册的命令 -->
          <AxMenuItem @click="close(); ui.runCommand('effect-library:open')">
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
    <AxTooltip content="Agent 对话" placement="left"><button
        class="absolute left-full top-1/2 ml-1.5 grid size-12 -translate-y-1/2 place-items-center rounded-full border border-line bg-panel text-ink"
        aria-label="Agent 对话" :class="{ 'bg-panel-active': ui.agent.open }" @click="ui.toggleAgent()">
        <!-- 表情圆球（照用户给的参考文件移植）：瞳孔跟随鼠标、悬停咧嘴、离开变惊讶。
             按钮本体的 aria-label / tooltip / 点击不变，只把里面的图标换成它。 -->
        <AgentOrb :open="ui.agent.open" />
      </button></AxTooltip>
  </div>
</template>
