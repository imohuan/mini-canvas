<template>
  <div class="prose-mirror-editor">
    <div ref="editorRef"></div>

    <!-- 资源/变量选择菜单 -->
    <MentionMenu
      :visible="menuVisible"
      :resources="filteredResources"
      :variables="filteredVariables"
      :menu-type="menuType"
      :position="menuPosition"
      :active-index="activeIndex"
      @select="insertSelectedItem"
      @hover="handleMenuHover"
    />

    <!-- 悬停预览框 -->
    <PreviewBox
      :visible="previewVisible"
      :url="previewUrl"
      :title="previewTitle"
      :type="previewType"
      :position="previewPosition"
    />

    <!-- 全屏预览 -->
    <FullscreenPreview
      :visible="fullscreenVisible"
      :url="fullscreenUrl"
      :type="fullscreenType"
      @close="closeFullscreen"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue';
import { useEditor } from './useEditor.ts';
import MentionMenu from './MentionMenu.vue';
import PreviewBox from './PreviewBox.vue';
import FullscreenPreview from './FullscreenPreview.vue';
import type { ResourceItem, VariableItem } from './types.ts';

const props = defineProps<{
  modelValue?: string;
  resources?: ResourceItem[];
  variables?: VariableItem[];
  placeholder?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'resource-insert': [resource: ResourceItem];
  'variable-insert': [variable: VariableItem];
}>();

const editorRef = ref<HTMLElement | null>(null);
const modelValueRef = toRef(props, 'modelValue');
const resourcesRef = toRef(props, 'resources');
const variablesRef = toRef(props, 'variables');

const {
  menuVisible,
  menuPosition,
  activeIndex,
  menuType,
  filteredResources,
  filteredVariables,
  insertSelectedItem,
  handleMenuHover,
  previewVisible,
  previewUrl,
  previewTitle,
  previewType,
  previewPosition,
  fullscreenVisible,
  fullscreenUrl,
  fullscreenType,
  closeFullscreen,
  exportText,
  serializeDoc,
  deserializeDoc,
} = useEditor(editorRef, {
  modelValue: modelValueRef,
  resources: resourcesRef,
  variables: variablesRef,
}, emit);

// 暴露导出方法给父组件
defineExpose({
  exportText,
  serializeDoc,
  deserializeDoc,
});
</script>

<style>
/* 导入完整样式 */
@import './style.css';

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
