<template>
  <div class="prose-mirror-editor" @keydown.stop @paste.stop @cut.stop @wheel.stop>
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
      :reflow="reflowMenu"
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
import type { PasteFilesHandler } from './useEditor.ts';

const props = defineProps<{
  modelValue?: string;
  promptDoc?: any;
  resources?: ResourceItem[];
  placeholder?: string;
  resolveResource?: (name: string) => ResourceItem | null;
  /**
   * 是否允许编辑（底栏 AI 生成期间要**锁输入**，用户口径 2026-10-27：加载中不允许编辑）。
   * 缺省 true；false = 只读（ProseMirror view.editable = false，光标/输入/粘贴全禁）。
   */
  editable?: boolean;
  /**
   * 粘贴文件时的外部处理器（图片等）。
   *
   * 组件只负责「取出文件 → 交给它」，具体建节点/连线/标签由调用方决定。
   * 不传 = 粘贴文件不做处理（纯文本粘贴照旧）。
   */
  onPasteFiles?: PasteFilesHandler;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  'update:promptDoc': [value: any];
  'resource-insert': [resource: ResourceItem];
}>();

const editorRef = ref<HTMLElement | null>(null);
const modelValueRef = toRef(props, 'modelValue');
const promptDocRef = toRef(props, 'promptDoc');
const resourcesRef = toRef(props, 'resources');
const resolveResourceRef = toRef(props, 'resolveResource');
const editableRef = toRef(props, 'editable');
const onPasteFilesRef = toRef(props, 'onPasteFiles');

const {
  menuVisible,
  menuPosition,
  activeIndex,
  filteredItems,
  groupedItems,
  categoryOrder,
  insertSelectedItem,
  reflowMenu,
  previewVisible,
  previewUrl,
  previewTitle,
  previewType,
  previewPosition,
  exportText,
  serializeDoc,
  deserializeDoc,
  focusEnd,
  setText,
  markRefSlots,
  insertResource,
  replaceResource,
  replaceResourceThumbByName,
  replaceResourceThumbByIds,
  refreshChips,
  removeRefChips,
  setEditable,
} = useEditor(editorRef, {
  modelValue: modelValueRef,
  promptDoc: promptDocRef,
  resources: resourcesRef,
  resolveResource: resolveResourceRef,
  editable: editableRef,
  onPasteFiles: onPasteFilesRef,
}, emit);

// 暴露导出方法给父组件
defineExpose({
  exportText,
  serializeDoc,
  deserializeDoc,
  focusEnd,
  setText,
  markRefSlots,
  insertResource,
  replaceResource,
  replaceResourceThumbByName,
  replaceResourceThumbByIds,
  refreshChips,
  removeRefChips,
  setEditable,
  /**
   * 编辑器内部的 @ 菜单是否开着（只读）。
   *
   * 为什么需要暴露它：回车在两处都有语义 —— 菜单里是「选这一项」，
   * 输入框外是「提交」。调用方（Agent 面板）必须先知道菜单开没开，
   * 才能决定这个回车该归谁。靠去查 DOM 里的 `.mention-menu` 也行，但那是猜结构；
   * 这里给的是菜单自己的真实状态。
   */
  menuOpen: menuVisible,
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
