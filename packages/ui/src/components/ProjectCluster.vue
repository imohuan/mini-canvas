<script setup lang="ts">
// ProjectCluster —— 左上角「块 A」：logo 下拉 + 项目名 + 画布 chip。
//
// 这个组件在同一个页面里被**渲染两次**（左上角悬浮栏 / 左侧抽屉头部），
// 两块 UI 完全一致，同一时刻只显示一个：抽屉打开时左上角那份隐藏。
import { ChevronDown, MoreHorizontal, Plus } from 'lucide-vue-next'
import AxDropdown from './AxDropdown.vue'
import AxMenu from './AxMenu.vue'
import AxMenuItem from './AxMenuItem.vue'

defineProps<{
  canvas: string
  canvasList: string[]
  menuOpen: boolean
}>()

const emit = defineEmits<{
  'update:menuOpen': [boolean]
  'open-menu': []
  'new-canvas': []
  'pick-canvas': [string]
  'more-canvas': [string]
  rename: []
}>()
</script>

<template>
  <div class="project-cluster">
    <button class="logo-button" aria-label="项目菜单" aria-haspopup="dialog" @click="emit('open-menu')">
      <svg viewBox="0 0 25 14.5" width="25" height="14.5" fill="none" aria-hidden="true"><path fill="currentColor" d="M5.258 10.803h12.458l-1.064 3.742H0L3.099 3.726h4.194zm14.493-7.061H7.293L8.357 0h16.668L21.91 10.82h-4.194z"/></svg>
      <ChevronDown :size="12" class="logo-chevron" />
    </button>
    <input
      class="project-name"
      aria-label="项目名称"
      value="未命名工作区"
      maxlength="120"
      @change="emit('rename')"
    />
    <span class="divider"></span>
    <AxDropdown
      :model-value="menuOpen"
      placement="bottom-start"
      menu-width="214px"
      arrow
      @update:model-value="emit('update:menuOpen', $event)"
    >
      <template #trigger>
        <button class="canvas-chip" aria-label="当前画布" :aria-expanded="menuOpen">
          <span>{{ canvas }}</span><ChevronDown :size="12" />
        </button>
      </template>
      <template #default="{ close }">
        <AxMenu>
          <div class="canvas-menu-head">
            <span>画布</span>
            <button class="canvas-new" aria-label="新建画布" @click="emit('new-canvas'); close()"><Plus :size="13" /></button>
          </div>
          <AxMenuItem
            v-for="name in canvasList"
            :key="name"
            :active="name === canvas"
            @click="emit('pick-canvas', name); close()"
          >
            <span class="canvas-open">{{ name }}</span>
            <span class="canvas-more" aria-hidden="true" @click.stop="emit('more-canvas', name)"><MoreHorizontal :size="13" /></span>
          </AxMenuItem>
        </AxMenu>
      </template>
    </AxDropdown>
  </div>
</template>

<style scoped>
/* 全部走主题变量：亮色下 logo 用深墨色，暗色下用浅色，避免"浅底浅图标"看不清 */
.project-cluster { display: flex; align-items: center; gap: 4px; height: 32px; padding: 0; border: 1px solid var(--ui-line); border-radius: 8px; background: color-mix(in srgb, var(--ui-panel) 80%, transparent); }
.logo-button { width: 57px; height: 32px; display: flex; align-items: center; justify-content: center; gap: 3px; padding: 0 8px; color: var(--ui-ink); border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.logo-chevron { color: var(--ui-ink-dim); }
.project-name { width: 86px; height: 22px; padding: 0 4px; color: inherit; border: 0; border-bottom: 1px dashed transparent; outline: 0; background: transparent; font-family: inherit; font-size: 13px; }
.project-name:hover { border-bottom-color: var(--ui-line); }
.divider { width: 1px; height: 21px; margin: 0; background: var(--ui-line); }
.canvas-chip { height: 32px; display: flex; align-items: center; gap: 4px; padding: 0 8px; color: inherit; border: 0; border-radius: 8px; background: transparent; cursor: pointer; font-size: 13px; }
.logo-button:hover, .canvas-chip:hover { background: var(--ui-hover); }
.canvas-menu-head { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px 8px; font-size: 12px; }
.canvas-new { width: 22px; height: 22px; display: grid; place-items: center; color: var(--ui-ink); border: 0; border-radius: 6px; background: transparent; cursor: pointer; }
.canvas-new:hover { background: var(--ui-hover); }
.canvas-open { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.canvas-more { display: grid; place-items: center; width: 20px; height: 20px; margin-left: auto; color: var(--ui-ink-dim); border-radius: 6px; }
.canvas-more:hover { background: var(--ui-hover); }
</style>
