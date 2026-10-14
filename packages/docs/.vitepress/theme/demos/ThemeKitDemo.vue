<script setup lang="ts">
/**
 * ThemeKitDemo —— 组件文档页里的**活演示台**。
 *
 * 为什么直接 import 主题包的具名导出（而不是 useUiComponent 按名取）：
 * 文档页不在画布渲染子树里，没有 provide 的渲染上下文 —— useUiComponent 会抛。
 * 文档展示的就是"默认主题这一份实现长什么样"，直接引它是准确的。
 *（"按名取"的实证在组件展厅插件里，那里有真宿主。）
 *
 * 用法（MD 里）：<ThemeKitDemo name="button" />
 */
import { ref } from 'vue'
import {
  NodeToolbarButton,
  Dropdown,
  Tooltip,
  Select,
  PrecisionSlider,
  ColorField,
  ToolParamField,
  MediaViewer,
} from '@mini-canvas/plugin-theme-default'
import ToolParamGroup from '@mini-canvas/plugin-theme-default/components/ui/ToolParamGroup.vue'
// 三个参数预设件没有从包根导出 → 从组件子路径取（同一份实现）
import ToolOptionGrid from '@mini-canvas/plugin-theme-default/components/ui/ToolOptionGrid.vue'
import ToolRatioGrid from '@mini-canvas/plugin-theme-default/components/ui/ToolRatioGrid.vue'
import ToolParamSlider from '@mini-canvas/plugin-theme-default/components/ui/ToolParamSlider.vue'
import type { ToolParamDef } from '@mini-canvas/kernel'

withDefaults(
  defineProps<{
    /** 展示哪一个件 */
    name: string
    /** 演示区高度（px） */
    height?: number
  }>(),
  { height: 160 },
)

const starred = ref(false)
const menuOpen = ref(false)
const model = ref('fast')
const sliderValue = ref(48)
const color = ref('')
const duration = ref(8)
const viewerItem = ref<null | { name: string; kind: string; text?: string }>(null)
const paramValues = ref<Record<string, unknown>>({ quality: 'standard', ratio: '16:9', count: '2', duration: 8 })

const selectOptions = [
  { label: '快速', value: 'fast', description: '便宜，适合草稿', group: '常用' },
  { label: '精细', value: 'fine', description: '慢一些，质量更好', group: '常用' },
  { label: '实验', value: 'beta', group: '实验' },
]

const qualityParam: ToolParamDef = {
  key: 'quality', label: '画质', kind: 'quality', type: 'select', default: 'standard',
  options: [
    { label: '标准', value: 'standard' },
    { label: '高清', value: 'hd' },
    { label: '超清', value: 'uhd' },
  ],
}
const ratioParam: ToolParamDef = {
  key: 'ratio', label: '比例', kind: 'ratio', type: 'select', default: '16:9',
  options: [
    { label: '16:9', value: '16:9' },
    { label: '9:16', value: '9:16' },
    { label: '1:1', value: '1:1' },
    { label: '自适应', value: 'auto' },
  ],
}
const countParam: ToolParamDef = {
  key: 'count', label: '生成数量', kind: 'count', type: 'number', default: '2', min: 1, max: 4,
  options: [
    { label: '1张', value: '1' },
    { label: '2张', value: '2' },
    { label: '4张', value: '4' },
  ],
}
const durationParam: ToolParamDef = {
  key: 'duration', label: '时长', kind: 'duration', type: 'number', unit: '秒', min: 1, max: 20, step: 1, default: 8,
}
const groupParams = [ratioParam, qualityParam, countParam]

function setParam(key: string, value: string | number | boolean): void {
  paramValues.value = { ...paramValues.value, [key]: value }
}
</script>
<template>
  <div class="tk-demo" :style="{ minHeight: height + 'px' }">
    <!-- 按钮 -->
    <template v-if="name === 'button'">
      <component :is="NodeToolbarButton" title="主按钮" variant="primary">下载</component>
      <component :is="NodeToolbarButton" title="危险" variant="danger">删除</component>
      <component :is="NodeToolbarButton" title="默认（ghost）">复制</component>
      <component :is="NodeToolbarButton" title="开关态（点击切换）" icon="★" :active="starred" @click="starred = !starred" />
      <component :is="NodeToolbarButton" title="禁用" disabled>禁用</component>
    </template>

    <!-- 气泡 -->
    <template v-else-if="name === 'tooltip'">
      <component :is="Tooltip" content="悬停或键盘聚焦都会出现这条提示">
        <component :is="NodeToolbarButton" title="悬停我" icon="?" />
      </component>
      <component :is="Tooltip" placement="bottom" content="气泡可以在下方">
        <component :is="NodeToolbarButton" title="也看看下面">下方气泡</component>
      </component>
    </template>

    <!-- 下拉浮层 -->
    <template v-else-if="name === 'dropdown'">
      <component :is="Dropdown" v-model="menuOpen" :match-width="true">
        <template #trigger="{ open: isOpen, toggle }">
          <button class="tk-btn" type="button" @click="toggle">更多 {{ isOpen ? '▲' : '▼' }}</button>
        </template>
        <template #default="{ close }">
          <button class="tk-item" type="button" @click="close">重命名</button>
          <button class="tk-item" type="button" @click="close">复制</button>
          <button class="tk-item" type="button" @click="close">删除</button>
        </template>
      </component>
    </template>

    <!-- 选择器 -->
    <template v-else-if="name === 'select'">
      <component :is="Select" v-model="model" :options="selectOptions" searchable dropdown-width="match" />
      <span class="tk-val">当前值：{{ model }}</span>
    </template>

    <!-- 滑块 -->
    <template v-else-if="name === 'slider'">
      <div class="tk-col">
        <component :is="PrecisionSlider" v-model="sliderValue" :min="0" :max="100" :step="1" aria-label="数值" />
        <span class="tk-val">{{ sliderValue }}（拖动时按住 Ctrl 细调 / Shift 粗调）</span>
      </div>
    </template>

    <!-- 取色器 -->
    <template v-else-if="name === 'color'">
      <component :is="ColorField" v-model="color" clearable aria-label="描边颜色" />
      <span class="tk-val">值：{{ color || '（空 = 回落主题色）' }}</span>
    </template>

    <!-- 参数控件 -->
    <template v-else-if="name === 'toolParamField'">
      <div class="tk-col">
        <component
          :is="ToolParamField"
          v-for="p in [qualityParam]"
          :key="p.key"
          :param="p"
          :model-value="paramValues[p.key]"
          @update:model-value="(v: string | number | boolean) => setParam(p.key, v)"
        />
      </div>
    </template>

    <!-- 选项网格 -->
    <template v-else-if="name === 'toolParamGrid'">
      <component :is="ToolOptionGrid" :param="qualityParam" :model-value="paramValues.quality" @update:model-value="(v: string | number | boolean) => setParam('quality', v)" />
    </template>

    <!-- 比例网格 -->
    <template v-else-if="name === 'toolParamRatio'">
      <component :is="ToolRatioGrid" :param="ratioParam" :model-value="paramValues.ratio" @update:model-value="(v: string | number | boolean) => setParam('ratio', v)" />
    </template>

    <!-- 参数滑块 -->
    <template v-else-if="name === 'toolParamSlider'">
      <component :is="ToolParamSlider" :param="durationParam" :model-value="duration" @update:model-value="(v: string | number | boolean) => (duration = Number(v))" />
    </template>

    <!-- 参数组 -->
    <template v-else-if="name === 'toolParamGroup'">
      <component :is="ToolParamGroup" :params="groupParams" :values="paramValues" @change="setParam" />
    </template>

    <!-- 全屏预览 -->
    <template v-else-if="name === 'mediaViewer'">
      <button class="tk-btn" type="button" @click="viewerItem = { name: '示例文本', kind: 'text', text: '这是一段被全屏预览的文本。' }">
        点开全屏预览
      </button>
      <component :is="MediaViewer" :item="viewerItem" @close="viewerItem = null" />
    </template>

    <template v-else>
      <span class="tk-val">（未登记演示：{{ name }}）</span>
    </template>
  </div>
</template>

<style scoped>
.tk-demo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 18px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}
.tk-col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 260px;
}
.tk-btn {
  height: 30px;
  padding: 0 12px;
  border-radius: 9px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 12px;
  cursor: pointer;
}
.tk-item {
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
.tk-item:hover {
  background: var(--vp-c-bg-soft);
}
.tk-val {
  color: var(--vp-c-text-2);
  font-size: 12px;
}
</style>


