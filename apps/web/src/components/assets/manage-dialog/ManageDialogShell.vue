<script setup lang="ts">
// 资产管理弹窗的纯外壳：遮罩、标题栏、左库列表、右工具行与内容插槽。
// 模板与样式保持原样，动作全部由入口经 props / emits 注入。
import { ChevronRight as ChevronIcon, Library as LibIcon } from 'lucide-vue-next'

defineProps<{
  breadcrumb: { id?: string; name: string }[]
  showBatch: boolean
}>()

const emit = defineEmits<{
  close: []
  goToFolder: [id?: string]
}>()
</script>

<template>
  <div class="plume-layer-dialog fixed inset-0 flex items-center justify-center">
    <div class="absolute inset-0 bg-veil" aria-hidden="true" @click="emit('close')"></div>
    <div
      class="relative flex h-[min(760px,calc(100vh-64px))] w-[min(1560px,calc(100vw-64px))] flex-col overflow-hidden rounded-2xl border border-line bg-panel text-ink shadow-[var(--ui-shadow-md)]"
      role="dialog" aria-modal="true" aria-label="资产管理">
      <!-- 标题行 -->
      <div class="flex h-12 flex-none items-center justify-between border-b border-line px-5">
        <span class="text-sm font-medium">资产管理</span>
        <button
          class="grid size-7 place-items-center rounded-lg text-ink-dim transition-colors hover:bg-hover hover:text-ink"
          aria-label="关闭" @click="emit('close')">
          <slot name="closeIcon" />
        </button>
      </div>

      <div class="flex min-h-0 flex-1">
        <!-- 左：库列表 -->
        <aside class="flex w-[210px] flex-none flex-col gap-0.5 border-r border-line p-2">
          <button class="flex h-9 items-center gap-2 rounded-lg bg-hover px-2.5 text-left text-[13px] text-ink"
            :aria-current="true">
            <LibIcon :size="15" class="text-ink-dim" /> 个人资产库
          </button>
          <!-- <button class="flex h-9 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-ink-dim transition-colors hover:bg-hover" aria-label="可灵主体库">
            <span class="grid size-4 place-items-center rounded-full border border-line text-[9px]">K</span> 可灵主体库
          </button> -->
        </aside>

        <!-- 右：内容区 -->
        <div class="flex min-w-0 flex-1 flex-col">
          <!-- 工具行：面包屑 + 搜索/批量/筛选/新建 -->
          <div class="flex h-12 flex-none items-center gap-1 px-4">
            <template v-for="(b, i) in breadcrumb" :key="b.name">
              <button class="flex h-7 items-center rounded-lg px-1.5 text-[13px] transition-colors"
                :class="i === breadcrumb.length - 1 ? 'font-medium text-ink' : 'text-ink-dim hover:bg-hover'"
                :aria-current="i === breadcrumb.length - 1" @click="emit('goToFolder', b.id)">{{ b.name }}</button>
              <ChevronIcon v-if="i < breadcrumb.length - 1" :size="13" class="text-ink-dim" />
            </template>
            <span class="flex-1"></span>
            <slot name="tools" />
          </div>

          <!-- 内容：**树形列表**（与侧边栏同一个共用组件；右键 / 拖拽 / 菜单行为完全一致） -->
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <slot name="tree" />
          </div>
        </div>
      </div>

      <!-- 底部批量条（宽容器 = 完整文字版） -->
      <div v-if="showBatch" class="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
        <slot name="batch" />
      </div>
    </div>
  </div>
</template>
