<script setup lang="ts">
/**
 * DemoTopEntry —— 图片顶栏里的「功能演示」下拉按钮。
 *
 * 验证四件事（全是演示形态，不做业务）：
 * 1. 按钮：按名取主题 button；
 * 2. 下拉按钮：按名取主题 dropdown，普通行点了只提示；
 * 3. 二级菜单：「更多」行展开二级面板（内嵌在下拉面板里的子面板，与右键菜单同语义）；
 * 4. 功能模式：点「进入功能模式」→ openDemoMode(nodeId, kind)，顶/底栏替换成功能专属面板。
 *
 * 位置由 BaseNode 上插槽定位层负责；本组件只放内容。
 */
import { computed, ref } from 'vue'
import { useCanvasRender, useSoleNodeSelected, useUiComponent } from '@mini-canvas/canvas-render'
import { openDemoMode } from './demoMode'

const props = defineProps<{ id: string; data: Record<string, unknown> }>()
const { ctx } = useCanvasRender()
const selected = useSoleNodeSelected(props.id)
const ThemedButton = useUiComponent('button')
const ThemedDropdown = useUiComponent('dropdown')
const Tip = useUiComponent('tooltip')

const open = ref(false)
const subOpen = ref(false)

const activeKind = ref<'alpha' | 'beta' | null>(null)

function notify(text: string): void {
  ctx.tryGet<{ show?(t: string): void }>('tip')?.show?.(text)
}

function pickPlain(label: string): void {
  notify('演示：点了「' + label + '」')
  open.value = false
  subOpen.value = false
}

function enterMode(kind: 'alpha' | 'beta'): void {
  activeKind.value = kind
  openDemoMode(props.id, kind)
  open.value = false
  subOpen.value = false
}

/** 图标（与项目内其它插件同一写法：内联 svg 字符串） */
const ICON_DEMO =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>'
const ICON_SUB =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>'

void activeKind
void selected
void Tip
void props
</script>

<template>
  <div v-if="selected" class="dte-root nodrag nopan" data-testid="demo-top-entry">
    <component :is="ThemedDropdown || 'div'" v-model="open" placement="bottom-start" :offset="6"
      menu-width="216px" :teleport="true">
      <template #trigger>
        <component :is="ThemedButton || 'button'" type="button" title="功能演示"
          aria-label="功能演示" aria-haspopup="menu" :aria-expanded="open" :icon="ICON_DEMO">
          功能演示
        </component>
      </template>
      <template #default="{ close }">
        <div class="dte-menu" role="menu" aria-label="功能演示">
          <button class="dte-row" type="button" role="menuitem" @click="pickPlain('动作一')">动作一</button>
          <button class="dte-row" type="button" role="menuitem" @click="pickPlain('动作二')">动作二</button>

          <!-- 二级菜单入口（内嵌子面板：与右键菜单的同语义） -->
          <button class="dte-row dte-row--sub" type="button" role="menuitem" :aria-expanded="subOpen"
            :aria-controls="'dte-sub-' + id" @click="subOpen = !subOpen">
            <span>更多</span>
            <span class="dte-chev" aria-hidden="true" v-html="ICON_SUB" />
          </button>
          <div v-if="subOpen" :id="'dte-sub-' + id" class="dte-sub" role="menu" aria-label="更多">
            <button class="dte-row dte-row--child" type="button" role="menuitem" @click="pickPlain('子项 1')">子项 1</button>
            <button class="dte-row dte-row--child" type="button" role="menuitem" @click="pickPlain('子项 2')">子项 2</button>
          </div>

          <div class="dte-sep" role="separator" />
          <button class="dte-row dte-row--mode" type="button" role="menuitem"
            @click="enterMode('alpha'); close()">进入功能模式 A</button>
          <button class="dte-row dte-row--mode" type="button" role="menuitem"
            @click="enterMode('beta'); close()">进入功能模式 B</button>
        </div>
      </template>
    </component>
  </div>
</template>

<style scoped>
.dte-root { display: inline-flex; }
.dte-menu { display: flex; flex-direction: column; gap: 2px; }
.dte-row { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-badge, 6px); background: transparent; color: var(--ui-ink, #18202b); font-size: var(--text-base, 13px); text-align: left; cursor: pointer; }
.dte-row:hover, .dte-row:focus-visible { background: var(--ui-hover, rgb(0 0 0 / 0.06)); }
.dte-row--sub, .dte-row--mode { font-weight: 500; }
.dte-row--child { padding-left: 22px; font-weight: 400; }
.dte-chev { display: inline-flex; }
.dte-chev :deep(svg), .dte-chev svg { width: 12px; height: 12px; color: var(--ui-ink-mute, #8c95a3); }
.dte-sub { padding: 4px 2px; margin: 2px 0; border-top: 1px solid var(--ui-line-soft, #eef0f4); border-bottom: 1px solid var(--ui-line-soft, #eef0f4); }
.dte-sep { height: 1px; margin: 4px 6px; background: var(--ui-line, #e2e5ea); }
</style>
