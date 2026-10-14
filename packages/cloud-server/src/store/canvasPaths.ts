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
 * **虚拟画布**的 id 前缀（画布 id 的第一段）。
 *
 * 谁用它：可视化节点的 canvas_fn_call —— 调用后台功能函数时不必让调用方传 Canvas ID / Node ID，
 * 于是工具自己造一张空画布顶上（脚本的 ctx 需要这两个字段来拼"回写画布"的地址）。
 *
 * 为什么要有这个前缀常量、而且**在列表里过滤掉它**：虚拟画布落在同一个数据目录里
 * （和真画布同一种文件），不过滤的话用户的项目 / 画布下拉框里会凭空多出一张
 * 「fn-probe-default」——那是给函数探针用的临时画布，不该出现在用户界面上。
 *
 * ⚠️ 这个常量在插件侧（plugin-node-ui）另有一份同名副本：插件是**外挂单文件后台**，
 *    不能 import 本包（见 pluginLoader 的 data: URL 说明）。两份由一条测试盯着一致 ——
 *    漂了的后果是"过滤不干净、虚拟画布冒进用户列表"，那是看得见的脏东西。
 */
export const VIRTUAL_CANVAS_PREFIX = 'fn-probe-'

/** 是不是虚拟画布（列表过滤 / 路由守卫都用这一条判据） */
export function isVirtualCanvasId(id: string): boolean {
  return id.startsWith(VIRTUAL_CANVAS_PREFIX)
}

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

// ==================== 项目 / 资产（2026-10-05 新增）====================
//
// 「项目 → 画布」在磁盘上表现为**索引关系**（画布文件夹路径不变，见 docs/design/project-canvas-assets.md）：
//   canvases/index.json  画布索引（带 projectId）
//   projects.json        项目注册表
// 资源（生成产物 + 自己上传）单独一个目录：
//   assets/index.json    资产登记
//   assets/files/<hash>  自己上传的字节

/** 项目 / 资产 id 白名单：与画布 id 同口径（字母数字下划线连字符，1-64 位） */
const ENTITY_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeEntityId(id: string): boolean {
  return ENTITY_ID_RE.test(id)
}

/** 项目注册表文件 */
export function projectsFile(root: string): string {
  return path.join(root, 'projects.json')
}

/** 画布索引文件（画布 id → 名字 / 所属项目 / 创建时间） */
export function canvasIndexFile(root: string): string {
  return path.join(canvasesRoot(root), 'index.json')
}

/** 资产目录 */
export function assetsDir(root: string): string {
  return path.join(root, 'assets')
}

/** 资产登记文件 */
export function assetsIndexFile(root: string): string {
  return path.join(assetsDir(root), 'index.json')
}

/** 自己上传的资产字节目录 */
export function assetsFilesDir(root: string): string {
  return path.join(assetsDir(root), 'files')
}

/** 资产文件名白名单：与画布资源同名（16 位十六进制 + 可选扩展名） */
export function isSafeAssetName(name: string): boolean {
  return /^[0-9a-f]{16}(\.[a-z0-9]+)?$/i.test(name)
}
