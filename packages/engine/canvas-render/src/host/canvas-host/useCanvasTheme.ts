import { markRaw, shallowRef, ref } from 'vue'
import { assembleTheme } from '../canvasHostCore'
import type { CanvasHostHandle } from '../createPlumeHost'

export function useCanvasTheme(hostRef: { value: CanvasHostHandle | undefined }) {
  // 组件句柄(opaque，来自 themeRegistry/registry)塞给 VueFlow 的 node-types/edge-types。
  // 必须用 shallowRef：里面存的是 .vue 组件对象，ref 会深代理组件触发 Vue "组件被 reactive 化" 警告，
  // 且我们总是整体替换 .value，浅层响应式就够。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodeTypes = shallowRef<Record<string, any>>({})
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgeTypes = shallowRef<Record<string, any>>({})
  // 背景也是组件句柄，同样浅层即可。
  const backgroundComp = shallowRef<unknown>(undefined)
  // 拖线临时连接线组件（connectionLine 槽赢家；未注册 undefined → ConnectionLineHost 回退默认线）。
  const connectionLineComp = shallowRef<unknown>(undefined)
  const edgeDefaultType = ref('custom')
  const nodeEpoch = ref(0) // 插件变更后 bump → 触发 VueFlow 子树重挂

  function applyTheme(): boolean {
    const h = hostRef.value
    if (!h) return false
    let typesChanged = false
    // P1-9：孤儿 type（有存量节点但类型已注销）也映射 BaseNode 壳 → 卸载插件后存量节点仍有占位渲染，
    // 数据不丢、插件重装后自动恢复（BaseNode 对无 content 的 type 显示占位文本）。
    // 第三个参数 = registryOf('node/shell') 场：设计文档 §4.5/案例 3/8 教作者用 add/wrap 换壳，
    // 不读它那些写法就"不报错也不生效"（作者最怕的静默失效）。解析优先级见 assembleTheme。
    const asm = assembleTheme(
      h.themeRegistry,
      [...h.nodeStore.types.keys(), ...h.nodeStore.orphanTypes()],
      h.ctx.registryOf<unknown>('node/shell'),
    )
    // markRaw 组件句柄：防止它们被 VueFlow/响应式系统 proxy，避免 Vue "组件被 reactive 化" 警告与性能损耗。
    // **结构 diff 后再写**：没变化就不替换引用 —— 一个插件装载会同时命中 4 个订阅源
    // （ctx:plugin-installed / themeRegistry / nodeRegistry / node/shell 场），每个都调 applyTheme；
    // 若每次都整体重置 nodeTypes/edgeTypes，引用全变 → VueFlow 全量重渲（对每条边重跑校验），
    // 启动装载 N 个插件 = 4N 次全量重渲（实测：日志爆发 200+ 条、画布闪烁、图片反复重载）。
    // 相同内容保持旧引用 = VueFlow 零更新，代价只是一次浅比较。
    const nextNodeTypes: Record<string, unknown> = {}
    for (const t of asm.nodeTypes) {
      const shell = asm.nodeShells[t]
      if (shell !== undefined && shell !== null) nextNodeTypes[t] = shell
    }
    const nextEdgeTypes: Record<string, unknown> = asm.edge ? { custom: asm.edge } : {}
    if (!shallowEqualMarks(nodeTypes.value, nextNodeTypes)) {
      nodeTypes.value = markRawAll(nextNodeTypes)
      typesChanged = true
    }
    if (!shallowEqualMarks(edgeTypes.value, nextEdgeTypes)) {
      edgeTypes.value = markRawAll(nextEdgeTypes)
      typesChanged = true
    }
    const nextEdgeDefault = asm.edgeDefaultType
    if (edgeDefaultType.value !== nextEdgeDefault) { edgeDefaultType.value = nextEdgeDefault; typesChanged = true }
    const nextBackground = asm.background ?? undefined
    if (backgroundComp.value !== nextBackground) { backgroundComp.value = nextBackground ? markRaw(nextBackground) : undefined; typesChanged = true }
    const nextConnLine = asm.connectionLine ?? undefined
    if (connectionLineComp.value !== nextConnLine) { connectionLineComp.value = nextConnLine ? markRaw(nextConnLine) : undefined; typesChanged = true }
    return typesChanged
  }

  /** 浅比较两个"组件句柄表"：键集合一致且每值同引用才算没变（markRaw 包装不改变比较对象，见 markRawAll） */
  function shallowEqualMarks(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false
      if (a[k] !== b[k]) return false
    }
    return true
  }

  /** 整表 markRaw：防组件句柄被 VueFlow/响应式系统 proxy */
  function markRawAll(table: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(table)) out[k] = markRaw(table[k] as object)
    return out
  }

  return {
    nodeTypes,
    edgeTypes,
    backgroundComp,
    connectionLineComp,
    edgeDefaultType,
    nodeEpoch,
    applyTheme,
  }
}
