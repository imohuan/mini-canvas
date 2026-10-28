<script lang="ts">
/**
 * SlotComposer —— 让「内置 UI」和「插件 UI」一起排序的槽容器。
 *
 * 写法（宿主）：
 *   <SlotComposer slot="shell.dock" item-class="flex-none">
 *     <SlotAnchor id="host/add" :order="100">…内置按钮…</SlotAnchor>
 *     <SlotAnchor id="host/agent" :order="700">…Agent 圆球…</SlotAnchor>
 *   </SlotComposer>
 *
 * 写法（插件）：
 *   ctx.slots.register('shell.dock', {
 *     id: 'my-plugin/export',
 *     before: 'host/agent',
 *     order: 900,
 *     component: ExportButton,
 *   })
 *
 * 规则：
 * - before / after 指向**同槽条目 id**（owner/name），不是槽名；
 * - 目标不存在 → 忽略该约束，退回 order；
 * - order 缺省 1000；同 order 保持传入顺序；
 * - 本地锚点同 id 时优先，插件不能顶掉内置按钮；
 * - 环 / 自引用 / 重复 id 会 warn，并按 order 兜底。
 *
 * 与 SlotHost 的分工：SlotHost 只渲染插件条目（overlay / mini-map 这类纯插件区域）；
 * SlotComposer 额外容纳宿主的 SlotAnchor，所以内置按钮也能被插件精确插入前后。
 */
import {
  Comment,
  Fragment,
  cloneVNode,
  defineComponent,
  h,
  isVNode,
  markRaw,
  onBeforeUnmount,
  shallowRef,
  type Component,
  type VNode,
  type VNodeArrayChildren,
  type VNodeChild,
} from 'vue'
import { orderSlotItems, type SlotOrderIssue } from '@mini-canvas/kernel'
import { useCanvasContext } from '../contracts/canvasContext'
import SlotAnchor from './SlotAnchor.vue'
import { isSlotItemId, type SlotComposerEntry } from './slotComposer'

interface SlotComposerItem extends SlotComposerEntry {
  component: unknown
  source: 'host' | 'plugin'
  /** 宿主锚点的内容（插件条目为 undefined） */
  content?: VNodeChild[]
}

/** 默认兜底 order：内置项显式给 100~900，未声明者排最后 */
const FALLBACK_ORDER = 1000

export default defineComponent({
  name: 'SlotComposer',
  inheritAttrs: false,
  props: {
    /** 槽名（用点，如 shell.dock） */
    slot: { type: String, required: true },
    /** 给插件组件根元素加的 class */
    itemClass: { type: String, default: undefined },
    /** 给插件条目补宿主 props（如抽屉页签 active/onSelect/host） */
    itemProps: { type: Function, default: undefined },
    /**
     * 所有条目共享的宿主 props（默认按钮组件 / 打开抽屉等函数）。
     * 插件组件与 SlotAnchor 的插槽内容都会收到；itemProps 可覆盖同名项。
     */
    sharedProps: { type: Object, default: undefined },
  },
  setup(props, { slots, attrs }) {
    const { ctx } = useCanvasContext()
    const plugins = shallowRef<Array<SlotComposerEntry & { component: unknown }>>([])
    const warned = new Set<string>()

    function reload(): void {
      plugins.value = ctx.slots.occupants(props.slot).map((e) => ({
        id: e.id,
        order: e.order,
        ...(e.before !== undefined ? { before: e.before } : {}),
        ...(e.after !== undefined ? { after: e.after } : {}),
        component: e.component,
      }))
    }
    reload()

    const disposers: Array<{ dispose(): void }> = [
      ctx.on('ctx:plugin-installed', reload),
      ctx.on('ctx:plugin-uninstalled', reload),
    ]
    const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
    if (slotRegistry && typeof slotRegistry.subscribe === 'function') {
      const off = slotRegistry.subscribe(reload)
      disposers.push({ dispose: off })
    }
    onBeforeUnmount(() => {
      for (const d of disposers) d.dispose()
    })

    /** 把一个 SlotAnchor VNode 的默认插槽展开成一组 VNode */
    function anchorContent(node: VNode): VNodeChild[] {
      const children = node.children as
        | VNodeChild[]
        | Record<string, unknown>
        | {
            default?: (props?: Record<string, unknown>) => VNodeChild[]
          }
        | null
      if (Array.isArray(children)) return children
      if (children && typeof children === 'object' && typeof children.default === 'function') {
        return children.default(props.sharedProps)
      }
      return []
    }

    /** 收集宿主锚点；非 SlotAnchor 的普通内容保持原样并参与排序 */
    function collectHostItems(): SlotComposerItem[] {
      const out: SlotComposerItem[] = []
      const walk = (nodes: VNodeChild[] | VNodeArrayChildren): void => {
        for (const n of nodes as VNodeChild[]) {
          if (!isVNode(n)) continue
          if (n.type === Fragment) {
            walk(n.children as VNodeArrayChildren)
            continue
          }
          if (n.type === Comment) continue
          if (n.type === SlotAnchor) {
            const p = n.props as {
              id?: unknown
              order?: unknown
              before?: unknown
              after?: unknown
            } | null
            const id = p && typeof p.id === 'string' ? p.id : ''
            if (!isSlotItemId(id)) {
              if (!warned.has('bad-anchor:' + id)) {
                warned.add('bad-anchor:' + id)
                console.warn(
                  '[SlotComposer] SlotAnchor 的 id 必须是 owner/name 形式（如 host/agent）；收到：' + id,
                )
              }
              continue
            }
            out.push({
              id,
              order: typeof p?.order === 'number' ? p.order : FALLBACK_ORDER,
              ...(typeof p?.before === 'string' ? { before: p.before } : {}),
              ...(typeof p?.after === 'string' ? { after: p.after } : {}),
              component: undefined,
              source: 'host',
              content: anchorContent(n),
            })
            continue
          }
          // 普通内容：用一个匿名条目参与排序，不会意外消失
          out.push({
            id: 'host/anonymous-' + out.length,
            order: FALLBACK_ORDER,
            component: undefined,
            source: 'host',
            content: [n],
          })
        }
      }
      const children = slots.default ? slots.default() : []
      walk(children)
      return out
    }

    function report(issue: SlotOrderIssue): void {
      const key = issue.kind + ':' + issue.id + ':' + (issue.target ?? '')
      if (warned.has(key)) return
      warned.add(key)
      console.warn(
        '[SlotComposer] ' + props.slot + ' 排序问题：' + issue.kind + ' id=' + issue.id +
          (issue.target ? ' target=' + issue.target : '') + '（已按 order 兜底）',
      )
    }

    function renderItem(item: SlotComposerItem): VNodeChild {
      if (item.source === 'host') {
        // 锚点内容直接展开（不包额外 DOM）：多根时用 Fragment，单根时原样返回
        const raw = item.content ?? []
        const content = Array.isArray(raw) ? raw : [raw]
        const first = content.find((c) => isVNode(c) && c.type !== Comment)
        if (content.filter((c) => isVNode(c) && c.type !== Comment).length === 1 && isVNode(first)) {
          // 单根锚点：把身份合并到原元素上（不新增 DOM，仍可在检查器里定位顺序）
          return cloneVNode(first, { 'data-slot-item': item.id }, true)
        }
        return h(Fragment, { key: item.id }, content)
      }
      const extra = (props.itemProps as
        | ((entry: SlotComposerEntry & { component: unknown }) => Record<string, unknown> | undefined)
        | undefined)?.(item)
      if (props.itemProps && extra === undefined) return null
      return h(markRaw(item.component as Component), {
        key: item.id,
        ...(props.itemClass ? { class: props.itemClass } : {}),
        // 身份走下发给组件的普通 prop；同时用 aria/data 不行：多根组件会吞掉并触发 Vue warn。
        slotItem: item.id,
        ...(props.sharedProps ?? {}),
        ...(extra ?? {}),
      })
    }

    return () => {
      const hostItems = collectHostItems()
      // 宿主锚点在前：同 id 时本地赢
      const merged: SlotComposerItem[] = [
        ...hostItems,
        ...plugins.value.map((p) => ({
          ...p,
          component: p.component,
          source: 'plugin' as const,
        })),
      ]
      const { items } = orderSlotItems(merged, { onIssue: report })
      const nodes: VNodeChild[] = []
      for (const item of items) {
        const node = renderItem(item)
        if (node) nodes.push(node)
      }
      // 根容器：外壳（底栏/状态条/页签行）需要 flex 布局，没有真实根就排不出来。
      // class / role 等由使用方通过 attrs 传入（本组件 inheritAttrs: false）。
      return h('div', { class: 'slot-composer flex items-center gap-1', ...attrs }, nodes)
    }
  },
})
</script>
