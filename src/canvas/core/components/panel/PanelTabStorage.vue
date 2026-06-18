<script setup lang="ts">
import { computed } from 'vue'
import type { StorageStatus, ProjectMeta } from '../../plugins/storage/StoragePlugin'

const props = defineProps<{
  storageStatus?: StorageStatus & { projects: ProjectMeta[] }
}>()

const emit = defineEmits<{
  (e: 'storageConnect'): void
  (e: 'storageDisconnect'): void
  (e: 'storageCreateProject', name: string): void
  (e: 'storageDeleteProject', id: string): void
  (e: 'storageSwitchProject', id: string): void
}>()

const storage = computed(() => props.storageStatus)
const storageProjects = computed(() => storage.value?.projects || [])

const modeLabelText: Record<string, string> = {
  localStorage: 'localStorage',
  filesystem: '文件系统',
  none: '未连接',
}

function statusBadgeClass(mode: string) {
  if (mode === 'filesystem') return 'bg-[#10b981]/15 text-[#34d399] border-[#10b981]/30'
  if (mode === 'localStorage') return 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
  return 'bg-[#71717a]/15 text-[#a1a1aa] border-[#71717a]/30'
}

let projectNameInput = ''

function createProject() {
  const name = projectNameInput.trim() || `项目 ${Date.now()}`
  emit('storageCreateProject', name)
  projectNameInput = ''
}

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer'
const btnInactive = 'bg-[#2d2b30] text-[#9c9aa3] hover:bg-[#3a3740] hover:text-[#f0f0f2]'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center gap-2 text-[11px] text-[#b2b0b9]'
</script>

<template>
  <div :class="sectionTitle">状态</div>
  <div :class="rowItem">
    <span>模式</span>
    <span class="px-1.5 py-0.5 rounded text-[10px] font-semibold border"
      :class="statusBadgeClass(storage?.mode || 'none')">
      {{ modeLabelText[storage?.mode || 'none'] || storage?.mode }}
    </span>
  </div>
  <div :class="rowItem" v-if="storage?.workspaceName">
    <span>工作区</span>
    <span class="text-[11px] text-[#47464a] truncate font-mono">{{ storage.workspaceName }}</span>
  </div>
  <div :class="rowItem">
    <span>项目数</span>
    <span class="text-[11px] text-[#47464a]">{{ storage?.projectCount ?? 0 }}</span>
  </div>
  <div class="flex gap-1 mt-2">
    <button :class="[btnBase, btnInactive]"
      :disabled="storage?.mode === 'filesystem'"
      @click="emit('storageConnect')">
      连接文件夹
    </button>
    <button :class="[btnBase, btnInactive]"
      :disabled="storage?.mode !== 'filesystem'"
      @click="emit('storageDisconnect')">
      断开
    </button>
  </div>

  <div :class="sectionTitle">创建项目</div>
  <div class="flex gap-1">
    <input v-model="projectNameInput" placeholder="项目名称..."
      class="flex-1 px-2 py-1 rounded text-[11px] bg-[#1e1c21] border border-[#3a3740] text-[#f0f0f2] outline-none focus:border-[#3b82f6]/50"
      @keydown.enter="createProject" />
    <button :class="[btnBase, btnInactive]" @click="createProject">创建</button>
  </div>

  <div :class="sectionTitle">项目列表</div>
  <div v-if="storageProjects.length > 0" class="flex flex-col gap-1">
    <div v-for="proj in storageProjects" :key="proj.id"
      class="flex items-center justify-between px-2 py-1 rounded text-[11px] cursor-pointer"
      :class="storage?.currentProjectId === proj.id
        ? 'bg-[#3b82f6]/15 text-[#60a5fa]'
        : 'text-[#b2b0b9] hover:bg-[#2d2b30]'"
      @click="emit('storageSwitchProject', proj.id)">
      <span>{{ proj.name }}</span>
      <span v-if="storage?.currentProjectId === proj.id"
        class="text-[9px] text-[#34d399]">● 当前</span>
      <button v-if="storageProjects.length > 1"
        class="text-[#ef4444]/60 hover:text-[#ef4444] text-xs px-1"
        @click.stop="emit('storageDeleteProject', proj.id)">×</button>
    </div>
  </div>
  <div v-else :class="rowItem">暂无项目</div>
</template>