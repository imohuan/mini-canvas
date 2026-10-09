<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { RegistryImpl } from '@mini-canvas/kernel'
import type { Entry, Registry, RegistryWrapper } from '@mini-canvas/kernel'

/**
 * 注册场演示台：左边是「场」（按种类放条目），右边是「画布上看到的结果」（一张假卡片）。
 *
 * 这里**用的是真内核** —— RegistryImpl 直接 import 自 @mini-canvas/kernel，
 * 不是自己写的假表。下面每个按钮点下去，都真的改动场里的数据；这一页只是把场读出来画成卡片。
 *
 * 四条语义要在演示里看得出来：
 *   1. order 越小 = 越靠外（越靠上、盖住别人）。list() 按 order 升序 = 从外到里，第一条在最外。
 *   2. 同 id 再 add（同一个放置方）= 换掉自己那条，不是新增，条数不变。
 *   3. 不同 id 叠在同一个种类上互不覆盖，底层永远还在。
 *   4. wrap 放的层会包住下面那层；resolve() 得到逐层套完的结果。
 */

/** 一条条目在卡片上画成什么样：paint = 用调色板第几个颜色，text = 卡片上写的字 */
interface LayerValue {
  paint: number
  text: string
}

/** 调色板：颜色全部取自文档站的主题变量，切深浅色主题时自动跟着变 */
const PALETTE = [
  { name: '蓝', soft: 'var(--vp-c-brand-soft)', line: 'var(--vp-c-brand-1)' },
  { name: '绿', soft: 'var(--vp-c-green-soft)', line: 'var(--vp-c-green-1)' },
  { name: '紫', soft: 'var(--vp-c-purple-soft)', line: 'var(--vp-c-purple-1)' },
  { name: '橙', soft: 'var(--vp-c-yellow-soft)', line: 'var(--vp-c-yellow-1)' },
  { name: '红', soft: 'var(--vp-c-red-soft)', line: 'var(--vp-c-red-1)' },
]

/** 场外的兜底值：场里一条都没有时，画布那边还有这一份默认值（真实项目里就是那份「默认皮肤」） */
const BASE: LayerValue = { paint: 0, text: '场外的兜底值' }

/** wrap 放的「包装纸」：拿到下面那层，包一层再交出去 */
const wrapper: RegistryWrapper<LayerValue> = (inner, entry) => {
  const under: LayerValue = inner ?? BASE
  return { paint: under.paint, text: '〈' + entry.id + '〉包住（' + under.text + '）' }
}

/** 卡片上的三块地方，各自对应场里的一个种类（key） */
const REGIONS = [
  { key: 'out:top', title: '卡片上沿外面', zone: 'above' },
  { key: 'title', title: '卡片标题', zone: 'title' },
  { key: 'over:inset', title: '卡片里面', zone: 'body' },
] as const
const PRESET_KEYS: string[] = REGIONS.map((r) => r.key)
/** 下拉里「自己报一个新种类」那一项的代号 */
const CUSTOM = '__custom__'
/** 这一页里出现的放置方名字（表格里「谁放的」那一列显示的就是它） */
const SOURCE_NAMES = ['我的插件', '主题插件', '图片插件', '云盘插件']
const LETTERS = 'ABCDEFGHIJ'.split('')

// ==================== 场本体（真内核） ====================

const registry = new RegistryImpl<LayerValue>()

/**
 * 每个放置方拿一个「知道自己是谁」的视图：同一张表、同一个种类，
 * 但放进去的 source（谁放的）各自不同。条目里的 source 就是这么来的。
 */
const views: Record<string, Registry<LayerValue>> = {}
for (const name of SOURCE_NAMES) views[name] = registry.bind(name)

function viewOf(source: string): Registry<LayerValue> | undefined {
  return views[source] ?? views['我的插件']
}

function put(source: string, key: string, id: string, order: number, paint: number): void {
  viewOf(source)?.add(key, { paint, text: id }, { id, order })
}

/** 开局先放 5 条：故意让一个种类里有两家不同的人放的东西 */
function seedDemo(): void {
  put('主题插件', 'title', '标题-默认', 20, 3)
  put('图片插件', 'over:inset', '水印贴纸', 30, 2)
  put('云盘插件', 'over:inset', '角标-云盘', 10, 1)
  put('主题插件', 'out:top', '上栏-设置', 25, 0)
  put('图片插件', 'out:top', '上栏-下载', 40, 4)
}
seedDemo()

/** 场一有变化就把 tick 加一，页面上的读数跟着重算（subscribe = 「变了通知我」） */
const tick = ref(0)
const stop = registry.subscribe(() => {
  tick.value++
})
onBeforeUnmount(() => stop.dispose())

// ==================== 界面状态 ====================

const kind = ref<string>('over:inset')
const customKind = ref('my:kind')
const isCustom = computed(() => kind.value === CUSTOM)
/** 当前在操作的种类：左边在动它；右边卡片把全部种类都画出来 */
const activeKey = computed(() => (isCustom.value ? customKind.value.trim() || 'my:kind' : kind.value))

const addId = ref('')
const addOrder = ref(30)
const addPaint = ref(0)
const addSource = ref('我的插件')
const errorMsg = ref('')

let seq = 0
let wrapSeq = 0

/** 取一个还没被用过的 id：贴纸-A、贴纸-B…… */
function freshId(): string {
  const taken = new Set<string>()
  for (const k of registry.keys()) for (const id of registry.ids(k)) taken.add(id)
  for (let i = 0; i < LETTERS.length; i++) {
    const id = '贴纸-' + LETTERS[(seq + i) % LETTERS.length]
    if (!taken.has(id)) {
      seq += i + 1
      return id
    }
  }
  seq++
  return '贴纸-' + seq
}

/** 换种类时，把表单默认值调成「放到最里面」那种（order = 现在最大 + 10） */
function syncForm(key: string): void {
  const list = registry.list(key)
  const max = list.length ? Math.max(...list.map((e) => e.order)) : 0
  addOrder.value = max + 10
  addId.value = freshId()
}

function pickKind(key: string): void {
  if (PRESET_KEYS.includes(key)) kind.value = key
  else {
    if (key !== CUSTOM) customKind.value = key
    kind.value = CUSTOM
  }
  syncForm(activeKey.value)
}
syncForm(activeKey.value)

// ==================== 读（算之前先摸一下 tick，场变了就重算） ====================

interface StackItem {
  id: string
  order: number
  source: string
  paint: number
  text: string
  isWrap: boolean
}

function isWrapperValue(v: LayerValue): boolean {
  return typeof (v as unknown) === 'function'
}

function isWrapEntry(e: Entry<LayerValue>): boolean {
  return isWrapperValue(e.value)
}

/** 表格里「这条是什么」：普通条目显示它写的字，wrap 层显示「包装纸」 */
function labelOf(e: Entry<LayerValue>): string {
  return isWrapperValue(e.value) ? '包装纸 ' + e.id : e.value.text
}

function toItem(e: Entry<LayerValue>): StackItem {
  const wrap = isWrapperValue(e.value)
  return {
    id: e.id,
    order: e.order,
    source: e.source,
    paint: wrap ? 0 : e.value.paint,
    text: wrap ? '包装纸 ' + e.id : e.value.text,
    isWrap: wrap,
  }
}

const activeList = computed<Entry<LayerValue>[]>(() => {
  void tick.value
  return registry.list(activeKey.value)
})
const activeTop = computed<Entry<LayerValue> | undefined>(() => activeList.value[0])
/** 这个种类里现在有哪些 id（用来演示「同 id 再放 = 替换，条数不变」） */
const activeIds = computed<string[]>(() => {
  void tick.value
  return registry.ids(activeKey.value)
})
const resolvedText = computed<string>(() => {
  void tick.value
  return (registry.resolve(activeKey.value, BASE) ?? BASE).text
})

interface RegionView {
  key: string
  title: string
  zone: string
  items: StackItem[]
  resolved: string
}

function buildRegion(key: string, title: string, zone: string): RegionView {
  return {
    key,
    title,
    zone,
    items: registry.list(key).map(toItem),
    resolved: (registry.resolve(key, BASE) ?? BASE).text,
  }
}

/**
 * 卡片上要画的所有层：三个固定位置，加上「谁自己报了新种类」就多画一块。
 * 每一块都是 registry.list(key)：order 升序 = 从外到里，第一条在最外。
 */
const regionViews = computed<RegionView[]>(() => {
  void tick.value
  const extras = registry
    .keys()
    .filter((k) => !PRESET_KEYS.includes(k))
    .sort()
    .map((k) => buildRegion(k, k + '（自己报的种类）', 'extra'))
  return [...REGIONS.map((r) => buildRegion(r.key, r.title, r.zone)), ...extras]
})
const regionByKey = computed<Record<string, RegionView>>(() => {
  const m: Record<string, RegionView> = {}
  for (const r of regionViews.value) m[r.key] = r
  return m
})
/** 取某一块的读数；还没建出来就先给个空壳，模板不会读到 undefined */
function regionOf(key: string): RegionView {
  return regionByKey.value[key] ?? { key, title: key, zone: 'extra', items: [], resolved: '' }
}
/** 自己报的那些种类 */
const extraKeys = computed<string[]>(() =>
  regionViews.value.filter((r) => r.zone === 'extra').map((r) => r.key),
)
/** 场里现在还有哪些种类（点一下就切过去，别的种类不会丢） */
const allKeys = computed<Array<{ key: string; count: number }>>(() => {
  void tick.value
  return registry.keys().map((k) => ({ key: k, count: registry.list(k).length }))
})

// ==================== 写（每个按钮都是真的往场里放 / 从场里删） ====================

/** 加一条：field.add(key, value, { id, order }) */
function add(): void {
  const key = activeKey.value
  const id = addId.value.trim()
  if (!id) {
    errorMsg.value = 'id 不能是空的'
    return
  }
  errorMsg.value = ''
  viewOf(addSource.value)?.add(key, { paint: addPaint.value, text: id }, { id, order: addOrder.value })
  syncForm(key)
}

/** 同 id 再 add = 换掉那条（不是新增）；order 换成新的也一样走这条路 */
function readd(key: string, e: Entry<LayerValue>, patch: { order?: number; paint?: number }): void {
  const v = viewOf(e.source)
  if (!v) return
  const order = patch.order ?? e.order
  if (isWrapperValue(e.value)) v.wrap(key, wrapper, { id: e.id, order })
  else v.add(key, { paint: patch.paint ?? e.value.paint, text: e.value.text }, { id: e.id, order })
}

/** 直接把它挪到最外：order = 现在最小的那个再减一 */
function pushOuter(e: Entry<LayerValue>): void {
  const list = activeList.value
  const min = list.length ? Math.min(...list.map((x) => x.order)) : 0
  readd(activeKey.value, e, { order: min - 1 })
}

/** 同 id 再放一次：故意换个颜色，好让「替换」看得见（条数不变、位置不动） */
function replaceSameId(): void {
  const key = activeKey.value
  const win = registry.top(key)
  if (!win) {
    errorMsg.value = '这个种类现在是空的，先加一条'
    return
  }
  errorMsg.value = ''
  const paint = isWrapperValue(win.value) ? addPaint.value : (win.value.paint + 1) % PALETTE.length
  readd(key, win, { paint })
}

/** 包一层：不写 order，缺省就放在最外（order = 当前最小 - 1） */
function wrapLayer(): void {
  const v = viewOf(addSource.value)
  if (!v) return
  errorMsg.value = ''
  wrapSeq++
  v.wrap(activeKey.value, wrapper, { id: '包装纸-' + wrapSeq })
}

/** 按 id 删一条：field.remove(key, id) */
function removeEntry(key: string, id: string): void {
  errorMsg.value = ''
  registry.remove(key, id)
}

function clearKey(): void {
  errorMsg.value = ''
  registry.clear(activeKey.value)
}

function clearAll(): void {
  errorMsg.value = ''
  for (const k of registry.keys()) registry.clear(k)
}

function resetDemo(): void {
  errorMsg.value = ''
  clearAll()
  seedDemo()
  syncForm(activeKey.value)
}

// ==================== 控件事件 ====================

function onKindChange(ev: Event): void {
  pickKind((ev.target as HTMLSelectElement).value)
}

function onCustomInput(ev: Event): void {
  customKind.value = (ev.target as HTMLInputElement).value
  syncForm(activeKey.value)
}

function onIdInput(ev: Event): void {
  addId.value = (ev.target as HTMLInputElement).value
}

function onOrderInput(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value)
  if (Number.isFinite(v)) addOrder.value = v
}

function onSourceChange(ev: Event): void {
  addSource.value = (ev.target as HTMLSelectElement).value
}

function onRowOrder(e: Entry<LayerValue>, ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value)
  if (Number.isFinite(v)) readd(activeKey.value, e, { order: v })
}

// ==================== 画成卡片 ====================

function paletteOf(paint: number) {
  const i = ((paint % PALETTE.length) + PALETTE.length) % PALETTE.length
  return PALETTE[i] as (typeof PALETTE)[number]
}

/** 叠层的样子：order 越小（在列表里越靠前）→ 越往上、越往左、z-index 越大 = 看得见的是它 */
function stickerStyle(it: StackItem, total: number, i: number) {
  const base = { zIndex: total - i, top: i * 10 + 'px', left: i * 14 + 'px' }
  if (it.isWrap) {
    return {
      ...base,
      background: 'var(--vp-c-bg)',
      borderColor: 'var(--vp-c-text-3)',
      borderStyle: 'dashed',
      color: 'var(--vp-c-text-2)',
    }
  }
  const p = paletteOf(it.paint)
  return { ...base, background: p.soft, borderColor: p.line, color: p.line }
}

function dotStyle(it: StackItem) {
  return it.isWrap ? { background: 'var(--vp-c-text-3)' } : { background: paletteOf(it.paint).line }
}

function stackHeight(items: StackItem[]): string {
  return (items.length > 1 ? 32 + (items.length - 1) * 10 : 34) + 'px'
}
</script>

<template>
  <div class="rp">
    <div class="rp-grid">
      <!-- ==================== 左边：场 ==================== -->
      <section class="rp-panel">
        <h3 class="rp-h">左边：场里放了什么</h3>

        <div class="rp-row">
          <label class="rp-lbl" for="rp-kind">种类</label>
          <select id="rp-kind" class="rp-input" :value="kind" @change="onKindChange">
            <option v-for="r in REGIONS" :key="r.key" :value="r.key">{{ r.key }}（{{ r.title }}）</option>
            <option :value="CUSTOM">＋ 自己报一个新种类</option>
          </select>
        </div>

        <div v-if="isCustom" class="rp-row">
          <label class="rp-lbl" for="rp-custom">新种类名</label>
          <input id="rp-custom" class="rp-input" :value="customKind" placeholder="比如 my:kind" @input="onCustomInput" />
        </div>

        <div class="rp-row">
          <label class="rp-lbl" for="rp-id">条目 id</label>
          <input id="rp-id" class="rp-input" :value="addId" placeholder="比如 贴纸-A" @input="onIdInput" />
        </div>

        <div class="rp-row">
          <label class="rp-lbl" for="rp-order">order</label>
          <input id="rp-order" class="rp-input rp-input--num" type="number" :value="addOrder" @input="onOrderInput" />
          <span class="rp-hint">越小越靠外</span>
        </div>

        <div class="rp-row">
          <span class="rp-lbl">颜色</span>
          <button
            v-for="(p, i) in PALETTE"
            :key="p.name"
            type="button"
            class="rp-swatch"
            :class="{ 'rp-swatch--on': addPaint === i }"
            :style="{ background: p.soft, borderColor: p.line }"
            :title="p.name"
            :aria-label="p.name"
            @click="addPaint = i"
          >
            <span class="rp-swatch__dot" :style="{ background: p.line }" />
          </button>
        </div>

        <div class="rp-row">
          <label class="rp-lbl" for="rp-source">谁放的</label>
          <select id="rp-source" class="rp-input" :value="addSource" @change="onSourceChange">
            <option v-for="s in SOURCE_NAMES" :key="s" :value="s">{{ s }}</option>
          </select>
        </div>

        <div class="rp-btns">
          <button id="rp-add" class="rp-btn rp-btn--main" type="button" @click="add">加一条</button>
          <button id="rp-replace" class="rp-btn" type="button" @click="replaceSameId">同 id 再加一次</button>
          <button id="rp-wrap" class="rp-btn" type="button" @click="wrapLayer">包一层（wrap）</button>
          <button id="rp-clear-key" class="rp-btn" type="button" @click="clearKey">清空这个种类</button>
          <button id="rp-clear-all" class="rp-btn" type="button" @click="clearAll">清空全场</button>
          <button id="rp-reset" class="rp-btn" type="button" @click="resetDemo">恢复示例</button>
        </div>

        <p v-if="errorMsg" class="rp-error">{{ errorMsg }}</p>

        <p class="rp-read">
          这个种类现在有 <b id="rp-count">{{ activeList.length }}</b> 条，id 一共
          {{ activeIds.length }} 个；
          <template v-if="activeTop">
            最外面（赢家）是 <b id="rp-winner" class="rp-code">{{ activeTop.id }}</b>，order =
            <b>{{ activeTop.order }}</b>，谁放的：{{ activeTop.source }}。
          </template>
          <template v-else>一条都没有，卡片那边用的是场外兜底值。</template>
        </p>
        <p class="rp-read">
          <span class="rp-code">resolve('{{ activeKey }}')</span> 的结果：<b id="rp-resolved">{{ resolvedText }}</b>
        </p>

        <table class="rp-table">
          <thead>
            <tr><th>排名</th><th>id</th><th>order</th><th>谁放的</th><th>改 order</th><th>删</th></tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in activeList" :key="e.id" :class="{ 'rp-tr--win': i === 0 }">
              <td class="rp-td--dim">{{ i === 0 ? '赢家' : i + 1 }}</td>
              <td>
                <span class="rp-dot" :style="dotStyle(toItem(e))" />
                <span class="rp-code">{{ labelOf(e) }}</span>
                <span v-if="isWrapEntry(e)" class="rp-tag">wrap</span>
              </td>
              <td><b>{{ e.order }}</b></td>
              <td class="rp-td--dim">{{ e.source }}</td>
              <td class="rp-td--acts">
                <input class="rp-input rp-input--tiny" type="number" :value="e.order" @input="onRowOrder(e, $event)" />
                <button class="rp-btn rp-btn--tiny" type="button" @click="pushOuter(e)">顶到最外</button>
              </td>
              <td>
                <button class="rp-btn rp-btn--tiny" type="button" @click="removeEntry(activeKey, e.id)">删掉</button>
              </td>
            </tr>
            <tr v-if="!activeList.length">
              <td colspan="6" class="rp-td--dim">这个种类现在是空的</td>
            </tr>
          </tbody>
        </table>

        <p class="rp-keys">
          场里还有这些种类：
          <button
            v-for="k in allKeys"
            :key="k.key"
            type="button"
            class="rp-chip"
            :class="{ 'rp-chip--on': k.key === activeKey }"
            @click="pickKind(k.key)"
          >
            {{ k.key }} ×{{ k.count }}
          </button>
          <span v-if="!allKeys.length" class="rp-hint">（空场）</span>
        </p>
      </section>

      <!-- ==================== 右边：卡片 ==================== -->
      <section class="rp-panel">
        <h3 class="rp-h">右边：画布上看到的结果</h3>
        <p class="rp-hint">卡片是假的，但它的每一层都是场里真条目：order 越小 = 越靠上、盖住别人。</p>

        <div class="rp-canvas">
          <!-- 卡片上沿外面 -->
          <div class="rp-zone">
            <div class="rp-zone__label">
              <span class="rp-code">{{ regionOf('out:top').key }}</span>
              <span class="rp-hint">共 {{ regionOf('out:top').items.length }} 条</span>
            </div>
            <div class="rp-stack" :style="{ height: stackHeight(regionOf('out:top').items) }">
              <TransitionGroup name="rp">
                <div
                  v-for="(it, i) in regionOf('out:top').items"
                  :key="it.id"
                  class="rp-item"
                  :class="{ 'rp-item--win': i === 0, 'rp-item--wrap': it.isWrap }"
                  :data-entry-id="it.id"
                  :data-order="it.order"
                  :style="stickerStyle(it, regionOf('out:top').items.length, i)"
                >
                  <b>{{ it.text }}</b>
                  <span class="rp-item__meta">order {{ it.order }} · {{ it.source }}</span>
                </div>
              </TransitionGroup>
              <div v-if="!regionOf('out:top').items.length" class="rp-item rp-item--empty">空（用场外兜底值）</div>
            </div>
            <p class="rp-resolved">
              <span class="rp-code">resolve</span> = <b>{{ regionOf('out:top').resolved }}</b>
            </p>
          </div>

          <!-- 卡片本体 -->
          <div class="rp-node">
            <div class="rp-node__head">
              <div class="rp-node__title">标题</div>
              <div class="rp-zone rp-zone--in">
                <div class="rp-zone__label">
                  <span class="rp-code">{{ regionOf('title').key }}</span>
                  <span class="rp-hint">共 {{ regionOf('title').items.length }} 条</span>
                </div>
                <div class="rp-stack" :style="{ height: stackHeight(regionOf('title').items) }">
                  <TransitionGroup name="rp">
                    <div
                      v-for="(it, i) in regionOf('title').items"
                      :key="it.id"
                      class="rp-item"
                      :class="{ 'rp-item--win': i === 0, 'rp-item--wrap': it.isWrap }"
                      data-zone="title"
                      :data-entry-id="it.id"
                      :data-order="it.order"
                      :style="stickerStyle(it, regionOf('title').items.length, i)"
                    >
                      <b>{{ it.text }}</b>
                      <span class="rp-item__meta">order {{ it.order }} · {{ it.source }}</span>
                    </div>
                  </TransitionGroup>
                  <div v-if="!regionOf('title').items.length" class="rp-item rp-item--empty">空（用场外兜底值）</div>
                </div>
              </div>
            </div>

            <div class="rp-node__body">
              <div class="rp-zone rp-zone--in">
                <div class="rp-zone__label">
                  <span class="rp-code">{{ regionOf('over:inset').key }}</span>
                  <span class="rp-hint">共 {{ regionOf('over:inset').items.length }} 条</span>
                </div>
                <div class="rp-stack" :style="{ height: stackHeight(regionOf('over:inset').items) }">
                  <TransitionGroup name="rp">
                    <div
                      v-for="(it, i) in regionOf('over:inset').items"
                      :key="it.id"
                      class="rp-item"
                      :class="{ 'rp-item--win': i === 0, 'rp-item--wrap': it.isWrap }"
                      data-zone="over:inset"
                      :data-entry-id="it.id"
                      :data-order="it.order"
                      :style="stickerStyle(it, regionOf('over:inset').items.length, i)"
                    >
                      <b>{{ it.text }}</b>
                      <span class="rp-item__meta">order {{ it.order }} · {{ it.source }}</span>
                    </div>
                  </TransitionGroup>
                  <div v-if="!regionOf('over:inset').items.length" class="rp-item rp-item--empty">空（用场外兜底值）</div>
                </div>
              </div>
              <p class="rp-resolved">
                <span class="rp-code">resolve</span> = <b>{{ regionOf('over:inset').resolved }}</b>
              </p>
            </div>
          </div>

          <!-- 自己报的那些种类：一样会画出来 -->
          <div v-for="k in extraKeys" :key="k" class="rp-zone">
            <div class="rp-zone__label">
              <span class="rp-code">{{ k }}</span>
              <span class="rp-hint">共 {{ regionOf(k).items.length }} 条</span>
            </div>
            <div class="rp-stack" :style="{ height: stackHeight(regionOf(k).items) }">
              <TransitionGroup name="rp">
                <div
                  v-for="(it, i) in regionOf(k).items"
                  :key="it.id"
                  class="rp-item"
                  :class="{ 'rp-item--win': i === 0, 'rp-item--wrap': it.isWrap }"
                  :data-zone="k"
                  :data-entry-id="it.id"
                  :data-order="it.order"
                  :style="stickerStyle(it, regionOf(k).items.length, i)"
                >
                  <b>{{ it.text }}</b>
                  <span class="rp-item__meta">order {{ it.order }} · {{ it.source }}</span>
                </div>
              </TransitionGroup>
              <div v-if="!regionOf(k).items.length" class="rp-item rp-item--empty">空（用场外兜底值）</div>
            </div>
            <p class="rp-resolved">
              <span class="rp-code">resolve</span> = <b>{{ regionOf(k).resolved }}</b>
            </p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/**
 * 演示台的样式：颜色 / 边框 / 圆角全部用文档站已有的 CSS 变量（--vp-c-*），
 * 不自己发明颜色，深浅色主题都能跟着变。
 */

.rp-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1.05fr) minmax(280px, 1fr);
  gap: 16px;
  margin: 20px 0;
}

@media (max-width: 760px) {
  .rp-grid {
    grid-template-columns: 1fr;
  }
}

.rp-panel {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  padding: 14px;
}

.rp-h {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--vp-c-text-1);
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 8px;
}

.rp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.rp-lbl {
  flex: 0 0 62px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.rp-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 13px;
}

.rp-input--num {
  flex: 0 0 84px;
}

.rp-input--tiny {
  width: 64px;
  flex: 0 0 auto;
  padding: 3px 6px;
  font-size: 12px;
}

.rp-input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.rp-hint {
  font-size: 11px;
  color: var(--vp-c-text-3);
}

.rp-code {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
}

.rp-swatch {
  width: 22px;
  height: 22px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 7px;
  cursor: pointer;
  padding: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.rp-swatch--on {
  box-shadow: 0 0 0 2px var(--vp-c-bg-soft), 0 0 0 3px currentColor;
}

.rp-swatch__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
}

.rp-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 6px;
}

.rp-btn {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 5px 10px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  font-size: 12px;
  transition: color 0.18s, border-color 0.18s, background 0.18s;
}

.rp-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.rp-btn--main {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.rp-btn--tiny {
  padding: 3px 7px;
  font-size: 11px;
}

.rp-error {
  margin: 6px 0;
  font-size: 12px;
  color: var(--vp-c-danger-1);
}

.rp-read {
  margin: 6px 0;
  font-size: 12px;
  line-height: 1.9;
  color: var(--vp-c-text-2);
}

.rp-read b {
  color: var(--vp-c-text-1);
}

.rp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  display: table;
  margin: 8px 0;
}

.rp-table th,
.rp-table td {
  border-bottom: 1px solid var(--vp-c-divider);
  padding: 5px 6px;
  text-align: left;
  vertical-align: middle;
}

.rp-table th {
  color: var(--vp-c-text-2);
  font-weight: 600;
  font-size: 11px;
}

.rp-tr--win td {
  background: var(--vp-c-brand-soft);
}

.rp-td--dim {
  color: var(--vp-c-text-2);
}

.rp-td--acts {
  white-space: nowrap;
}

.rp-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  margin-right: 6px;
  vertical-align: middle;
}

.rp-tag {
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px dashed var(--vp-c-text-3);
  border-radius: 6px;
  font-size: 10px;
  color: var(--vp-c-text-2);
}

.rp-keys {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
  line-height: 2.2;
}

.rp-chip {
  margin: 0 4px 4px 0;
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  cursor: pointer;
}

.rp-chip--on {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

/* ==================== 右边：卡片 ==================== */

.rp-canvas {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rp-zone {
  border: 1px dashed var(--vp-c-divider);
  border-radius: 10px;
  padding: 6px 8px 4px;
  background: var(--vp-c-bg);
}

.rp-zone--in {
  border: 0;
  padding: 0;
  background: transparent;
}

.rp-zone__label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}

.rp-node {
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg);
  padding: 10px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.06);
}

.rp-node__head {
  border-bottom: 1px solid var(--vp-c-divider);
  padding-bottom: 8px;
  margin-bottom: 8px;
}

.rp-node__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 6px;
  min-height: 22px;
}

.rp-node__body {
  min-height: 70px;
}

/* 叠层区：order 越小越靠上（top / left 越小） */
.rp-stack {
  position: relative;
  transition: height 0.24s ease;
}

.rp-item {
  position: absolute;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 9px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  transition: top 0.3s cubic-bezier(0.4, 0, 0.2, 1), left 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.24s ease, transform 0.24s ease, box-shadow 0.24s ease;
}

.rp-item b {
  font-weight: 600;
}

.rp-item__meta {
  font-size: 10px;
  opacity: 0.75;
  font-family: var(--vp-font-family-mono);
}

/* 最外面那条（赢家）：加一圈描边，进出都能看出来 */
.rp-item--win {
  box-shadow: 0 0 0 2px var(--vp-c-bg), 0 0 0 4px var(--vp-c-brand-1), 0 4px 14px rgba(0, 0, 0, 0.12);
}

.rp-item--wrap {
  border-style: dashed;
}

.rp-item--empty {
  position: relative;
  color: var(--vp-c-text-3);
  border-style: dashed;
  box-shadow: none;
  background: var(--vp-c-bg-soft);
}

.rp-resolved {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--vp-c-text-2);
  padding-bottom: 4px;
}

.rp-resolved b {
  color: var(--vp-c-text-1);
}

/* ==================== 动画：增删 / 重排都平滑过渡 ==================== */

.rp-enter-active {
  transition: opacity 0.26s ease, transform 0.26s ease;
}

.rp-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.rp-enter-from {
  opacity: 0;
  transform: translateY(-10px) scale(0.9);
}

.rp-leave-to {
  opacity: 0;
  transform: scale(0.9) translateX(10px);
}

.rp-move {
  transition: top 0.3s cubic-bezier(0.4, 0, 0.2, 1), left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.rp-leave-active {
  z-index: 0 !important;
}

/* 有人不想要动画就听他们的 */
@media (prefers-reduced-motion: reduce) {
  .rp-stack,
  .rp-item,
  .rp-enter-active,
  .rp-leave-active,
  .rp-move {
    transition: none !important;
  }
}
</style>

