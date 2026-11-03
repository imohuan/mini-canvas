<script setup lang="ts">
/**
 * ThemeLabView —— ThemeLab 的模板、scoped 样式与模块装配。
 *
 * 主题库、设置读写、插件开关、场景、指示线、画布生命周期与展示辅助在 theme-lab-panel/ 下。
 * 编辑始终写真实 settings（同一份 store 也驱动画布），而不是另造一套覆盖值。
 */
import { inject } from 'vue'
import {
  CANVAS_CONTEXT_KEY,
  CanvasHost,
  CanvasProvider,
  type CanvasContext,
} from '@mini-canvas/canvas-render'
import {
  ColorField,
  NodeEmptyState,
  DEFAULT_THEME_DEBUG,
  DEFAULT_THEME_EDGE,
  DEFAULT_THEME_HANDLE,
} from '@mini-canvas/plugin-theme-default'
import { PLUGIN_LABELS, OPTIONAL_PLUGINS, SCENE_META } from '../catalog'
import type { ThemeLabMode } from '../catalog'
import type { ThemeLabProps } from './state'
import { useThemeLab } from './app'

const props = withDefaults(defineProps<ThemeLabProps>(), { height: 660, embedded: false, settingsSource: undefined })

/**
 * 独立预览页没有外层 CanvasProvider；装进设置页时外面已经有一个。
 * 嵌入模式下：颜色读写走**主应用**的 settings，预览画布只负责显示效果。
 */
const hostCanvas = inject<CanvasContext | null>(CANVAS_CONTEXT_KEY, null)
const app = useThemeLab(props, hostCanvas)
const { state, settings: settingsApi, library, scenes, guide, display, canvas } = app
const {
  activeId,
  MODES,
  activePlugins,
  activeScene,
  activeTheme,
  available,
  boardEl,
  bootError,
  Button,
  editing,
  editingEntry,
  enabledPlugins,
  entries,
  groups,
  hovered,
  lines,
  mode,
  providerKey,
  ready,
  scene,
  sceneAvailable,
  themes,
  toast,
} = state
const { keyFor, readFields, setValue, clearValue } = settingsApi
const valueOf = settingsApi.valueOf
const { selectTheme, duplicateTheme, removeTheme, setMode, syncMode, exportTheme } = library
const { togglePlugin, selectScene, resetAllNodes, burstRedraw, fitPreview, fitOnStageResize, seekSceneSelection } = scenes
const { registerChip } = guide
const { chipStyle, chipStatus, sceneHint } = display
const { onReady, onBootError } = canvas
const { newAdapter } = state

const pageMode = display.pageMode
</script>

<template>
  <div class="lab-root" :class="{ 'is-light': mode === 'light', 'is-embedded': props.embedded }" :data-mode="mode">
    <!--
      嵌入设置页：不再启动第二块内核。临时内核会把「外观」色板和亮暗模式再写一次到
      <html>，与主应用互相覆盖；这里改用真实主题组件拼一张实时样张，颜色仍全部来自
      主应用 settings，改色时立刻反映在这张卡上。
    -->
    <template v-if="props.embedded">
      <section class="lab-embed-preview" aria-label="主题实时预览">
        <div class="lab-embed-preview-head">
          <div>
            <p class="lab-eyebrow">实时预览</p>
            <h2>颜色就在真实组件上</h2>
          </div>
          <div class="lab-mode" role="group" aria-label="亮色或暗色">
            <button v-for="item in MODES" :key="item" type="button" :class="{ active: mode === item }" @click="setMode(item)">
              {{ item === 'light' ? '亮色' : '暗色' }}
            </button>
          </div>
        </div>

        <div class="lab-embed-stage" :class="{ 'is-dark': mode === 'dark' }">
          <div class="lab-embed-node">
            <div class="lab-embed-node-head">
              <span class="lab-embed-node-dot" aria-hidden="true"></span>
              <span>灵感卡片</span>
              <span class="lab-embed-node-size">300 × 170</span>
            </div>
            <p class="lab-embed-node-body">节点边框、标题、控制栏和端口都跟着主题颜色一起变。</p>
            <div class="lab-embed-node-bar">
              <Button class="mck-toolbar-btn mck-toolbar-btn--primary" variant="default" size="sm" type="button" title="确认" aria-label="确认" data-lab="accent-action">确认</Button>
              <Button class="mck-toolbar-btn" variant="ghost" size="sm" type="button" title="更多操作" aria-label="更多操作">更多</Button>
              <Button class="mck-toolbar-btn mck-toolbar-btn--danger" variant="destructive" size="sm" type="button" title="删除" aria-label="删除">删除</Button>
            </div>
            <span class="lab-embed-port lab-embed-port--left" aria-hidden="true"></span>
            <span class="lab-embed-port lab-embed-port--right" aria-hidden="true"></span>
          </div>

          <div class="lab-embed-states">
            <div class="lab-embed-state" data-lab="warn-state">
              <NodeEmptyState tone="warning" text="待确认" description="检查后才会继续" />
            </div>
            <div class="lab-embed-state" data-lab="danger-state">
              <NodeEmptyState tone="danger" text="素材已失效" description="请重新上传" />
            </div>
          </div>

          <div class="lab-embed-flow" aria-hidden="true">
            <span class="lab-embed-flow-rail"></span>
            <span class="lab-embed-flow-dot"></span>
          </div>
        </div>

        <p class="lab-embed-note">颜色格来自已声明这些颜色的插件：装了就出现，没装就不会假装存在。</p>
      </section>

      <section v-if="editingEntry" class="lab-embed-editor" aria-live="polite">
        <div class="lab-embed-editor-head">
          <span class="lab-embed-editor-swatch" :style="{ '--chip': valueOf(editingEntry) }"></span>
          <div class="lab-embed-editor-title">
            <h3>{{ editingEntry.label }}</h3>
            <p>{{ editingEntry.description }}</p>
          </div>
          <button class="lab-icon-btn" type="button" aria-label="关闭编辑" @click="editing = null">×</button>
        </div>
        <div class="lab-embed-editor-row">
          <span class="lab-embed-key">{{ keyFor(editingEntry) }}</span>
          <span class="lab-embed-plugin">{{ editingEntry.pluginLabel }}</span>
        </div>
        <ColorField
          :model-value="valueOf(editingEntry)"
          :clearable="editingEntry.optional"
          :aria-label="'选择' + editingEntry.label"
          @update:model-value="setValue(editingEntry, $event)"
        />
        <div class="lab-embed-editor-foot">
          <button v-if="editingEntry.optional" type="button" class="lab-link" @click="clearValue(editingEntry)">清空，跟随主题</button>
          <span>{{ editingEntry.optional ? '清空后会跟随主题强调色' : '这个颜色必须有一个值' }}</span>
        </div>
        <p class="lab-embed-editor-chain">
          {{ editingEntry.chain.join(' → ') }}
        </p>
      </section>

      <section class="lab-embed-groups" aria-label="可编辑的颜色">
        <div v-if="!entries.length" class="lab-embed-empty">
          当前没有可编辑的主题颜色。安装默认主题后，这里会出现配色格。
        </div>
        <div v-for="group in groups" :key="group.group" class="lab-embed-group">
          <div class="lab-embed-group-head">
            <h3>{{ group.group }}</h3>
            <span>{{ group.items.length }} 项</span>
          </div>
          <div class="lab-embed-grid">
            <button
              v-for="entry in group.items"
              :key="entry.id"
              :data-chip-id="entry.id"
              type="button"
              class="lab-embed-chip"
              :class="{ active: editing === entry.id, unbound: !entry.bound }"
              :style="chipStyle(entry)"
              @click="editing = entry.id"
            >
              <span class="lab-embed-chip-swatch" aria-hidden="true"></span>
              <span class="lab-embed-chip-copy">
                <strong>{{ entry.label }}</strong>
                <small>{{ valueOf(entry) || '跟随主题' }}</small>
              </span>
              <span class="lab-embed-chip-plugin">{{ entry.pluginLabel }}</span>
            </button>
          </div>
        </div>
      </section>

      <div class="lab-toast" :class="{ show: toast }">{{ toast }}</div>
    </template>

    <template v-else>
    <header class="lab-head">
      <div class="lab-head-copy">
        <p class="lab-eyebrow">外观 / 主题工作台</p>
        <h1>颜色长在真实组件上</h1>
        <p class="lab-lede">
          改一处颜色，画布、连线、选框和刀光一起变。颜色项来自插件已声明的配置：
          <span class="lab-inline-strong">装了就出现，没装就没有</span>。
        </p>
      </div>
      <div class="lab-head-actions">
        <div class="lab-mode" role="group" aria-label="亮色或暗色">
          <button v-for="item in MODES" :key="item" type="button" :class="{ active: mode === item }" @click="setMode(item)">
            {{ item === 'light' ? '亮色' : '暗色' }}
          </button>
        </div>
        <button v-if="!props.embedded" class="lab-btn" type="button" @click="duplicateTheme">复制当前</button>
        <button v-if="!props.embedded" class="lab-btn" type="button" @click="exportTheme">导出 JSON</button>
      </div>
    </header>

    <div class="lab-toolbar">
      <div v-if="!props.embedded" class="lab-themes" role="list" aria-label="主题">
        <div v-for="theme in themes" :key="theme.id" class="lab-theme" :class="{ active: theme.id === activeId }" role="listitem">
          <button type="button" class="lab-theme-main" @click="selectTheme(theme.id)">
            <span class="lab-theme-dots" aria-hidden="true">
              <i :style="{ background: theme.overrides['accentColorDark'] || '#22d3ee' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['edgeFlowColorDark'] || '#22d3ee' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['dangerColorDark'] || '#f87171' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
              <i :style="{ background: theme.overrides['warnColorDark'] || '#fbbf24' }"></i> <!-- 主题色白名单: 独立预览页主题色点兜底 -->
            </span>
            <span class="lab-theme-name">{{ theme.name }}</span>
            <span class="lab-theme-meta">{{ Object.keys(theme.overrides).length }} 项</span>
          </button>
          <button v-if="theme.id === activeId && themes.length > 1" class="lab-theme-del" type="button" aria-label="删除当前主题" @click="removeTheme(theme.id)">×</button>
        </div>
      </div>

      <div class="lab-plugins" aria-label="预览里装哪些插件">
        <span class="lab-plugins-label">预览插件</span>
        <span class="lab-plugin on locked" title="默认主题是画布前提，始终启用">
          <span class="lab-plugin-dot"></span>默认主题
        </span>
        <button
          v-for="name in OPTIONAL_PLUGINS"
          :key="name"
          type="button"
          class="lab-plugin"
          :class="{ on: enabledPlugins.includes(name) }"
          @click="togglePlugin(name)"
        >
          <span class="lab-plugin-dot"></span>{{ PLUGIN_LABELS[name] }}
        </button>
      </div>
    </div>

    <nav class="lab-scenes" aria-label="预览场景">
      <button
        v-for="item in SCENE_META"
        :key="item.id"
        type="button"
        class="lab-scene"
        :class="{ active: scene === item.id, blocked: item.plugin ? !enabledPlugins.includes(item.plugin) : false }"
        @click="selectScene(item.id)"
      >
        <span class="lab-scene-label">{{ item.label }}</span>
        <span v-if="item.plugin" class="lab-scene-plugin">{{ PLUGIN_LABELS[item.plugin] }}</span>
      </button>
    </nav>
    <p class="lab-scene-hint">{{ sceneHint(scene) }}</p>

    <div ref="boardEl" class="lab-board">
      <aside class="lab-rail lab-rail--left" aria-label="品牌与语义颜色">
        <template v-for="group in groups.filter((item) => item.group === '品牌' || item.group === '连线' || item.group === '其它')" :key="group.group">
          <p class="lab-rail-title">{{ group.group }}</p>
          <button
            v-for="entry in group.items"
            :key="entry.id"
            :ref="(el) => registerChip(entry.id, el as Element | null)"
            :data-chip-id="entry.id"
            type="button"
            class="lab-chip"
            :class="{ active: editing === entry.id, hot: hovered === entry.id, unbound: !entry.bound }"
            :style="chipStyle(entry)"
            @mouseenter="hovered = entry.id"
            @mouseleave="hovered = null"
            @click="editing = entry.id"
          >
            <span class="lab-chip-swatch">{{ entry.group === '连线' ? '线' : entry.label.slice(0, 1) }}</span>
            <span class="lab-chip-copy">
              <strong>{{ entry.label }}</strong>
              <small>{{ chipStatus(entry) }}</small>
            </span>
            <span class="lab-chip-badge" :class="{ live: available.get(entry.id) }">{{ available.get(entry.id) ? '●' : '○' }}</span>
          </button>
        </template>
      </aside>

      <section class="lab-stage-wrap" aria-label="真实画布预览">
        <div ref="stageEl" class="lab-stage" :style="{ height: props.height + 'px' }">
          <CanvasProvider
            :key="providerKey"
            :plugins="activePlugins"
            :adapter="newAdapter()"
            :persist-settings="false"
            @ready="onReady"
            @boot-error="onBootError"
          >
            <CanvasHost
              :persist-viewport="false"
              :edge-visual="{ ...DEFAULT_THEME_EDGE }"
              :handle-visual="{ ...DEFAULT_THEME_HANDLE }"
              :debug-visual="{ ...DEFAULT_THEME_DEBUG }"
            />
            <template #error>
              <p class="lab-boot-error">画布启动失败：{{ bootError }}</p>
            </template>
          </CanvasProvider>

          <div class="lab-stage-top">
            <span class="lab-live" :class="{ ready }"><i></i>{{ ready ? '真实画布' : '正在启动…' }}</span>
            <span class="lab-scene-pill">{{ activeScene.label }}</span>
            <span v-if="!sceneAvailable" class="lab-scene-missing">这个场景需要安装对应插件</span>
          </div>
        </div>
        <p class="lab-stage-foot">
          每条线都量自真实 DOM。没有目标的颜色会明确标为“未绑定”，不会画假线。
        </p>
      </section>

      <aside class="lab-rail lab-rail--right" aria-label="选择与切割颜色">
        <template v-for="group in groups.filter((item) => item.group === '选择' || item.group === '切割')" :key="group.group">
          <p class="lab-rail-title">{{ group.group }}</p>
          <button
            v-for="entry in group.items"
            :key="entry.id"
            :ref="(el) => registerChip(entry.id, el as Element | null)"
            :data-chip-id="entry.id"
            type="button"
            class="lab-chip"
            :class="{ active: editing === entry.id, hot: hovered === entry.id, unbound: !entry.bound }"
            :style="chipStyle(entry)"
            @mouseenter="hovered = entry.id"
            @mouseleave="hovered = null"
            @click="editing = entry.id"
          >
            <span class="lab-chip-swatch">{{ entry.label.slice(0, 1) }}</span>
            <span class="lab-chip-copy">
              <strong>{{ entry.label }}</strong>
              <small>{{ chipStatus(entry) }}</small>
            </span>
            <span class="lab-chip-badge" :class="{ live: available.get(entry.id) }">{{ available.get(entry.id) ? '●' : '○' }}</span>
          </button>
        </template>
        <p v-if="!groups.some((item) => item.group === '选择' || item.group === '切割')" class="lab-rail-empty">
          当前没有可编辑的选择 / 切割颜色。安装对应插件后，这里会自动多出颜色格。
        </p>
      </aside>

      <svg class="lab-lines" aria-hidden="true">
        <g
          v-for="line in lines"
          :key="line.id"
          class="lab-line"
          :class="{ hot: hovered === line.id, dim: hovered !== null && hovered !== line.id }"
          :style="{ '--line-color': line.color }"
        >
          <path :d="line.d" />
          <circle :cx="line.start.x" :cy="line.start.y" r="2.6" />
          <circle class="lab-line-end" :cx="line.end.x" :cy="line.end.y" r="4.6" />
          <circle class="lab-line-dot" :cx="line.end.x" :cy="line.end.y" r="1.8" />
        </g>
      </svg>
    </div>

    <section v-if="editingEntry" class="lab-editor" aria-live="polite">
      <div class="lab-editor-main">
        <div class="lab-editor-head">
          <span class="lab-editor-swatch" :style="{ '--chip': valueOf(editingEntry) }"></span>
          <div>
            <h2>{{ editingEntry.label }}</h2>
            <p>{{ editingEntry.description }} · {{ editingEntry.affects }}</p>
          </div>
          <button class="lab-icon-btn" type="button" aria-label="关闭编辑" @click="editing = null">×</button>
        </div>
        <div class="lab-editor-row">
          <span class="lab-editor-key">{{ keyFor(editingEntry) }}</span>
          <span class="lab-editor-plugin">{{ editingEntry.pluginLabel }}</span>
        </div>
        <div class="lab-editor-body">
          <ColorField
            :model-value="valueOf(editingEntry)"
            :clearable="editingEntry.optional"
            :aria-label="'选择' + editingEntry.label"
            @update:model-value="setValue(editingEntry, $event)"
          />
          <button v-if="editingEntry.optional" type="button" class="lab-link" @click="clearValue(editingEntry)">清空，跟随主题</button>
        </div>
        <p class="lab-editor-note">{{ chipStatus(editingEntry) }}</p>
      </div>
      <div class="lab-chain">
        <p class="lab-chain-title">这个颜色怎么走到组件</p>
        <ol>
          <li v-for="(step, index) in editingEntry.chain" :key="step + index"><span>{{ index + 1 }}</span>{{ step }}</li>
        </ol>
        <p class="lab-chain-foot">
          新增颜色时，插件在自己的 Config 里加 <code>type: 'color'</code> 字段即可；
          想连到画布，再加一条锚点。没有锚点也会出现在这里，并标成“未绑定”。
        </p>
      </div>
    </section>

    <div class="lab-toast" :class="{ show: toast }">{{ toast }}</div>
    </template>
  </div>
</template>

<style scoped src="./ThemeLabView.css"></style>


