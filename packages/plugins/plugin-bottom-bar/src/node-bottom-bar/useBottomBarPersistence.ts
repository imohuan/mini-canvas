import type { ComputedRef, Ref } from 'vue'
import type { CanvasRenderContext } from '@plume-canvas/canvas-render'
import { promptDocPersistFields, promptPersistFields } from '../promptPersist'

interface PersistDeps {
  ctx: CanvasRenderContext['ctx']
  props: { id: string; data: Record<string, unknown> }
  currentId: Ref<string>
  values: Ref<Record<string, unknown>>
  storedActionId: ComputedRef<string | undefined>
  showEditor: ComputedRef<boolean>
  promptBinding: ComputedRef<'none' | 'text'>
  /** 对话模式：输入框内容存 barPrompt（与节点正文 data.text 解耦） */
  conversation?: ComputedRef<boolean>
  prompt: Ref<string>
  promptDoc: Ref<unknown>
}

/**
 * 把一份值化成「顺序无关」的稳定形状（对象键排序、undefined → null）。
 *
 * 为什么需要它：barValues 是每次 spread 出来的新对象，键顺序可能和存档里的不同；
 * 直接 JSON.stringify 会把「内容一样、顺序不同」判成变化，写盘守门就失效了。
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(src).sort()) out[key] = canonical(src[key])
    return out
  }
  return value === undefined ? null : value
}

/**
 * 这次要写的每个字段，节点里是不是**已经就是这些值**。
 *
 * 只要有一个不同就返回 false（照常写）；全部相同返回 true（跳过写）。
 *
 * 为什么必须有这道守门（用户 2026-11-26 实测无限请求）：
 * 底栏每 400ms 把 barValues / barPrompt / barPromptDoc 整块写回节点，哪怕内容一个字没变 ——
 * 而内核每次写都会换一个全新的 data 对象。上游素材、正文标签、动作文案全都盯着 data，
 * 于是「写盘 → 数据换新 → 全部重算 → 编辑器 emit 一次相同内容 → 再写盘」转成死循环：
 * 一秒两三轮请求，图片、缩略图、/api/actions/labels 全部被反复打。
 */
export function samePersistPatch(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown>,
): boolean {
  const cur = current ?? {}
  for (const key of Object.keys(patch)) {
    if (JSON.stringify(canonical(cur[key])) !== JSON.stringify(canonical(patch[key]))) return false
  }
  return true
}

/** 把当前参数与提示词落一份到节点 data（含 400ms 防抖与卸载 flush）。 */
export function useBottomBarPersistence(deps: PersistDeps) {
  function persistValues(): void {
    const rawStored = deps.ctx.tryGet<{
      getNode(id: string): { data?: Record<string, unknown> } | undefined
    }>('doc')?.getNode(deps.props.id)?.data?.barValues as Record<string, unknown> | undefined
    const storedAction = deps.storedActionId.value
    const onlyActionId =
      !rawStored || (Object.keys(rawStored).length > 0 && Object.keys(rawStored).every((k) => k === 'actionId'))
    // 对话模式（文本节点 agent:chat）没有底栏动作，showEditor 恒为 false，
    // 但输入框内容同样要落盘（barPrompt）—— 用户 2026-11-10：发送后输入框不能丢。
    const storedValues = deps.props.data?.barValues as { actionId?: unknown } | undefined
    /** 同一个判定要认两处：节点类型（对话模式）或节点数据里的动作 id（挂载首拍还没有类型） */
    const conversation =
      deps.conversation?.value === true || storedValues?.actionId === 'agent:chat'
    /**
     * 「参数没变」的快返只对**非对话**模式成立。
     *
     * 对话模式的 barValues 永远只有 actionId 一项，于是 storedAction === currentId
     * 且 onlyActionId 恒为真 —— 原来这行直接 return，barPrompt 一次都没写进节点
     * （用户实测：画布里 barPrompt 一直停在上一次的值，输入框重挂载就被旧值顶掉）。
     */
    if (!conversation && storedAction === deps.currentId.value && onlyActionId) return
    if (!conversation && !deps.showEditor.value && Object.keys(deps.values.value).length === 0) return
    const data = {
      barValues: { ...deps.values.value, actionId: deps.currentId.value },
      ...(conversation
        ? promptPersistFields('none', deps.prompt.value)
        : deps.showEditor.value
          ? promptPersistFields(deps.promptBinding.value, deps.prompt.value)
          : {}),
      ...(conversation && deps.promptDoc.value
        ? promptDocPersistFields(deps.promptDoc.value)
        : deps.showEditor.value && deps.promptDoc.value
          ? promptDocPersistFields(deps.promptDoc.value)
          : {}),
    }
    try {
      const doc = deps.ctx.get<{
        getNode(id: string): { data?: Record<string, unknown> } | undefined
        updateNode(id: string, patch: { data: Record<string, unknown> }): void
      }>('doc')
      // 内容没变就绝不写：一次多余的写会让 data 换新对象，进而触发整条重算链（见 samePersistPatch）。
      if (samePersistPatch(doc.getNode(deps.props.id)?.data, data)) return
      doc.updateNode(deps.props.id, { data })
    } catch {
      /* 节点已不在等情况：忽略 */
    }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null
  function persistValuesSoon(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      persistTimer = null
      persistValues()
    }, 400)
  }

  function flushPersistValues(): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = null
    persistValues()
  }

  return { persistValues, persistValuesSoon, flushPersistValues }
}
