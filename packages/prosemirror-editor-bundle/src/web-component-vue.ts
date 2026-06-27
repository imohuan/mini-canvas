import { defineCustomElement } from 'vue';
import ProseMirrorEditorComponent from './index.vue';

// 将 Vue 组件转换为 Web Component
const ProseMirrorEditorElement = defineCustomElement(ProseMirrorEditorComponent);

// 注册自定义元素
if (!customElements.get('prosemirror-editor')) {
  customElements.define('prosemirror-editor', ProseMirrorEditorElement);
}

export { ProseMirrorEditorElement };
