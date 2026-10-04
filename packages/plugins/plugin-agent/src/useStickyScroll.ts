/**
 * useStickyScroll —— 「流输出时自动吸底」的通用实现（与 Agent 业务**零耦合**）。
 *
 * 用户口径（2026-10-02）：
 *   1. 离底一定像素内 → 吸附底部；
 *   2. 与流输出绑定：新内容进来时判断要不要吸附；
 *   3. 无论一次吐多少（哪怕整段瞬间刷上来）都确保滚到底；
 *   4. 用户往上滚、超过吸附距离后**不再**吸附；
 *   5. 「监听流输出、再决定要不要滚」这种事件式做法，别把耦合写死。
 *
 * 设计（为什么这么拆）：
 *   - 它只认一个 DOM 元素 + 一个"内容变了"的**信号源**（getter），不认 Agent / 消息 / SSE。
 *     谁想用都能用：传个 ref 和 getter 进来即可。
 *   - **信号源用订阅式（getter + watch）**：调用方只在"流有新内容"时改一个计数，本组合式函数
 *     自己去 watch —— 于是「什么时候该滚」这件事只在本文件里，不与会话模型 / 传输层耦合。
 *   - **内容高度用 ResizeObserver 量**，不只看信号：流式增量会让已有气泡变高
 *     （比如长段落换行、图片撑开），那时信号可能没变、scrollHeight 却涨了。
 *     盯住内容容器的高度才能保证「吐多少都跟到底」。
 *   - **滚动合帧到一个 rAF**：一次吐一大段会连发很多次高度变化，逐次滚动既浪费又抖；
 *     合帧到下一帧只滚一次，落点永远是最新的底部。
 *   - 判定逻辑在 stickToBottomCore.ts（纯函数、可单测），本文件只管 DOM 与生命周期。
 *
 * 另暴露 scrollToBottom()，供「用户自己点了发送」这类"必须到底"的场景显式调用。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { isNearBottom } from './stickToBottomCore.js'

export interface StickyScrollOptions {
  /** 视口元素（滚动容器） */
  target: Ref<HTMLElement | null>
  /**
   * 「有新内容」的信号源：返回任意会变的值即可（通常是消息数或内容长度）。
   * 它变 → 本组合式函数判断要不要吸底。调用方不需要（也不该）知道这里有滚动逻辑。
   */
  signal: () => unknown
  /** 离底多少像素内算「贴着底部」（默认 48） */
  threshold?: number
}

export function useStickyScroll(opts: StickyScrollOptions) {
  const threshold = opts.threshold ?? 48
  /** 是否处于吸附状态（用户往上滚超出阈值就置 false） */
  const stuck = ref(true)
  let raf = 0
  let ro: ResizeObserver | undefined
  /**
   * 我们**自己**刚写进去的 scrollTop。
   *
   * 为什么需要它：`el.scrollTop = …` 也会触发 scroll 事件，若不区分，
   * `onUserScroll` 会把「我们刚滚到底」误判成「用户滚了」并重算吸附状态 ——
   * 而重算那一刻新内容往往刚把 scrollHeight 顶上去（离底显得很远），
   * `stuck` 就被自己的滚动关掉了。表现就是「吐得稍微多一点就不跟了」。
   */
  let programmaticTop = -1

  function metrics(): { el: HTMLElement; scrollTop: number; scrollHeight: number; clientHeight: number } | null {
    const el = opts.target.value
    if (!el) return null
    return { el, scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }
  }

  /** 同步吸附状态：只在用户自己的滚动里调用（内容变化引起的滚动不算） */
  function syncStuck(): void {
    const m = metrics()
    if (!m) return
    stuck.value = isNearBottom(m, threshold)
  }

  /** 立即滚到底（并保持吸附） */
  function scrollToBottom(): void {
    const el = opts.target.value
    if (!el) return
    stuck.value = true
    el.scrollTop = el.scrollHeight
    programmaticTop = el.scrollTop
  }

  /** 合帧滚动：一次内容突变可能触发多次，只滚最后一帧 */
  function scheduleScroll(): void {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      if (!stuck.value) return
      const el = opts.target.value
      // 这里**不**重算 stuck：这是内容增长引起的滚动，不是用户操作。
      // 若在这里重算，新内容刚把 scrollHeight 顶上去的一瞬间会被判成"离底很远"，
      // 吸附就会自己把自己关掉（表现为"滚到一半就不跟了"）。
      if (el) {
        el.scrollTop = el.scrollHeight
        programmaticTop = el.scrollTop
      }
    })
  }

  /** 用户往上滚：只在"用户自己滚"时更新吸附状态 */
  function onUserScroll(): void {
    const el = opts.target.value
    // 我们自己刚滚到的那一位（允许 ±2px 的亚像素误差）→ 不算用户操作。
    if (el && programmaticTop >= 0 && Math.abs(el.scrollTop - programmaticTop) <= 2) return
    programmaticTop = -1
    syncStuck()
  }

  watch(opts.signal, async () => {
    // 等 DOM 把新内容渲染出来再决定滚不滚（否则量到的还是旧的 scrollHeight）
    await nextTick()
    if (stuck.value) scheduleScroll()
  })

  /**
   * 观察**内容容器**（滚动容器的第一个子元素，Agent 面板里是 `.ac-inner`）
   * 而不是滚动容器本身：后者的 clientHeight 由面板高度定死、不随内容变，量它等于没量。
   * 内容容器也一并观察，覆盖"面板被拖宽/拖高"这种容器尺寸变化。
   */
  function observeInner(): void {
    const el = opts.target.value
    if (!ro || !el) return
    ro.disconnect()
    const inner = el.firstElementChild
    if (inner) ro.observe(inner)
    ro.observe(el)
  }

  /** 目前绑上监听的那个元素（换元素时要能解绑旧的，不然会越绑越多） */
  let boundEl: HTMLElement | null = null

  /** 绑定滚动 + 尺寸监听。可重复调用：元素换了会先解绑再绑新的。 */
  function bind(): void {
    const el = opts.target.value
    if (!el || el === boundEl) return
    boundEl?.removeEventListener('scroll', onUserScroll)
    el.addEventListener('scroll', onUserScroll, { passive: true })
    boundEl = el
    syncStuck()
    observeInner()
  }

  onMounted(() => {
    // 挂载这一刻滚动容器**可能还不存在**：面板在「未配模型 / 连不上后台 / 消息流」
    // 三态之间切换，只有第三种才渲染 .ac-scroll。所以这里不 return，
    // 而是靠下面的 watch 在它出现时补绑 —— 否则「配置好模型后打开面板」这种情况
    // 整个吸附功能会静默失效（实测过）。
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        if (stuck.value) scheduleScroll()
      })
    }
    bind()
  })

  // 滚动容器出现/换掉（三态切换）时补绑，并顺手重新观察新的内容容器
  watch(opts.target, () => bind())

  onBeforeUnmount(() => {
    cancelAnimationFrame(raf)
    raf = 0
    ro?.disconnect()
    ro = undefined
    boundEl?.removeEventListener('scroll', onUserScroll)
    boundEl = null
  })

  return { stuck, scrollToBottom, syncStuck, observeInner }
}
