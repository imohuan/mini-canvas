/**
 * 项目页的插件页签（app.projects.tabs）。
 *
 * 为什么要有这一层：项目页上的插件不该只挤在内容底部的一排卡片里。插件注册的是一整页，
 * 宿主把它变成左栏的一条页签，点开就是整块主内容区 —— 与「项目 / 资产」同一套切换手感。
 *
 * 槽位契约（插件侧）：
 *   ctx.slots.register('app.projects.tabs', {
 *     id: 'style-library/projects-tab',
 *     order: 20,
 *     component: markRaw(StyleLibraryView),   // 整页正文
 *     meta: { title: '素材库', icon: SparklesIcon },
 *   })
 *
 * 同一个插件想在画布模式下用浮层，就把同一个组件再注册进画布 overlay 槽；
 * 组件自己按「有没有 doc」决定是整页还是浮层（见 plugin-style-library 的用法）。
 */
import { computed, onBeforeUnmount, ref, watch, type Component, type Ref } from 'vue'
import { useCanvasContextOrRender } from '@mini-canvas/canvas-render'

/** 页签槽名：项目页左栏（插件整页） */
export const PROJECTS_TABS_SLOT = 'app.projects.tabs'

export interface ProjectsTabMeta {
  /** 左栏页签文字（2～6 个字最稳） */
  title: string
  /** 左栏页签图标（lucide 组件） */
  icon?: Component
  /** 一句话说明（页签右侧悬浮提示用） */
  hint?: string
  /**
   * 正文要不要由宿主包一层纵向滚动。
   *
   * 默认 true（页签内容是一整页，交给宿主滚）；素材库这种「自己撑满高度、内部再滚」
   * 的页面传 false，否则会出现两条滚动条。
   */
  scroll?: boolean
  /**
   * 正文是否要顶到主内容区的左右边缘（素材墙这类整页铺满）。
   * 默认 false：保留 24px 左右内边距，与项目卡片对齐。
   */
  fullBleed?: boolean
}

export interface ProjectsTabEntry {
  id: string
  order: number
  component: Component
  meta: ProjectsTabMeta
}

/**
 * 读左栏页签。
 *
 * 为什么订阅 slots 注册表而不是只读一次：插件是热装的（「设置 → 插件」里装完立刻生效），
 * 只读一次的话新装的插件页签要刷新页面才出现。
 */
export function useProjectsTabs(): Ref<ProjectsTabEntry[]> {
  const { ctx } = useCanvasContextOrRender()
  const tabs = ref<ProjectsTabEntry[]>([])

  function reload(): void {
    tabs.value = ctx.slots
      .occupants(PROJECTS_TABS_SLOT)
      .map((oc) => {
        const meta = (oc.meta ?? {}) as Partial<ProjectsTabMeta>
        if (typeof meta.title !== 'string' || !meta.title) return null
        return {
          id: oc.id,
          order: oc.order,
          component: oc.component as Component,
          meta: {
            title: meta.title,
            ...(meta.icon ? { icon: meta.icon } : {}),
            ...(meta.hint ? { hint: meta.hint } : {}),
            ...(meta.scroll !== undefined ? { scroll: meta.scroll } : {}),
            ...(meta.fullBleed ? { fullBleed: true } : {}),
          },
        }
      })
      .filter((t): t is ProjectsTabEntry => t !== null)
  }

  reload()

  const disposers: Array<{ dispose(): void }> = []
  disposers.push(
    ctx.on('ctx:plugin-installed', reload),
    ctx.on('ctx:plugin-uninstalled', reload),
  )
  const slotRegistry = ctx.get<{ subscribe(cb: () => void): () => void }>('slots')
  if (slotRegistry && typeof slotRegistry.subscribe === 'function') {
    disposers.push({ dispose: slotRegistry.subscribe(reload) })
  }
  onBeforeUnmount(() => {
    for (const d of disposers) d.dispose()
  })

  return tabs
}

/**
 * 页签对应的正文。
 *
 * 用「当前选中 id」算而不是保存组件实例：卸载插件后该页签消失，正文自动回到 undefined，
 * 宿主就能退回「项目」页，不留一块渲染着已卸载插件的空白。
 */
export function activeProjectsTab(
  tabs: Ref<ProjectsTabEntry[]>,
  activeId: Ref<string>,
): Ref<ProjectsTabEntry | undefined> {
  const active = computed(() => tabs.value.find((t) => t.id === activeId.value))
  watch(
    tabs,
    (list) => {
      // 只处理「选中的插件被卸载」这一种情况：退回项目页，不要自动跳到别的插件。
      if (activeId.value && !list.some((t) => t.id === activeId.value)) activeId.value = ''
    },
    { immediate: true },
  )
  return active
}
