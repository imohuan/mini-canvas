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
  defineComponent,
  h,
  isVNode,
  markRaw,
  onBeforeUnmount,
  shallowRef,
  type Component,
  type PropType,
  type VNode,
  type VNodeArrayChildren,
  type VNodeChild,
} from 'vue'
import { orderSlotItems, type SlotOrderIssue } from '@mini-canvas/kernel'
import { useCanvasContext } from '../contracts/canvasContext'
import SlotAnchor from './SlotAnchor.vue'
import { isSlotItemId } from '@mini-canvas/kernel'
import type { SlotComposerEntry } from './slotComposer'

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
    /** 插槽调试：描边 + 显示插槽名 / 条目 id（由设置项 slotDebug 控制） */
    debug: { type: Boolean, default: false },
    /** 槽名在 UI 上的简称（缺省用 slot 全名） */
    label: { type: String, default: undefined },
    /**
     * 调试标签的悬浮面板组件（可选）。
     * 宿主可传 AxTooltip / AxDropdown 这类浮层；不传则用浏览器原生 title 兜底。
     * 组件契约：接收 content（字符串）与默认插槽（触发元素）。
     */
    debugTip: { type: [Object, Function] as PropType<Component | null>, default: null },
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
        // 锚点内容用 Fragment 原样展开：不生成 DOM，也不会把子节点合并/改写成别的元素。
        // 不要对单根 cloneVNode 合并 class/attrs —— 会把 Tailwind class 拼串，
        // 也会在组件根上丢失 data-*（2026-10-28 设置左树/底栏实测）。
        const raw = item.content ?? []
        const content = Array.isArray(raw) ? raw : [raw]
        // 宿主锚点：调试时把"条目身份 + 排序信息"作为一条标签放在内容前
        if (!props.debug) return h(Fragment, { key: item.id }, content)
        return h(Fragment, { key: item.id }, [slotDebugItemDot(item, 'host'), ...content])
      }
      const extra = (props.itemProps as
        | ((entry: SlotComposerEntry & { component: unknown }) => Record<string, unknown> | undefined)
        | undefined)?.(item)
      // itemProps 返回 undefined = 这一项只参与排序、不渲染（如设置左树只认分组名）
      if (props.itemProps && extra === undefined) return null
      const node = h(markRaw(item.component as Component), {
        key: item.id,
        ...(props.itemClass ? { class: props.itemClass } : {}),
        // 身份走下发给组件的普通 prop；同时用 aria/data 不行：多根组件会吞掉并触发 Vue warn。
        slotItem: item.id,
        'data-slot-id': item.id,
        'data-slot-order': item.order,
        ...(item.before !== undefined ? { 'data-slot-before': item.before } : {}),
        ...(item.after !== undefined ? { 'data-slot-after': item.after } : {}),
        ...(props.sharedProps ?? {}),
        ...(extra ?? {}),
      })
      // 插件条目：调试时在组件前面放一条身份/排序标签
      if (!props.debug) return node
      return h(Fragment, { key: item.id + ':debug' }, [slotDebugItemDot(item, 'plugin'), node])
    }

    /**
     * 条目小圆点：平时只显示一个色点（不挡内容），悬停展开完整信息。
     *
     * 为什么不再写整行文字：底栏条目很密，长标签会互相重叠、分不清谁是谁
     * （2026-10-28 用户实测截图）。改成一个点 + 悬浮面板，位置稳定、可读。
     */
    function slotDebugItemDot(item: SlotComposerItem, owner: 'host' | 'plugin'): VNode {
      const lines = [
        'id: ' + item.id,
        'order: ' + item.order,
        ...(item.before !== undefined ? ['before: ' + item.before] : []),
        ...(item.after !== undefined ? ['after: ' + item.after] : []),
        '来源: ' + (owner === 'host' ? '宿主内置' : '插件'),
      ]
      return debugDot('slot-debug-dot' + (owner === 'host' ? ' is-host' : ''), lines.join('\n'))
    }

    /**
     * 统一生成"小点 + 悬浮详情"。
     *
     * 有 debugTip（宿主传了浮层组件）就包一层；否则退回原生 title
     * —— 这样 canvas-render 不反向依赖 @mini-canvas/ui，自定义宿主也能用。
     */
    function debugDot(cls: string, title: string): VNode {
      const dot = h('span', { class: 'slot-debug-dot-inner', 'aria-hidden': 'true' })
      // 缺省不内置任何浮层：主题插件（plugin-theme-default）经 debug-tip 传默认件；
      // 没传时退回原生 title，保证极简宿主也能看见内容。
      const tip = props.debugTip
      if (!tip) {
        return h('span', { class: ['slot-debug-dot', cls], title, 'aria-hidden': 'true' }, [dot])
      }
      return h(
        'span',
        { class: ['slot-debug-dot', cls], 'data-slot-tip': '1' },
        [
          h(tip as Component, { content: title }, () => dot),
        ],
      )
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
      // 根容器：承载 attrs（class/role 等）。布局由使用方通过 class 指定：
      // 底栏/状态条是横向 flex，设置左树是纵向 flex —— 这里不能写死方向。
      // attrs 内的 class 与固定 class 合并，不能直接覆盖（否则使用方的布局会丢）。
      const userClass = (attrs.class as string | undefined) ?? ''
      const badge = props.debug
        ? debugDot(
            'is-slot',
            [
              '插槽: ' + props.slot,
              '名称: ' + (props.label ?? props.slot),
              '条目数: ' + nodes.length,
              '用法: ctx.slots.register(\'' + props.slot + '\', { id: \'插件名/条目\', before/after })',
            ].join('\n'),
          )
        : null
      return h(
        'div',
        {
          ...attrs,
          class: ['slot-composer', userClass, props.debug ? 'is-slot-debug' : ''],
          'data-slot': props.slot,
          'data-slot-count': nodes.length,
        },
        badge ? [badge, ...nodes] : nodes,
      )
    }
  },
})
</script>
