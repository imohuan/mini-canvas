/**
 * 媒体预览打开时锁 body 滚动，关闭时**恢复原值**。
 *
 * 为什么记原值而不是关闭时写 ""：预览常常叠在别的弹窗上（资产/历史/对话框），
 * 那些弹窗正锁着滚动（body.overflow = hidden）。预览关掉就写 ""，等于把底下的
 * 弹窗也一起解锁 —— 用户能在弹窗背后滚动画布。恢复原值才是正确语义。
 */
export function useBodyScrollLock() {
  /**
   * 打开前 body 的 overflow（null = 我们没锁）。
   */
  let overflowBeforeOpen: string | null = null

  function lockBodyOverflow(): void {
    if (typeof document === "undefined" || overflowBeforeOpen !== null) return
    overflowBeforeOpen = document.body.style.overflow
    document.body.style.overflow = "hidden"
  }

  function restoreBodyOverflow(): void {
    if (typeof document === "undefined" || overflowBeforeOpen === null) return
    document.body.style.overflow = overflowBeforeOpen
    overflowBeforeOpen = null
  }

  return { lockBodyOverflow, restoreBodyOverflow }
}

