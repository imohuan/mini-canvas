/**
 * 生成历史卡片上的文字格式化。
 *
 * 从 HistoryModal.vue 原样搬出：只做数字 → 文案的纯计算，不读写组件状态。
 */
export function mediaAspect(item: { media?: { width?: number; height?: number } }, fallback: number): string {
  const w = item.media?.width
  const h = item.media?.height
  return w && h && w > 0 && h > 0 ? w + ' / ' + h : String(fallback)
}

/** 字节数 → 人能读的大小（0 / 缺省返回空串，不显示） */
export function formatBytes(n?: number): string {
  if (!n || n <= 0) return ''
  const kb = 1024
  const mb = kb * 1024
  if (n >= mb) return (n / mb).toFixed(1) + ' MB'
  if (n >= kb) return Math.round(n / kb) + ' KB'
  return n + ' B'
}

/** 毫秒 → m:ss（缺省 / 非正数返回空串） */
export function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m + ':' + String(sec).padStart(2, '0')
}

/** 详情弹窗里的时长：带单位，超过一分钟说"X 分 Y 秒"，比 m:ss 更好读 */
export function formatDurationLong(ms?: number): string {
  if (!ms || ms <= 0) return ''
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const sec = total % 60
  return m > 0 ? m + ' 分 ' + sec + ' 秒' : sec + ' 秒'
}

/** 宽高 → 最简比（如 1086×1448 → 543:724；用最大公约数，不四舍五入成假比例） */
export function ratioLabel(w: number, h: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(Math.round(w), Math.round(h)) || 1
  return Math.round(w / g) + ':' + Math.round(h / g)
}

/** 完成时间：精确到分钟（卡片上只显示"多久前"，复盘要看具体时刻） */
export function formatExactTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
}

/** HTML 转义（卡片 DOM 用 innerHTML 拼，标题来自后台要防注入） */
export function esc(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
}
