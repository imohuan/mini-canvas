/**
 * 任务脚本用的「后缀 → 内容类型」表。
 *
 * 脚本跑在**独立子进程**里（见 runner.ts 的说明），拿不到宿主模块，所以这张表要在启动前
 * 序列化过去。但它的**判定规则**必须只有一份 —— 这里逐项问 canvas-data 的 mediaTypeOfName，
 * 不在脚本里另抄一张后缀清单（抄一份就一定会和 .mkv / .flac 这类新后缀分家）。
 */
import { mediaTypeOfName } from '@plume-canvas/canvas-data'

/** 已知会出现的产物后缀（认不出的按图片处理，与 mediaTypeOfName 的兜底一致） */
const KNOWN_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'svg',
  'mp4', 'webm', 'mov', 'm4v', 'mkv',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus',
  'txt', 'md', 'json', 'csv',
]

/** 形如 { '.mp4': 'video', '.flac': 'audio', … } —— 给引导代码注入用 */
export function mediaTypeByExt(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ext of KNOWN_EXTS) out['.' + ext] = mediaTypeOfName('x.' + ext)
  return out
}
