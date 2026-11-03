/**
 * 浮层互斥：同一时刻只允许一个下拉 / 弹出面板开着。
 *
 * 为什么住在组件库、而不是业务调用点：
 * 以前「只开一个」分散在三处 —— Agent 输入区手写 6 键互斥表、画布底栏的 Select 与
 * ToolParamGroup 的 Popover 各自 `ref(false)`、组件库根组件什么都不管。
 * 结果就是模型下拉与比例面板能同时挂着（用户截图 2026-11-03）。
 * 互斥是所有浮层共有的约束，必须由根组件统一执行，业务侧不需要再记这条规矩。
 *
 * 为什么是模块级 Set、不写进 `<script setup>`：
 * `<script setup>` 的顶层代码会被编译进 setup()，每个实例一份「模块级」变量，
 * 登记表在实例之间不通，互斥直接失效（旧实现在别处踩过这个坑）。
 *
 * **二级菜单不参与**：它由 reka 的 MenuSub 管理，打开子菜单不能关掉父菜单。
 * 这里只登记一级浮层（DropdownMenu / Select / Popover / Combobox 的内容层）。
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
  for (const other of [...openEntries]) {
    if (other === entry) continue
    // 自己是从它里面弹出来的（比如参数面板里的下拉）→ 不关父级
    if (entry.chain.includes(other.token)) continue
    // 先摘再关：close() 在真实组件里是异步生效的（open=false 下一帧才走 watch），
    // 立刻摘掉可以避免同一次 claim 里重复关同一个浮层。
    openEntries.delete(other)
    other.close()
  }
  openEntries.add(entry)
}

/** 关闭自己：从登记表摘掉（幂等）。 */
export function releaseExclusive(entry: OpenEntry): void {
  openEntries.delete(entry)
}

/** 全关（拖拽 / 缩放这类「环境变了」的时刻用）。 */
export function closeAllExclusives(): void {
  const entries = [...openEntries]
  // 先清空再逐个关：close() 在真实浮层里是异步走 watch 摘除的，
  // 同步清表可以保证「全关」返回时登记表一定是空的。
  openEntries.clear()
  for (const entry of entries) entry.close()
}

/** 当前开着的浮层数（测试 / 调试用）。 */
export function openExclusiveCount(): number {
  return openEntries.size
}

/**
 * 把某个浮层的开合接到登记表上。
 *
 * 同时给插槽内容 provide 一条浮层链：面板里再开下拉时，子浮层能认出父级并豁免它。
 *
 * @param open  该浮层是否打开（reka 根组件 context 里的 open ref）
 * @param close 关闭自己（reka 根组件 context 里的 onOpenChange(false)）
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
  watch(
    () => props.open,
    (value) => {
      if (typeof value === 'boolean') local.value = value
    },
  )
  return computed({
    get: () => local.value,
    set: (value: boolean) => {
      local.value = value
      emit(value)
    },
  })
}
