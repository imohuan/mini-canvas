<script setup lang="ts">
/**
 * 底栏「预设提示词」按钮 + 面板（用户 2026-11-06 图 1 / 图 2）。
 *
 * 只做一件事：把用户自己攒的几句常用提示词存起来，点一下填进输入框。
 * 数据存在本机 localStorage（promptPresets.ts），不碰云端配置。
 *
 * 为什么单独一个组件、一套 nbp- 类名：
 * 底栏的 BottomBarActions / 样式表正在被另一个任务改，这里尽量自成一块，
 * 只在底行借一个插槽把按钮放进去，减少两边同时改同一段代码的机会。
 *
 * 插入方式（用户口径「可以添加一些自己的提示词」）：输入框为空就直接填入；
 * 已有内容就接在后面，不覆盖用户正在写的东西。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useCanvasRender, useUiComponent } from '@mini-canvas/canvas-render'
import type { NotifyContract } from '@mini-canvas/canvas-base'
import {
  addPreset,
  createPreset,
  filterPresets,
  loadPromptPresets,
  removePreset,
  savePromptPresets,
  type PromptPreset,
} from '../promptPresets'
import { ICON_BOOKMARK, ICON_PLUS, ICON_SEARCH, ICON_TRASH } from './presetIcons'

defineProps<{
  /** 输入框不可用时（没有输入框 / AI 生成中）也不允许插入 */
  disabled: boolean
}>()

const emit = defineEmits<{
  /** 用户点了某条预设：把正文放进输入框（已有内容时接在后面） */
  apply: [content: string]
}>()

const { ctx } = useCanvasRender()
const notify = ctx.tryGet<NotifyContract>('notify')

const Button = useUiComponent('Button')
const Popover = useUiComponent('Popover')
const PopoverContent = useUiComponent('PopoverContent')
const PopoverTrigger = useUiComponent('PopoverTrigger')
const InputGroup = useUiComponent('InputGroup')
const InputGroupAddon = useUiComponent('InputGroupAddon')
const InputGroupButton = useUiComponent('InputGroupButton')
const InputGroupInput = useUiComponent('InputGroupInput')
const ScrollArea = useUiComponent('ScrollArea')
const Label = useUiComponent('Label')
const Dialog = useUiComponent('Dialog')
const DialogContent = useUiComponent('DialogContent')
const DialogDescription = useUiComponent('DialogDescription')
const DialogFooter = useUiComponent('DialogFooter')
const DialogHeader = useUiComponent('DialogHeader')
const DialogTitle = useUiComponent('DialogTitle')
const Input = useUiComponent('Input')
const Textarea = useUiComponent('Textarea')

const open = ref(false)
const query = ref('')
/** 首次打开才读盘；之后新增/删除都直接改这份内存副本，避免每次开关都读一遍 */
const loaded = ref(false)
const presets = ref<PromptPreset[]>([])

const filtered = computed(() => filterPresets(presets.value, query.value))

/**
 * 列表高度：按真实条数给 ScrollArea 一个确定高度。
 *
 * 为什么不用固定 280px：只有一条时面板会空出一大片（用户口径：弹层应该贴着内容）。
 * 三条以上封顶，再多的靠内部滚动；高度只由条数决定，搜索后条数变了跟着缩。
 */
const LIST_ITEM_HEIGHT = 73
const listStyle = computed<Record<string, string>>(() => {
  const n = Math.max(1, filtered.value.length)
  return { height: 'min(' + n * LIST_ITEM_HEIGHT + 'px, 46vh)' }
})

function reload(): void {
  presets.value = loadPromptPresets()
  loaded.value = true
}

// 打开面板时同步一次：用户可能在另一个标签页改过（storage 事件不保证）
watch(open, (isOpen) => {
  if (!isOpen) return
  reload()
  query.value = ''
})

function persist(): boolean {
  const ok = savePromptPresets(presets.value)
  if (!ok) notify?.error('预设保存失败', { description: '浏览器存储不可用或空间已满' })
  return ok
}

function use(preset: PromptPreset): void {
  if (!preset.content.trim()) return
  emit('apply', preset.content)
  open.value = false
}

function remove(id: string): void {
  presets.value = removePreset(presets.value, id)
  persist()
}

// —— 新建对话框 ——
const creating = ref(false)
const draftName = ref('')
const draftContent = ref('')
const nameInput = ref<{ $el?: HTMLElement } | null>(null)

const canSaveDraft = computed(() => draftContent.value.trim().length > 0)

function startCreate(): void {
  draftName.value = ''
  draftContent.value = ''
  /*
   * 打开新建弹窗前先收起预设面板（用户 2026-11-07 截图）。
   *
   * 为什么要关：面板是 Teleport 到 body 的菜单层（--ui-layer-menu，100002），
   * 对话框在下面一档（--ui-layer-dialog，100000），两个同时开着面板就压在弹窗上。
   * 也符合「同屏只开一个浮层」的规矩。弹窗本身仍要能在里面开下拉，所以不抬弹窗层级。
   */
  open.value = false
  creating.value = true
  void nextTick(() => {
    // Input 是组件，$el 才是原生元素；拿不到就退回 querySelector（同屏只有一个新建框）
    const el =
      (nameInput.value?.$el as HTMLElement | undefined)
      ?? (document.querySelector('.nbp-dialog input') as HTMLInputElement | null)
    el?.focus?.()
  })
}

function saveDraft(): void {
  if (!canSaveDraft.value) return
  const preset = createPreset(draftName.value, draftContent.value)
  // 新建的内容直接填进输入框，省一步「再点一次」；用户明确要的就是「能加自己的提示词」
  presets.value = addPreset(presets.value, preset)
  if (!persist()) return
  creating.value = false
  emit('apply', preset.content)
  open.value = false
  notify?.success('已使用新预设', { description: preset.name })
}

/** 列表里内容预览：换行压成空格，避免一条预设把面板撑得很高 */
function previewOf(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="icon-sm"
        class="nb-icon-btn nbp-trigger"
        :class="{ 'is-active': open }"
        type="button"
        :disabled="disabled"
        title="预设提示词"
        aria-label="预设提示词"
        aria-haspopup="dialog"
        :aria-expanded="open"
        data-testid="bar-presets"
        @click.stop
      >
        <span aria-hidden="true" v-html="ICON_BOOKMARK" />
      </Button>
    </PopoverTrigger>

    <PopoverContent
      align="start"
      side="top"
      class="nbp-pop"
      :arrow="false"
      :body-lock="false"
      :disable-outside-pointer-events="false"
      @open-auto-focus.prevent
    >
      <div class="nbp-head">
        <span class="nbp-title">预设提示词</span>
        <span class="nbp-count">{{ presets.length }} 条</span>
      </div>

      <div class="nbp-searchrow">
        <InputGroup class="nbp-search">
          <InputGroupAddon align="inline-start">
            <span class="nbp-searchicon" aria-hidden="true" v-html="ICON_SEARCH" />
          </InputGroupAddon>
          <InputGroupInput
            :model-value="query"
            type="search"
            placeholder="搜索预设…"
            aria-label="搜索预设"
            @update:model-value="(v: string | number) => (query = String(v))"
            @keydown.stop
            @keydown.esc.stop="open = false"
          />
          <InputGroupAddon v-if="query" align="inline-end">
            <InputGroupButton size="icon-xs" aria-label="清空搜索" @click="query = ''">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button variant="outline" size="sm" class="nbp-new" type="button" @click.stop="startCreate">
          <span class="nbp-new-icon" aria-hidden="true" v-html="ICON_PLUS" />
          <span>新建</span>
        </Button>
      </div>

      <div class="nbp-body">
        <ScrollArea v-if="loaded && filtered.length > 0" class="nbp-list" :style="listStyle">
          <button
            v-for="p in filtered"
            :key="p.id"
            class="nbp-item"
            type="button"
            :title="'填入：' + p.name"
            @click.stop="use(p)"
          >
            <span class="nbp-item-text">
              <span class="nbp-item-name">{{ p.name }}</span>
              <span class="nbp-item-preview">{{ previewOf(p.content) }}</span>
            </span>
            <span
              class="nbp-del"
              role="button"
              tabindex="0"
              :aria-label="'删除预设 ' + p.name"
              :title="'删除 ' + p.name"
              @click.stop="remove(p.id)"
              @keydown.enter.stop.prevent="remove(p.id)"
            >
              <span aria-hidden="true" v-html="ICON_TRASH" />
            </span>
          </button>
        </ScrollArea>

        <div v-else class="nbp-empty">
          <span class="nbp-empty-icon" aria-hidden="true" v-html="ICON_BOOKMARK" />
          <p v-if="query.trim()">没有匹配「{{ query.trim() }}」的预设</p>
          <p v-else>暂无预设，点击「新建」创建第一个预设</p>
        </div>
      </div>

      <p class="nbp-hint">预设只保存在这台电脑的浏览器里</p>
    </PopoverContent>
  </Popover>

  <Dialog v-model:open="creating">
    <DialogContent class="nbp-dialog" :show-close-button="false">
      <!--
        正文必须多包一层：组件库 host.css 对 [data-slot='dialog-content'] 强制
        padding:0 / gap:0 !important（全站弹窗共用这条规矩）。内边距写在外层会被吃掉，
        标题与输入框就贴到面板边上 —— 用户 2026-11-07 截图里的样子。
      -->
      <div class="nbp-dialog-body">
        <DialogHeader class="nbp-dialog-head">
          <DialogTitle class="nbp-dialog-title">新建预设</DialogTitle>
          <DialogDescription class="nbp-dialog-desc">填写预设名称和内容，保存后直接填入输入框</DialogDescription>
        </DialogHeader>

        <div class="nbp-field">
          <Label for="nbp-preset-name" class="nbp-label">预设名称</Label>
          <Input
            id="nbp-preset-name"
            ref="nameInput"
            v-model="draftName"
            class="nbp-input"
            placeholder="请输入预设名称"
            maxlength="40"
            @keydown.stop
            @keydown.enter.prevent="saveDraft"
          />
        </div>

        <div class="nbp-field">
          <Label for="nbp-preset-content" class="nbp-label">预设内容</Label>
          <Textarea
            id="nbp-preset-content"
            v-model="draftContent"
            class="nbp-textarea"
            rows="5"
            placeholder="请输入预设内容…"
            @keydown.stop
            @keydown.enter.stop
          />
        </div>

        <DialogFooter class="nbp-dialog-foot">
          <Button variant="outline" type="button" @click="creating = false">取消</Button>
          <Button variant="default" type="button" :disabled="!canSaveDraft" @click="saveDraft">保存</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>

<style src="./prompt-presets.css"></style>
