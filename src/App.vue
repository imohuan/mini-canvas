<script setup lang="ts">
import { ref, computed, markRaw } from 'vue'
import Canvas from './canvas/core/Canvas.vue'
import { TextNodePlugin } from './canvas/core/nodes/text/TextNodePlugin'
import { ImageNodePlugin } from './canvas/core/nodes/image/ImageNodePlugin'
import { VideoNodePlugin } from './canvas/core/nodes/Video/VideoNodePlugin'
import { StageNodePlugin } from './canvas/core/nodes/stage/StageNodePlugin'
import { AlignGuidePlugin } from './canvas/core/plugins/align-guide/index'
import { AutoSavePlugin } from './canvas/core/plugins/auto-save/index'
import { ClipboardPlugin } from './canvas/core/plugins/clipboard/index'
import { HistoryPlugin } from './canvas/core/plugins/history/index'
import { MultiSelectPlugin } from './canvas/core/plugins/multi-select/index'
import { StoragePlugin } from './canvas/core/plugins/storage/index'
import { ShortcutManagerPlugin } from './canvas/core/plugins/shortcut-manager/index'
import { GroupPlugin } from './canvas/core/plugins/group/index'
import { FileDropPlugin } from './canvas/core/plugins/file-drop/index'
import { ThemePlugin } from './canvas/core/plugins/theme/index'
import { AutoLayoutPlugin } from './canvas/core/plugins/auto-layout/index'
import type { CanvasPlugin } from './canvas/core/plugins/types'

interface PluginSlot {
  plugin: CanvasPlugin
  enabled: boolean
  label: string
  description: string
  usage: string
}

const pluginSlots = ref<PluginSlot[]>([
  {
    plugin: markRaw(TextNodePlugin) as CanvasPlugin,
    enabled: true,
    label: '文本节点',
    description: '注册文本节点到 NodeRegistry',
    usage: '内置节点类型，自动注册',
  },
  {
    plugin: markRaw(ImageNodePlugin) as CanvasPlugin,
    enabled: true,
    label: '图片节点',
    description: '注册图片节点到 NodeRegistry',
    usage: '内置节点类型，自动注册',
  },
  {
    plugin: markRaw(VideoNodePlugin) as CanvasPlugin,
    enabled: true,
    label: '视频节点',
    description: '注册视频节点到 NodeRegistry',
    usage: '内置节点类型，自动注册',
  },
  {
    plugin: markRaw(StageNodePlugin) as CanvasPlugin,
    enabled: true,
    label: '导演台节点',
    description: '注册导演台节点到 NodeRegistry',
    usage: '内置节点类型，自动注册',
  },
  {
    plugin: markRaw(AlignGuidePlugin) as CanvasPlugin,
    enabled: true,
    label: '对齐辅助线',
    description: '拖拽节点时显示对齐参考线，8px 阈值自动吸附',
    usage: '拖拽节点到其他节点附近，自动出现蓝色辅助线并吸附对齐',
  },
  {
    plugin: markRaw(AutoSavePlugin) as CanvasPlugin,
    enabled: true,
    label: '自动保存',
    description: '1秒防抖自动保存到 localStorage，页面关闭前强制保存',
    usage: '自动运行。监听方式：\n1. window.addEventListener("auto-save:saved", (e) => { ... })\n2. 通过 manager.getPluginAPI("auto-save"), on("auto-save:saved", cb)',
  },
  {
    plugin: markRaw(ClipboardPlugin) as CanvasPlugin,
    enabled: true,
    label: '复制粘贴',
    description: 'Ctrl+C 复制 / Ctrl+V 鼠标位置粘贴 / Ctrl+X 剪切',
    usage: '框选节点 → Ctrl+C → 鼠标移动到目标位置 → Ctrl+V',
  },
  {
    plugin: markRaw(HistoryPlugin) as CanvasPlugin,
    enabled: true,
    label: '撤销重做',
    description: 'Ctrl+Z 撤销 / Ctrl+Y 或 Ctrl+Shift+Z 重做，自动记录拖拽/连线/删除',
    usage: 'Ctrl+Z 撤销上一步操作，Ctrl+Y 重做。拖拽节点自动成组记录。',
  },
  {
    plugin: markRaw(MultiSelectPlugin) as CanvasPlugin,
    enabled: true,
    label: '多选框选',
    description: '在画布空白处拖拽框选，Shift+点击追加/移除，选中节点蓝色边框',
    usage: '在空白区域按住鼠标拖拽框选 → Ctrl+C 复制 → Ctrl+V 粘贴',
  },
  {
    plugin: markRaw(StoragePlugin) as CanvasPlugin,
    enabled: true,
    label: '存储底座',
    description: 'localStorage 兜底 + File System Access API。自动创建默认项目',
    usage: '已自动连接 localStorage。\n如需文件系统存储：\n  storageApi.connect() → 选择文件夹\n  storageApi.createProject("新项目")\n  storageApi.saveCanvas(nodes, edges)',
  },
  {
    plugin: markRaw(ShortcutManagerPlugin) as CanvasPlugin,
    enabled: true,
    label: '快捷键管理',
    description: 'Ctrl+/ 查看所有快捷键，支持搜索、重映射、导入/导出快捷键配置',
    usage: 'Ctrl+/ 打开快捷键帮助面板 → 搜索或点击"重映射" → 按下新组合键 → 确认',
  },
  {
    plugin: markRaw(GroupPlugin) as CanvasPlugin,
    enabled: true,
    label: '节点分组',
    description: 'Ctrl+G 将选中节点打组，Ctrl+Shift+G 解组，拖入分组自动加入',
    usage: '选中多个节点 → Ctrl+G 打组 → 拖拽分组容器移动全部节点 → 拖出分组自动脱离',
  },
  {
    plugin: markRaw(FileDropPlugin) as CanvasPlugin,
    enabled: true,
    label: '文件拖入',
    description: '拖拽图片/视频/TXT/MD 文件到画布创建节点，Ctrl+V 粘贴图片/视频/文本',
    usage: '拖文件到画布 → 自动创建节点 | Ctrl+V 粘贴剪贴板中的图片/视频/文本',
  },
  {
    plugin: markRaw(ThemePlugin) as CanvasPlugin,
    enabled: true,
    label: '主题配色',
    description: '切换节点主题色系：灰蓝 / 科技蓝 / 翠绿 / 暖棕，支持自定义配色',
    usage: '在右侧面板「主题」区域切换预设，或自定义 accent 色自动计算全量 CSS 变量',
  },
  {
    plugin: markRaw(AutoLayoutPlugin) as CanvasPlugin,
    enabled: true,
    label: '智能自动布局',
    description: '嵌套分簇布局：组内排列 → 连通分量排列 → 全局块级排列 + Group bounds 自动重算',
    usage: 'Pannel 控件触发自动布局 | F 键聚焦选中节点 | Ctrl+L 自动布局',
  },
])
const activePlugins = computed(() => pluginSlots.value.filter(s => s.enabled).map(s => s.plugin))

</script>

<template>
  <div class="app-container">
    <Canvas :plugins="activePlugins" />
  </div>
</template>

<style scoped>
.app-container {
  width: 100vw;
  height: 100vh;
  position: relative;
}
</style>