import { App } from 'vue';
import ProseMirrorEditorComponent from './index.vue';

export { default as ProseMirrorEditor } from './index.vue';
export * from './types.ts';
export * from './utils.ts';
import "./style.css"

// Vue 插件安装方法
export function install(app: App) {
  app.component('ProseMirrorEditor', ProseMirrorEditorComponent);
}

// 默认导出支持 Vue.use()
export default {
  install,
  ProseMirrorEditor: ProseMirrorEditorComponent,
};
