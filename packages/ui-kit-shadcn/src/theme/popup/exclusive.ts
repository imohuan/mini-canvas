/**
 * 浮层互斥：同一时刻只允许一个下拉 / 弹出面板开着。
 *
 * 为什么需要它（2026-11-04 在真实画布实测）：
 * 取消互斥后，底栏「模型下拉」开着时点「参数下拉」，两个浮层会**同时可见**。
 * 原因是点对方按钮的那一下由对方组件自己接收（非模态），而先开的那个并不知道。
 * reka 自带的“点外面关闭”只覆盖“点到空白处”，不覆盖“点到另一个浮层的触发器”。
 *
 * 所以这层只管一件事：**打开新的，把旧的关掉**。点外面 / Esc 仍由组件自己做。
 *
 * 二级菜单不参与：它由 reka 的 MenuSub 管理，打开子菜单不能关掉父菜单。
 */
import { computed, inject, onScopeDispose, provide, ref, watch, type Ref } from 'vue'

interface OpenEntry {
  /** 这个浮层的身份（用它判祖先 / 兄弟） */
  token: object
  /** 自己 + 所有祖先浮层的 token */
  chain: object[]
  close: () => void
}

const openEntries = new Set<OpenEntry>()

/** 浮层链：谁在谁里面打开的。用来豁免祖先，不让子浮层关掉父浮层。 */
const POPUP_CHAIN_KEY = Symbol('mini-canvas:popup-chain')

/** 打开自己：先关掉其它还开着的浮层，再登记自己。 */
export function claimExclusive(entry: OpenEntry): void {
  /*
   * 先把自己登记进去，再关别人。
   *
   * 顺序很关键（2026-11-04 实测踩到）：如果先关旧的再登记新的，旧浮层收到 close 后会走一次
   * `releaseExclusive` / 自己的 open=false；若那次变更回写晚于新浮层的 claim，就会把新浮层一起关掉。
   * 先登记新的一笔，关旧的时候表里已经有“当前赢家”，新浮层不会被误伤。
   */
  openEntries.add(entry)
  for (const other of [...openEntries]) {
    if (other === entry) continue
    // 自己是从它里面弹出来的（比如参数面板里的下拉）→ 不关父级
    if (entry.chain.includes(other.token)) continue
    // 先摘再关：close() 是异步生效的（open=false 下一帧才走 watch），
    // 立刻摘掉可以避免同一次 claim 里重复关同一个浮层。
    openEntries.delete(other)
    other.close()
  }
}

/** 关闭自己：从登记表摘掉（幂等）。 */
export function releaseExclusive(entry: OpenEntry): void {
  openEntries.delete(entry)
}

/**
 * 把某个浮层的开合接到登记表上。
 *
 * 同时给插槽内容 provide 一条浮层链：面板里再开下拉时，子浮层能认出父级并豁免它。
 */
export function usePopupExclusive(open: Ref<boolean>, close: () => void): void {
  const token = {}
  const parentChain = inject<object[]>(POPUP_CHAIN_KEY, [])
  const chain = [...parentChain, token]
  provide(POPUP_CHAIN_KEY, chain)
  const entry: OpenEntry = { token, chain, close }

  watch(
    open,
    (value) => {
      if (value) claimExclusive(entry)
      else releaseExclusive(entry)
    },
    { immediate: true },
  )
  onScopeDispose(() => releaseExclusive(entry))
}

/**
 * 把 reka 根组件的「非受控开合」转成受控，好让互斥表能主动关掉它。
 *
 * 调用方仍可传 `v-model:open`；父级 prop 变化会同步进来。
 * 没有传 `open` 时用它自己的 `defaultOpen` 作为初值。
 */
export function usePopupOpenState(
  props: { open?: boolean; defaultOpen?: boolean },
  emit: (value: boolean) => void,
): Ref<boolean> {
  const local = ref<boolean>(props.open ?? props.defaultOpen ?? false)
  /**
   * 外部把 `open` 从 false 改成 true 时，必须同步进内部。
   *
   * 为什么（2026-11-05 实测）：计算属性只读 `local`，初始化时读了一次 props.open 就不再管；
   * 行右键（RowMenuShell.openAt 直接写 open=true）属于「外部打开」，结果菜单组件的
   * aria-expanded 已经是 true，面板却始终不渲染 —— 用户看到的就是「右键菜单没有反应」。
   * 只在值真的变化时写，避免和下面的 emit 互相触发。
   */
  watch(
    () => props.open,
    (value) => {
      if (typeof value === 'boolean' && value !== local.value) local.value = value
    },
    // 立即对齐一次：父级可能在建实例之前就把 open 设成 true（例如弹窗里先挂载再显示）。
    { immediate: true },
  )
  return computed({
    get: () => local.value,
    set: (value: boolean) => {
      local.value = value
      /**
       * 只在**用户真正改变**开合时才通知外面。
       *
       * 为什么（2026-11-04 实测踩到）：互斥表关闭旧浮层时会写 `open=false`，
       * 如果这里无条件 emit，外部监听（例如业务侧 v-model）会把这次“被动关闭”
       * 当成用户操作再走一遍，和刚打开的新浮层互相覆盖，表现为“切到 B 时两个都关”。
       */
      if (value !== props.open) emit(value)
    },
  })
}
