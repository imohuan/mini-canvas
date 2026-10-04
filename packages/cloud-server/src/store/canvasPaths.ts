/**
 * 画布路径推导与安全校验（纯函数，零依赖）。
 *
 * 布局：`<root>/canvases/<canvasId>/` 下放
 *   canvas.json（画布本体） · view.json（视图状态） · history.json（任务记录） · resources/（资源）
 *
 * 为什么要单独一层：路径拼接散在各处时，一处漏了 `..` 就是目录穿越。
 * 这里把「拼路径」与「查安全」绑在一起 —— 拿到路径就说明 id 已经过校验。
 */
import path from 'node:path'

/** 默认画布 id（前端界面当前只有一张画布） */
export const DEFAULT_CANVAS_ID = 'default'

/**
 * 画布 id 白名单：字母 / 数字 / 下划线 / 连字符，1-64 位。
 *
 * 点号**不在**表内，所以 `.` 与 `..` 天然被拒；斜杠也不在，所以拼不出子目录。
 * 与其在黑名单里追着 `..` 跑，不如只放行确定安全的那几个字符。
 */
const CANVAS_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeCanvasId(id: string): boolean {
  return CANVAS_ID_RE.test(id)
}

function assertSafe(id: string): void {
  if (!isSafeCanvasId(id)) throw new Error('[canvasPaths] 非法画布 id: ' + id)
}

/** 全部画布的父目录（列目录用；不涉及具体 id） */
export function canvasesRoot(root: string): string {
  return path.join(root, 'canvases')
}

/** 某个画布的目录 */
export function canvasDir(root: string, id: string): string {
  assertSafe(id)
  return path.join(canvasesRoot(root), id)
}

/**
 * 三个数据文件的路径。
 * `which` 是闭合词表（不是任意文件名）—— 调用方传不进来自外部的字符串，杜绝任意路径写入。
 */
export function canvasFilePath(root: string, id: string, which: 'canvas' | 'view' | 'history'): string {
  const file = which === 'canvas' ? 'canvas.json' : which === 'view' ? 'view.json' : 'history.json'
  return path.join(canvasDir(root, id), file)
}

/** 某个画布的资源目录 */
export function canvasResourcesDir(root: string, id: string): string {
  return path.join(canvasDir(root, id), 'resources')
}
