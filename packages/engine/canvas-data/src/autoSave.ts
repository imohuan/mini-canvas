/**
 * autoSave —— 定时自动保存引擎（纯逻辑，零 Vue / 零 DOM）。
 *
 * 归属从 plugin-auto-save 收进 canvas-data：它描述的是 SaveService 的用法，
 * 不该占一个插件服务名。插件只负责把引擎挂到 save.autoSave 并在卸载时停表。
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
  /** 外部标记数据已变更（订阅 doc 变化时调） */
  markDirty(): void
  /** 停止计时器并释放（插件卸载时调；幂等） */
  dispose(): void
}

export interface AutoSaveService {
  isEnabled(): boolean
  isDirty(): boolean
  saveNow(): Promise<void>
  setEnabled(v: boolean): void
  readonly interval: number
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
    } catch (err) {
      /**
       * 落盘失败：**把脏位放回去**，下个周期还会重试；同时吞掉异常——
       * start() 里是 void tick()，没人接的 rejection 会刷控制台。
       */
      dirty = true
      console.warn('[auto-save] 定时落盘失败，下个周期重试', err)
    }
  }

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
      try {
        await opts.flush()
      } catch (err) {
        // 手动保存失败：把脏位放回去（调用方可以稍后再存），并吞掉异常。
        dirty = true
        console.warn('[auto-save] 手动落盘失败', err)
      }
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
