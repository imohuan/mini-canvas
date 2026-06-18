<script setup lang="ts">
import { ConnectionMode } from '@vue-flow/core'
import type { EdgeType } from '../../composables/useCanvasStore' // eslint-disable-line
import type { ToggleDef, PluginDef } from '../../Pannel.vue'

defineProps<{
  toggles: ToggleDef[]
  connectionMode: ConnectionMode
  edgeLineWidth: number
  edgeColor: string
  edgeType: EdgeType
  edgeDashed: boolean
  edgeAnimated: boolean
  minZoom: number
  maxZoom: number
  topToolbarOffset: number
  bottomToolbarOffset: number
  handleDebug: boolean
  handleRadius: number
  handleRestOffset: number
  handleCursorGap: number
  handleButtonSize: number
  handleOverlap: number
  connectionSnapDebugVisible: boolean
  connectionSnapOuterRatio: number
  connectionSnapInnerRatio: number
  connectionSnapHeightRatio: number
  selectionFramePaddingX: number
  selectionFramePaddingTop: number
  selectionFramePaddingBottom: number
  plugins?: PluginDef[]
}>()

const emit = defineEmits<{
  (e: 'toggleMode'): void
  (e: 'zoomIn'): void
  (e: 'zoomOut'): void
  (e: 'fitView'): void
  (e: 'update:edgeLineWidth', v: number): void
  (e: 'update:edgeColor', v: string): void
  (e: 'update:edgeType', v: string): void
  (e: 'toggleEdgeDashed'): void
  (e: 'toggleEdgeAnimated'): void
  (e: 'update:minZoom', v: number): void
  (e: 'update:maxZoom', v: number): void
  (e: 'update:topToolbarOffset', v: number): void
  (e: 'update:bottomToolbarOffset', v: number): void
  (e: 'update:handleDebug', v: boolean): void
  (e: 'update:handleRadius', v: number): void
  (e: 'update:handleRestOffset', v: number): void
  (e: 'update:handleCursorGap', v: number): void
  (e: 'update:handleButtonSize', v: number): void
  (e: 'update:handleOverlap', v: number): void
  (e: 'update:connectionSnapDebugVisible', v: boolean): void
  (e: 'update:connectionSnapOuterRatio', v: number): void
  (e: 'update:connectionSnapInnerRatio', v: number): void
  (e: 'update:connectionSnapHeightRatio', v: number): void
  (e: 'update:selectionFramePaddingX', v: number): void
  (e: 'update:selectionFramePaddingTop', v: number): void
  (e: 'update:selectionFramePaddingBottom', v: number): void
}>()

const btnBase = 'px-2 py-1 rounded text-[11px] font-semibold transition-colors border border-transparent cursor-pointer whitespace-normal break-keep text-center leading-tight'
const btnActive = 'bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30'
const btnInactive = 'bg-[#2d2b30] text-[#9c9aa3] hover:bg-[#3a3740] hover:text-[#f0f0f2]'
const sectionTitle = 'text-[11px] font-bold text-[#78767b] uppercase tracking-wider mt-3 mb-2'
const rowItem = 'flex items-center gap-2 text-[11px] text-[#b2b0b9]'
</script>

<template>
  <!-- 连线模式 -->
  <div :class="sectionTitle">连线模式</div>
  <div class="flex flex-wrap gap-1 max-w-full">
    <button :class="[btnBase, connectionMode === ConnectionMode.Strict ? btnActive : btnInactive]" @click="emit('toggleMode')">
      {{ connectionMode === ConnectionMode.Strict ? '严格' : '宽松' }}
    </button>
  </div>

  <!-- 功能开关 -->
  <div :class="sectionTitle">功能开关</div>
  <div class="flex flex-wrap gap-1 max-w-full">
    <button v-for="tg in toggles" :key="tg.key"
      :class="[btnBase, tg.get() ? btnActive : btnInactive]"
      :title="tg.tip"
      @click="tg.set(!tg.get())">
      {{ tg.label }}
    </button>
  </div>

  <!-- 连线样式 -->
  <div :class="sectionTitle">连线样式</div>
  <div :class="rowItem">
    <span>线宽</span>
    <input type="range" min="1" max="6" :value="edgeLineWidth"
      class="w-20 h-1 accent-[#3b82f6]"
      @input="emit('update:edgeLineWidth', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ edgeLineWidth }}px</span>
  </div>
  <div :class="rowItem">
    <span>颜色</span>
    <input type="color" :value="edgeColor"
      class="w-6 h-5 rounded cursor-pointer border-0 p-0"
      @input="emit('update:edgeColor', ($event.target as HTMLInputElement).value)" />
    <span class="text-[10px] text-[#78767b] font-mono">{{ edgeColor }}</span>
  </div>
  <div class="flex flex-wrap gap-1 mt-1 max-w-full">
    <button :class="[btnBase, (edgeType as string) === 'custom' ? btnActive : btnInactive]" @click="emit('update:edgeType', 'custom')">平滑</button>
    <button :class="[btnBase, (edgeType as string) === 'straight' ? btnActive : btnInactive]" @click="emit('update:edgeType', 'straight')">直线</button>
    <button :class="[btnBase, (edgeType as string) === 'step' ? btnActive : btnInactive]" @click="emit('update:edgeType', 'step')">阶梯</button>
  </div>
  <div class="flex flex-wrap gap-1 mt-1 max-w-full">
    <button :class="[btnBase, edgeDashed ? btnActive : btnInactive]" @click="emit('toggleEdgeDashed')">虚线</button>
    <button :class="[btnBase, edgeAnimated ? btnActive : btnInactive]" @click="emit('toggleEdgeAnimated')">动画</button>
  </div>

  <!-- 视口 -->
  <div :class="sectionTitle">视口</div>
  <div class="flex flex-wrap gap-1 mb-2 max-w-full">
    <button :class="[btnBase, btnInactive]" @click="emit('zoomIn')">放大</button>
    <button :class="[btnBase, btnInactive]" @click="emit('zoomOut')">缩小</button>
    <button :class="[btnBase, btnInactive]" @click="emit('fitView')">适应</button>
  </div>
  <div :class="rowItem">
    <span>最小缩放</span>
    <input type="range" min="0.1" max="1" step="0.05" :value="minZoom"
      class="w-20 h-1 accent-[#3b82f6]"
      @input="emit('update:minZoom', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ minZoom }}</span>
  </div>
  <div :class="rowItem">
    <span>最大缩放</span>
    <input type="range" min="1" max="6" step="0.5" :value="maxZoom"
      class="w-20 h-1 accent-[#3b82f6]"
      @input="emit('update:maxZoom', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ maxZoom }}</span>
  </div>

  <!-- 工具栏偏移 -->
  <div :class="sectionTitle">工具栏偏移</div>
  <div :class="rowItem">
    <span>顶部</span>
    <input type="range" min="0" max="60" :value="topToolbarOffset"
      class="w-20 h-1 accent-[#3b82f6]"
      @input="emit('update:topToolbarOffset', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ topToolbarOffset }}px</span>
  </div>
  <div :class="rowItem">
    <span>底部</span>
    <input type="range" min="0" max="60" :value="bottomToolbarOffset"
      class="w-20 h-1 accent-[#3b82f6]"
      @input="emit('update:bottomToolbarOffset', Number(($event.target as HTMLInputElement).value))" />
    <span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ bottomToolbarOffset }}px</span>
  </div>

  <!-- Handle 参数 -->
  <div :class="sectionTitle">Handle 参数</div>
  <div :class="rowItem">
    <span>调试</span>
    <button :class="[btnBase, handleDebug ? btnActive : btnInactive]" @click="emit('update:handleDebug', !handleDebug)">{{ handleDebug ? '开' : '关' }}</button>
  </div>
  <div :class="rowItem"><span>半径</span><input type="range" min="40" max="120" :value="handleRadius" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:handleRadius', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ handleRadius }}</span></div>
  <div :class="rowItem"><span>静止偏移</span><input type="range" min="10" max="60" :value="handleRestOffset" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:handleRestOffset', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ handleRestOffset }}</span></div>
  <div :class="rowItem"><span>光标间隙</span><input type="range" min="10" max="60" :value="handleCursorGap" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:handleCursorGap', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ handleCursorGap }}</span></div>
  <div :class="rowItem"><span>按钮大小</span><input type="range" min="16" max="48" :value="handleButtonSize" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:handleButtonSize', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ handleButtonSize }}</span></div>
  <div :class="rowItem"><span>重叠</span><input type="range" min="0" max="40" :value="handleOverlap" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:handleOverlap', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ handleOverlap }}</span></div>

  <!-- 连接吸附 -->
  <div :class="sectionTitle">连接吸附</div>
  <div :class="rowItem"><span>调试</span><button :class="[btnBase, connectionSnapDebugVisible ? btnActive : btnInactive]" @click="emit('update:connectionSnapDebugVisible', !connectionSnapDebugVisible)">{{ connectionSnapDebugVisible ? '开' : '关' }}</button></div>
  <div :class="rowItem"><span>外比例</span><input type="range" min="0.1" max="1.5" step="0.05" :value="connectionSnapOuterRatio" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:connectionSnapOuterRatio', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ connectionSnapOuterRatio }}</span></div>
  <div :class="rowItem"><span>内比例</span><input type="range" min="0.1" max="1" step="0.05" :value="connectionSnapInnerRatio" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:connectionSnapInnerRatio', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ connectionSnapInnerRatio }}</span></div>
  <div :class="rowItem"><span>高比例</span><input type="range" min="0.5" max="2" step="0.05" :value="connectionSnapHeightRatio" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:connectionSnapHeightRatio', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ connectionSnapHeightRatio }}</span></div>

  <!-- 框选 -->
  <div :class="sectionTitle">框选</div>
  <div :class="rowItem"><span>内边距X</span><input type="range" min="0" max="60" :value="selectionFramePaddingX" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:selectionFramePaddingX', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ selectionFramePaddingX }}</span></div>
  <div :class="rowItem"><span>内边距顶</span><input type="range" min="0" max="60" :value="selectionFramePaddingTop" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:selectionFramePaddingTop', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ selectionFramePaddingTop }}</span></div>
  <div :class="rowItem"><span>内边距底</span><input type="range" min="0" max="60" :value="selectionFramePaddingBottom" class="w-20 h-1 accent-[#3b82f6]" @input="emit('update:selectionFramePaddingBottom', Number(($event.target as HTMLInputElement).value))" /><span class="text-[11px] text-[#78767b] w-8 text-right font-mono">{{ selectionFramePaddingBottom }}</span></div>
</template>