<script setup lang="ts">
// overlay 槽宿主会下发 class/data-slot-*；本组件是双根（按钮 + 面板），
// fragment 继承不了，显式关掉避免 Vue warn 刷屏（e2e 有控制台纯净断言）。
defineOptions({ inheritAttrs: false })
/**
 * ThemeGalleryOverlay —— 组件展厅（挂在 overlay 槽，画布之上的一层）。
 *
 * 它做的事：把默认主题注册的设计系统组件**按名字取出来真的渲染**（useUiComponent），
 * 挂在画布 UI 上随时可看 —— 点得动、拉得开、能输文字，和插件里用的是同一份实现。
 *
 * 为什么这么写（三点）：
 *   1. **按名取而不是 import**：展厅看到的正是"插件按名取到的那一份"，成品应用顶替过的
 *      dropdown 也一并体现出来 —— 展览的就是真实运行时的样子。
 *   2. **画布件另有区块**：节点壳 / 连线 / 背景 / 浮动端口要 VueFlow 的节点上下文，
 *      直接塞进浮层渲染不出来。那个区块里嵌一块**真的小画布**，它们就在真正的环境里跑。
 *   3. **默认收起**：只在左下角留一个小按钮，不打扰画布使用。
 */
import { computed, ref } from 'vue'
import { useUiComponent } from '@mini-canvas/canvas-render'
import type { ToolParamDef } from '@mini-canvas/kernel'
import GalleryCanvasStage from './GalleryCanvasStage.vue'

const open = ref(false)

// —— 设计系统件：全部按名取（这就是"全局可用"的实证）——
const NodeToolbarButton = useUiComponent('toolbarButton')
const Dropdown = useUiComponent('dropdown')
const Tooltip = useUiComponent('tooltip')
const Select = useUiComponent('select')
const PrecisionSlider = useUiComponent('slider')
const ColorField = useUiComponent('color')
const ToolParamField = useUiComponent('toolParamField')
const ToolParamGroup = useUiComponent('toolParamGroup')
const ToolOptionGrid = useUiComponent('toolParamGrid')
const ToolRatioGrid = useUiComponent('toolParamRatio')
const ToolParamSlider = useUiComponent('toolParamSlider')
const MediaViewer = useUiComponent('mediaViewer')
// 节点插件登记的预览件 —— 也是"插件往 ui 目录放东西"的实证
const TextPreview = useUiComponent('textPreview')

// —— 各组件的活状态（展厅里改得动，才看得出行为）——
const starred = ref(false)
const menuOpen = ref(false)
const model = ref('fast')
const selectOptions = [
  { label: '快速', value: 'fast', description: '便宜，适合草稿', group: '常用' },
  { label: '精细', value: 'fine', description: '慢一些，质量更好', group: '常用' },
  { label: '实验', value: 'beta', group: '实验' },
]
const sliderValue = ref(48)
const color = ref('')
const paramValues = ref<Record<string, unknown>>({ ratio: '16:9', quality: 'standard', count: 2 })
const ratioParam: ToolParamDef = {
  key: 'ratio', label: '比例', kind: 'ratio', type: 'select', default: '16:9',
  options: [
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '1:1', value: '1:1' },
    { label: '自适应', value: 'auto' },
  ],
}
const qualityParam: ToolParamDef = {
  key: 'quality', label: '画质', kind: 'quality', type: 'select', default: 'standard',
  options: [
    { label: '标准', value: 'standard' },
    { label: '高清', value: 'hd' },
    { label: '超清', value: 'uhd' },
  ],
}
const countParam: ToolParamDef = {
  key: 'count', label: '生成数量', kind: 'count', type: 'number', default: '2', min: 1, max: 4,
  // 注意：ToolParamOption.value 是 string（内核契约），数字参数的档位也用字符串声明
  options: [
    { label: '1张', value: '1' },
    { label: '2张', value: '2' },
    { label: '4张', value: '4' },
  ],
}
const durationParam: ToolParamDef = {
  key: 'duration', label: '时长', kind: 'duration', type: 'number', unit: '秒', min: 1, max: 20, step: 1, default: 8,
}
const viewerItem = ref<null | { name: string; kind: string; url?: string; text?: string }>(null)

/** 参数组用的那一串参数（摘要行会显示成「16:9 · 标准 · 2张」） */
const groupParams = [ratioParam, qualityParam, countParam]

function setParam(key: string, value: string | number | boolean): void {
  paramValues.value = { ...paramValues.value, [key]: value }
}

/** 展厅的默认尺寸（收起时不占地方） */
const panelStyle = computed(() => ({ display: open.value ? 'flex' : 'none' }))
</script>
<template>
  <!-- 收起态：左下角一个小按钮 -->
  <button v-if="!open" class="tg-fab" type="button" title="打开组件展厅" @click="open = true">
    组件展厅
  </button>

  <div v-else class="tg-panel" :style="panelStyle">
    <header class="tg-head">
      <strong>组件展厅 · 默认主题</strong>
      <span class="tg-sub">这些都是按名取的、在跑的真组件</span>
      <button class="tg-close" type="button" title="关闭展厅" @click="open = false">✕</button>
    </header>

    <div class="tg-body">
      <!-- ① 按钮 -->
      <section class="tg-sec">
        <h4>按钮 button / NodeToolbarButton</h4>
        <div class="tg-row">
          <component :is="NodeToolbarButton" title="下载" variant="primary">下载</component>
          <component :is="NodeToolbarButton" title="删除" variant="danger">删除</component>
          <component
            :is="NodeToolbarButton"
            title="收藏（开关态）"
            icon="★"
            :active="starred"
            @click="starred = !starred"
          />
        </div>
      </section>

      <!-- ② 气泡 -->
      <section class="tg-sec">
        <h4>气泡 tooltip / Tooltip</h4>
        <div class="tg-row">
          <component :is="Tooltip" content="悬停或键盘聚焦都会出现">
            <component :is="NodeToolbarButton" title="悬停我" icon="?" />
          </component>
        </div>
      </section>

      <!-- ③ 下拉浮层 + 选择器 -->
      <section class="tg-sec">
        <h4>下拉 dropdown / Dropdown</h4>
        <div class="tg-row">
          <component :is="Dropdown" v-model="menuOpen" :match-width="true">
            <template #trigger="{ open: isOpen, toggle }">
              <button class="tg-btn" type="button" @click="toggle">更多 {{ isOpen ? '▲' : '▼' }}</button>
            </template>
            <template #default="{ close }">
              <button class="tg-item" type="button" @click="close">重命名</button>
              <button class="tg-item" type="button" @click="close">复制</button>
              <button class="tg-item" type="button" @click="close">删除</button>
            </template>
          </component>
        </div>
      </section>

      <section class="tg-sec">
        <h4>下拉选择器 select / Select</h4>
        <div class="tg-row">
          <component :is="Select" v-model="model" :options="selectOptions" searchable dropdown-width="match" />
          <span class="tg-val">当前值：{{ model }}</span>
        </div>
      </section>

      <!-- ④ 滑块 + 取色器 -->
      <section class="tg-sec">
        <h4>精细滑块 slider / PrecisionSlider</h4>
        <div class="tg-slider">
          <component :is="PrecisionSlider" v-model="sliderValue" :min="0" :max="100" :step="1" aria-label="数值" />
          <span class="tg-val">{{ sliderValue }}（按住 Ctrl 细调 / Shift 粗调）</span>
        </div>
      </section>

      <section class="tg-sec">
        <h4>取色器 color / ColorField</h4>
        <div class="tg-row">
          <component :is="ColorField" v-model="color" clearable aria-label="描边颜色" />
          <span class="tg-val">值：{{ color || '（空 = 回落主题色）' }}</span>
        </div>
      </section>

      <!-- ⑤ 参数族 -->
      <section class="tg-sec">
        <h4>参数控件 toolParamField / ToolParamField</h4>
        <div class="tg-params">
          <component
            :is="ToolParamField"
            v-for="p in [qualityParam]"
            :key="p.key"
            :param="p"
            :model-value="paramValues[p.key]"
            @update:model-value="(v: string | number | boolean) => setParam(p.key, v)"
          />
        </div>
      </section>

      <section class="tg-sec">
        <h4>参数预设：选项网格 / 比例网格 / 参数滑块</h4>
        <div class="tg-params">
          <component :is="ToolOptionGrid" :param="qualityParam" :model-value="paramValues.quality" @update:model-value="(v: string | number | boolean) => setParam('quality', v)" />
          <component :is="ToolRatioGrid" :param="ratioParam" :model-value="paramValues.ratio" @update:model-value="(v: string | number | boolean) => setParam('ratio', v)" />
          <component :is="ToolParamSlider" :param="durationParam" :model-value="paramValues.duration" @update:model-value="(v: string | number | boolean) => setParam('duration', v)" />
        </div>
      </section>

      <section class="tg-sec">
        <h4>参数组 toolParamGroup / ToolParamGroup（多参数收敛成一个下拉）</h4>
        <div class="tg-row">
          <component :is="ToolParamGroup" :params="groupParams" :values="paramValues" @change="setParam" />
        </div>
      </section>

      <!-- 6.5 节点插件登记件：textPreview（来自 plugin-node-text） -->
      <section class="tg-sec">
        <h4>节点插件登记件 textPreview（来自 plugin-node-text）</h4>
        <div class="tg-row tg-textpreview">
          <component :is="TextPreview" text="这是 plugin-node-text 登记进 ui 目录的文本预览件。生成历史卡片、全屏预览用的都是它。" name="note.txt" />
        </div>
      </section>

      <!-- 7 全屏媒体预览 -->
      <section class="tg-sec">
        <h4>全屏预览 mediaViewer / MediaViewer</h4>
        <div class="tg-row">
          <button class="tg-btn" type="button" @click="viewerItem = { name: '示例文本', kind: 'text', text: '这是一段被全屏预览的文本。' }">
            打开文本预览
          </button>
        </div>
        <component :is="MediaViewer" :item="viewerItem" @close="viewerItem = null" />
      </section>

      <!-- 8 画布件：嵌一块真画布 -->
      <section class="tg-sec">
        <h4>画布件：节点壳 / 连线 / 背景 / 浮动端口（下面是真画布）</h4>
        <GalleryCanvasStage :height="300" />
      </section>
    </div>
  </div>
</template>
<style scoped>
.tg-fab {
  position: absolute;
  left: 16px;
  bottom: 16px;
  height: 32px;
  padding: 0 14px;
  border-radius: 10px;
  border: 1px solid rgba(0, 0, 0, 0.08); /* 主题色白名单: 展厅浮层外框（展示容器） */
  background: var(--ui-panel, #fff);
  color: var(--ui-ink, #18202b);
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12); /* 主题色白名单: 悬浮按钮投影（无对应 token 的中性投影） */
}
.tg-panel {
  position: absolute;
  left: 16px;
  top: 16px;
  bottom: 16px;
  width: 460px;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.08); /* 主题色白名单: 展厅面板外框（展示容器） */
  background: var(--ui-panel, #fff);
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.18); /* 主题色白名单: 展厅面板投影（无对应 token 的中性投影） */
  overflow: hidden;
}
.tg-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06); /* 主题色白名单: 展厅头部底边（中性发丝线） */
}
.tg-sub {
  flex: 1 1 auto;
  color: var(--ui-ink-mute, #6b7280);
  font-size: 12px;
}
.tg-close {
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}
.tg-close:hover {
  background: rgba(0, 0, 0, 0.06); /* 主题色白名单: 关闭按钮 hover 底（中性灰阶） */
}
.tg-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.tg-sec h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--ui-ink-mute, #6b7280);
}
.tg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.tg-params {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tg-slider {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tg-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid rgba(0, 0, 0, 0.08); /* 主题色白名单: 展厅内联按钮外框（示例外观） */
  background: #fff; /* 主题色白名单: 展厅内联按钮底（示例外观） */
  color: var(--ui-ink, #18202b);
  font-size: 12px;
  cursor: pointer;
}
.tg-item {
  display: block;
  width: 100%;
  height: 32px;
  padding: 0 12px;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  cursor: pointer;
}
.tg-item:hover {
  background: rgba(0, 0, 0, 0.05); /* 主题色白名单: 展厅菜单项 hover 底（中性灰阶） */
}
.tg-val {
  color: var(--ui-ink-mute, #6b7280);
  font-size: 12px;
}
</style>


