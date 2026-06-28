<template>
  <div class="prose-mirror-editor" @keydown.stop>
    <div ref="editorRef"></div>

    <!-- @ 菜单插槽：调用方完全控制渲染 -->
    <slot
      name="mention-menu"
      :visible="menuVisible"
      :items="filteredItems"
      :grouped-items="groupedItems"
      :category-order="categoryOrder"
      :position="menuPosition"
      :active-index="activeIndex"
      :on-select="insertSelectedItem"
    >
      <MentionMenu
        :visible="menuVisible"
        :items="filteredItems"
        :grouped-items="groupedItems"
        :category-order="categoryOrder"
        :position="menuPosition"
        :active-index="activeIndex"
        @select="insertSelectedItem"
      />
    </slot>

    <!-- 悬停预览框 -->
    <PreviewBox
      :visible="previewVisible"
      :url="previewUrl"
      :title="previewTitle"
      :type="previewType"
      :position="previewPosition"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue';
import { useEditor } from './useEditor.ts';
import MentionMenu from './MentionMenu.vue';
import PreviewBox from './PreviewBox.vue';
import type { ResourceItem } from './types.ts';

const props = defineProps<{
  modelValue?: string;
  resources?: ResourceItem[];
  placeholder?: string;
  resolveResource?: (name: string) => ResourceItem | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'resource-insert': [resource: ResourceItem];
}>();

const editorRef = ref<HTMLElement | null>(null);
const modelValueRef = toRef(props, 'modelValue');
const resourcesRef = toRef(props, 'resources');
const resolveResourceRef = toRef(props, 'resolveResource');

const {
  menuVisible,
  menuPosition,
  activeIndex,
  filteredItems,
  groupedItems,
  categoryOrder,
  insertSelectedItem,
  previewVisible,
  previewUrl,
  previewTitle,
  previewType,
  previewPosition,
  exportText,
  serializeDoc,
  deserializeDoc,
  focusEnd,
} = useEditor(editorRef, {
  modelValue: modelValueRef,
  resources: resourcesRef,
  resolveResource: resolveResourceRef,
}, emit);

// 暴露导出方法给父组件
defineExpose({
  exportText,
  serializeDoc,
  deserializeDoc,
  focusEnd,
});
</script>

<style>

.prose-mirror-editor {
  width: 100%;
  height: 100%;
  outline: none;
}

.prose-mirror-editor > div:first-child {
  width: 100%;
  height: 100%;
  min-height: 120px;
}
</style>
