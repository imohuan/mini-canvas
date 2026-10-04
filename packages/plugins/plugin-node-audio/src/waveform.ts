/**
 * waveform —— 音频波形的纯计算（零 DOM、零 Vue、Node 可单测）。
 *
 * 为什么单独一层：波形是**派生数据** —— 由音频解码结果算出来，算一次就存进节点
 * （`data.audioWaveform`），之后每次渲染都只读缓存、不再解码。所以它是纯函数：
 * 输入采样、输出定长数组，可以在无头环境里验到每个边界。
 *
 * 长度为什么固定 100：用户口径「最多也就是一个 100 个数字的数组」—— 定长既让写库/校验
 * 简单（长度不对就是脏数据），也让卡片能按桶直接画 100 根竖条。
 */

/** 桶数（= 存进节点的数字个数）。固定值：波形数据形状是契约的一部分。 */
export const WAVEFORM_BUCKETS = 100

/** 值域上限：每桶是 1..100 的整数百分比高度 */
export const WAVEFORM_MAX = 100

/**
 * 把一段交错采样（decodeAudioData 的 channel data，多声道时逐帧交错）桶化成给定数量的峰值。
 *
 * 每桶取**绝对最大值**而不是平均值：平均值会把瞬态（鼓点、爆破音）抹平成一条几乎看不见的线，
 * 而用户要的正是「哪里响」这件事。负半周取绝对值，多声道按帧取最大（左右反相时平均值会抵消成 0）。
 *
 * @param samples  采样（-1..1）
 * @param buckets  桶数（缺省 WAVEFORM_BUCKETS）
 * @param channels 声道数（缺省 1）；交错采样按帧分组取最大
 * @returns 长度恰为 buckets 的峰值数组（0..1）；采样为空时整条为 0
 */
export function bucketPeaks(samples: Float32Array | number[], buckets = WAVEFORM_BUCKETS, channels = 1): number[] {
  const size = Math.max(1, Math.floor(buckets))
  const ch = Math.max(1, Math.floor(channels))
  const frames = Math.floor(samples.length / ch)
  const out = new Array<number>(size).fill(0)
  if (frames <= 0) return out
  for (let b = 0; b < size; b++) {
    // 用比例定位桶边界而不是固定步长：最后一个桶一定能盖到采样末尾（不丢尾帧）
    const start = Math.floor((b * frames) / size)
    const end = Math.max(start + 1, Math.floor(((b + 1) * frames) / size))
    let peak = 0
    for (let f = start; f < end && f < frames; f++) {
      const base = f * ch
      for (let c = 0; c < ch; c++) {
        const v = Math.abs(Number(samples[base + c]) || 0)
        if (v > peak) peak = v
      }
    }
    out[b] = peak
  }
  return out
}

/**
 * 峰值（0..1）→ 百分比整数（1..WAVEFORM_MAX）。
 *
 * 为什么要保底 1 而不是允许 0：0 高度的桶在卡片上就是「断掉的一段」，静音段会看起来像波形丢失；
 * 留 1（1%）能画出连续的一条底线，也避免 SVG path 里出现零长度线段。
 * 全静音（峰值全 0）时不留 NaN：整条给 1。
 */
export function normalizeToPercent(peaks: number[]): number[] {
  const max = peaks.reduce((m, p) => (Number.isFinite(p) && p > m ? p : m), 0)
  if (max <= 0) return peaks.map(() => 1)
  return peaks.map((p) => {
    const ratio = Number.isFinite(p) ? Math.max(0, p) / max : 0
    const value = Math.round(ratio * (WAVEFORM_MAX - 1)) + 1
    return Math.min(WAVEFORM_MAX, Math.max(1, value))
  })
}

/**
 * 是不是一条可用的波形：长度恰为 WAVEFORM_BUCKETS、每个都是 1..WAVEFORM_MAX 的整数。
 * 节点 data 来自存档/别的插件，读之前先过这一道（脏数据当「没有波形」处理，不画错形状）。
 */
export function isValidWaveform(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== WAVEFORM_BUCKETS) return false
  return value.every((v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= WAVEFORM_MAX)
}

/** FNV-1a 32 位哈希（把地址折成一个种子） */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * 确定性回落波形：同一个 seed 永远得到同一条形状。
 *
 * 用在「解码拿不到数据」的场合（跨域、格式不支持、非浏览器环境）——给一条稳定的假波形，
 * 总比空白或每次刷新都换一个样子要好。**刻意不用 Math.random**：那样每次渲染都会变，
 * 用户会以为波形在抖。用线性同余 + 相邻混合，形状像音频（有起伏、不是噪声条）。
 */
export function fallbackWaveform(seed: string, buckets = WAVEFORM_BUCKETS): number[] {
  const size = Math.max(1, Math.floor(buckets))
  let state = hashSeed(seed || 'audio')
  const next = (): number => {
    // 线性同余（数值取自 Numerical Recipes），取高位当 0..1
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0xffffffff
  }
  const raw: number[] = []
  let previous = 0.5
  for (let i = 0; i < size; i++) {
    // 与上一个值混合：相邻桶相关 → 波形连贯，不会变成噪点
    const mixed = previous * 0.6 + next() * 0.4
    previous = mixed
    // 收在中段（0.15..0.95），太低的桶在卡片上几乎看不见
    raw.push(0.15 + mixed * 0.8)
  }
  return normalizeToPercent(raw)
}

