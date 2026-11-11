<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PluginDocEntry } from '../../data/plugins.data'

/**
 * 插件功能总表：把「插件声明了什么」渲染成一屏能看懂的卡片墙。
 * 数据由 MD 页面从 plugins.data.ts 传入（构建期扫 package.json 得到）。
 */
const props = defineProps<{
  plugins: PluginDocEntry[]
}>()

const keyword = ref('')
const onlyInstallable = ref(false)

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return props.plugins.filter((p) => {
    if (onlyInstallable.value && !p.installable) return false
    if (!k) return true
    return (
      p.title.toLowerCase().includes(k) ||
      p.name.toLowerCase().includes(k) ||
      p.description.toLowerCase().includes(k) ||
      p.npmName.toLowerCase().includes(k)
    )
  })
})
</script>

<template>
  <div class="plume-plugin-toolbar">
    <input v-model="keyword" type="search" placeholder="搜索插件名 / 标识 / 说明…" />
    <label class="plume-badge">
      <input v-model="onlyInstallable" type="checkbox" style="margin-right: 6px" />
      只看可安装
    </label>
    <span class="plume-badge">共 {{ filtered.length }} / {{ plugins.length }} 个</span>
  </div>

  <div v-if="plugins.length === 0" class="plume-empty">
    没扫到插件。请确认 packages/plugins 下有声明 plume.builtin / installable 的插件。
  </div>

  <div v-else-if="filtered.length === 0" class="plume-empty">没有匹配的插件。</div>

  <div v-else class="plume-plugin-grid">
    <div v-for="p in filtered" :key="p.id" class="plume-plugin-card">
      <h4>{{ p.title }}</h4>
      <p v-if="p.description">{{ p.description }}</p>
      <p class="plume-code">{{ p.npmName }}@{{ p.version }}</p>
      <div class="plume-badges">
        <span class="plume-badge">标识 {{ p.name }}</span>
        <span :class="['plume-badge', p.builtin ? 'plume-badge--on' : 'plume-badge--off']">
          {{ p.builtin ? '自带' : '非自带' }}
        </span>
        <span :class="['plume-badge', p.installable ? 'plume-badge--on' : 'plume-badge--off']">
          {{ p.installable ? '可安装' : '不可装卸' }}
        </span>
        <span v-if="p.hasServer" class="plume-badge plume-badge--on">有后台</span>
        <span v-if="p.hasWeb" class="plume-badge plume-badge--on">独立产物</span>
        <span v-for="perm in p.serverPermissions" :key="perm" class="plume-badge">
          权限 {{ perm }}
        </span>
      </div>
    </div>
  </div>
</template>
