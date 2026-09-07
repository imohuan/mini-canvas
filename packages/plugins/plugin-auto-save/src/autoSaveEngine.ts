/**
 * autoSaveEngine —— 定时自动保存引擎（纯逻辑，零 Vue/DOM，可单测）。
 *
 * 复刻老版 canvas-core/src/plugins/auto-save 的"interval 定时保存"：
 * - 有一个脏位（dirty）：外部(插件订阅画布数据变化)调 markDirty() 置脏；
 * - 引擎按 interval 周期轮询：若脏且 enabled → 调注入的 flush() 落盘并复位脏位；
 * - 暴露 pause()/resume()/saveNow()/dispose()，供插件 enable/disable、页面隐藏时收尾。
 *
 * v2 分工（薄适配包）：
 * - CanvasHost 已做 visibilitychange/pagehide 的即时 flush（宿主层，不属本包）；
 * - SaveService 的 set→防抖 flush 已内置（见 services/storage/SaveService.ts）；
 * - 本包只补老版独有的「周期性兜底保存」语义：即使没有 hidden 事件，也保证每 interval
 *   把脏数据落盘一次。因此对宿主 SaveService 依赖是「有就周期 flush，没有则 no-op」。
 */
export interface AutoSaveEngineOptions {
  /** 轮询间隔(ms)，默认 1000 */
  interval?: number
  /** 初始是否启用，默认 true */
  enabled?: boolean
  /** 注入的落盘函数（宿主 SaveService.flush）；返回 Promise */
  flush: () => Promise<unknown>
  /** 注入的脏查询（宿主 SaveService.isDirty 之类）；缺省恒 false */
  isDirty?: () => boolean
}

export interface AutoSaveEngine {
  /** 当前是否启用定时保存 */
  isEnabled(): boolean
  /** 是否有未落盘的脏数据（来源：外部 markDirty 或注入 isDirty） */
  isDirty(): boolean
  /** 启用/停用定时保存。停用不清脏位，恢复后若仍脏会在下个周期落盘 */
  setEnabled(v: boolean): void
  /** 手动立即落盘（外部 flush 事件/页面隐藏/命令）；dirty 与否都执行 */
  saveNow(): Promise<void>
  /** 外部标记数据已变更（订阅 nodeStore/edgeStore 变化时调） */
  markDirty(): void
  /** 停止计时器并释放（插件卸载时调；幂等） */
  dispose(): void
}

/** 默认脏查询：调用方未给 isDirty 时，引擎只认自己 markDirty 置的脏位 */
const neverDirty = () => false

export function createAutoSaveEngine(opts: AutoSaveEngineOptions): AutoSaveEngine {
  const intervalMs = opts.interval ?? 1000
  let enabled = opts.enabled ?? true
  let dirty = false
  let timer: ReturnType<typeof setInterval> | null = null
  const dirtyQuery = opts.isDirty ?? neverDirty

  function start(): void {
    if (timer !== null || !enabled) return
    timer = setInterval(() => {
      void tick()
    }, intervalMs)
    // node 测试环境无 setInterval 自动 unref；vitest fake/real timer 均 OK
  }

  function stop(): void {
    if (timer === null) return
    clearInterval(timer)
    timer = null
  }

  async function tick(): Promise<void> {
    if (!enabled) return
    if (!dirty && !dirtyQuery()) return
    dirty = false
    try {
      await opts.flush()
    } finally {
      // 落盘期间若又有新变更（dirty 被再次置位），保持脏 → 下个周期再落
    }
  }

  // 初始即启用 → 立即开表（测试用 fake timers 也能捕捉）
  if (enabled) start()

  return {
    isEnabled: () => enabled,
    isDirty: () => dirty || dirtyQuery(),
    setEnabled(v: boolean) {
      enabled = v
      if (v) start()
      else stop()
    },
    async saveNow() {
      dirty = false
      await opts.flush()
    },
    markDirty() {
      dirty = true
    },
    dispose() {
      stop()
      dirty = false
    },
  }
}
