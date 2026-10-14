/**
 * downloadDir —— 找「本机下载目录」，并把打包出来的节点包写进去。
 *
 * ## 为什么要有它（用户口径 2026-10-14）
 *
 * 用户原话：「你把前后端调试通过之后，我希望你可以在后台自动打包成一个 zip 文件，
 * 保存到默认的下载地址。不然的话，你的这个节点一删，后台就完全没有意义了，
 * 还要重新写 HTML 代码」。
 *
 * 也就是说：界面 + 脚本调通之后要**落盘一份**（不只是存进资产库）。
 * 节点删了、画布没了，都还能从那个文件原样恢复。
 *
 * ## 怎么找下载目录
 *
 * 优先问系统（Windows 的 `Downloads`、Linux 的 XDG、macOS 的 `~/Downloads`），
 * 都拿不到就退到「家目录下的 Downloads」。**不新建花哨目录**（不往用户的下载目录里
 * 塞子文件夹）—— 就一份文件，用户自己能找到。
 *
 * 为什么要单独一个文件：插件后台半是**外挂单文件**（data:URL 加载，不能 import 工作区包），
 * 但可以用 node: 内置模块；把这段"落到哪儿"的规则收在一处，好单测。
 */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 家目录（Windows 上是 USERPROFILE，其它平台是 HOME） */
function homeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir() || process.cwd()
}

/**
 * 本机下载目录的**候选路径**（按优先级）。
 *
 * 为什么不直接用 `%USERPROFILE%\Downloads` 一个：用户可能重定向过（OneDrive /
 * 组策略都改它），于是优先看 `?USERPROFILE?\Downloads` 是否存在，再退到别的。
 */
export function downloadDirCandidates(): string[] {
  const home = homeDir()
  const out: string[] = []
  const push = (p: string | undefined): void => {
    if (p && !out.includes(p)) out.push(p)
  }
  // ① 环境变量显式指定（测试 / 特殊部署用）
  push(process.env.MINI_CANVAS_DOWNLOAD_DIR)
  // ② Windows 的「已知文件夹」注册值（被 OneDrive 接管时它就指向真实位置）
  const winKnown = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : undefined
  push(winKnown)
  // ③ 其它平台
  push(path.join(home, 'Downloads'))
  push(process.env.XDG_DOWNLOAD_DIR)
  return out
}

/**
 * 取第一个**存在**的候选；一个都不存在就用第一个候选（调用时会现建）。
 *
 * ⚠️ **环境变量指定时不再回落**（审查/测试踩到的真问题）：`MINI_CANVAS_DOWNLOAD_DIR`
 * 是"就用这里"的明确指令 —— 若它指向的目录还没建，就现建它，
 * 而不是"它不存在于是悄悄写到用户的真实下载目录去"。
 * 后者会让测试污染用户家目录，也让"定向输出"这个开关形同虚设。
 */
export async function resolveDownloadDir(): Promise<string> {
  const explicit = process.env.MINI_CANVAS_DOWNLOAD_DIR
  if (explicit) return explicit
  const cands = downloadDirCandidates()
  if (cands.length === 0) return path.join(homeDir(), 'Downloads')
  for (const c of cands) {
    try {
      const st = await fs.stat(c)
      if (st.isDirectory()) return c
    } catch {
      /* 不存在就试下一个 */
    }
  }
  return cands[0]
}

/** 把「包名」变成一个安全的文件名（去掉路径分隔符与非法字符，补 .mcnode） */
export function safeDownloadFileName(rawName: string, ext = '.mcnode'): string {
  const base = String(rawName || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    // `..` 本身不是分隔符，但留在文件名里既难看又容易在别处被二次拼成路径 —— 一起消掉。
    .replace(/\.{2,}/g, '_')
    .trim()
    .slice(0, 80)
  const name = base || '节点包'
  return name.endsWith(ext) ? name : name + ext
}

/**
 * 同名文件已存在时，找一个不覆盖它的名字（`x.mcnode` → `x (2).mcnode`）。
 *
 * **绝不覆盖**用户的旧文件：那是"上次调通的版本"，是用户真正的保命符
 * （他删节点就是靠它恢复）。同名就往后加号。
 */
export async function uniqueDownloadPath(dir: string, fileName: string): Promise<string> {
  const ext = path.extname(fileName)
  const stem = ext ? fileName.slice(0, -ext.length) : fileName
  let candidate = path.join(dir, fileName)
  for (let n = 2; n < 1000; n++) {
    try {
      await fs.access(candidate)
    } catch {
      return candidate // 不存在 = 可以用
    }
    candidate = path.join(dir, stem + ' (' + n + ')' + ext)
  }
  return path.join(dir, stem + ' (' + Date.now() + ')' + ext)
}

/**
 * 把字节写到下载目录，返回**绝对路径**。
 *
 * 先写临时文件再 rename（与仓内 atomicWrite 同一条规矩）：半截文件不会被用户当成成品。
 */
export async function saveToDownloads(
  bytes: Uint8Array,
  rawName: string,
): Promise<{ path: string; dir: string; fileName: string; bytes: number }> {
  const dir = await resolveDownloadDir()
  await fs.mkdir(dir, { recursive: true })
  const fileName = safeDownloadFileName(rawName)
  const target = await uniqueDownloadPath(dir, fileName)
  const tmp = target + '.tmp-' + process.pid + '-' + Date.now()
  await fs.writeFile(tmp, bytes)
  await fs.rename(tmp, target)
  return { path: target, dir, fileName: path.basename(target), bytes: bytes.length }
}
