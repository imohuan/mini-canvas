/**
 * inspect —— 问「这个脚本导出了哪些函数」。**在子进程里问，不在主进程 import。**
 *
 * 为什么不能在主进程 import 一下：
 * 1. **用户脚本不该进后台进程**。它可能建连接、开定时器、改全局；那都是"跑起来"的行为，
 *    而这里只是"看一眼有哪些函数"。
 * 2. **主进程 import 会留下清不掉的缓存**（Node 官方：ESM 缓存没有 API 能清）。改一次脚本
 *    就多留一份，越用越涨。
 * 3. 实测：打包/测试运行器会把"项目外的文件"的 import 路径改写，主进程那条路在某些环境里
 *    直接失败（vitest 下报 `Cannot find module`）。子进程里是裸的 Node 语义，没有这层改写。
 *
 * 做法：用 `node -e` 起一个极短的进程，import 脚本、把导出名打到 stdout、退出。
 * 进程用完即灭，什么都不留。
 */
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

/** 内省进程自己的超时（它只做 import + 列名字，几毫秒的事） */
export const INSPECT_TIMEOUT_MS = 15_000

/**
 * 内省代码：import 目标脚本，把**函数名**按 JSON 打到 stdout。
 *
 * 只打函数名（不打整份导出）：清单与报错里要的就是"能调哪些"，输出也足够小。
 */
export const INSPECT_CODE = [
  'const url = process.argv[1]',
  'try {',
  '  const mod = await import(url)',
  '  const names = Object.keys(mod).filter((k) => typeof mod[k] === "function").sort()',
  // ★ 顺手把作者写的**说明书**（`export const docs`）也带回来。
  //   为什么在这里读而不是另起一个进程：这一趟本来就把脚本 import 进来了，
  //   多取一个导出是零成本；再起一次等于把同一件事做两遍。
  //   注意 docs 是**对象**不是函数，所以它不会混进上面的 names（那是 fnDoc 的约定）。
  '  const docs = (mod.docs && typeof mod.docs === "object" && !Array.isArray(mod.docs)) ? mod.docs : {}',
  '  process.stdout.write(JSON.stringify({ ok: true, methods: names, docs }))',
  '} catch (err) {',
  '  process.stdout.write(JSON.stringify({ ok: false, error: String((err && err.message) || err) }))',
  '}',
].join('\n')

/** 从脚本里问到的东西：导出了哪些函数 + 作者写的说明书 */
export interface InspectResult {
  ok: boolean
  methods: string[]
  /** 函数名 → 说明书（作者没写就是空对象；形状宽松，由 fnDoc 收窄） */
  docs: Record<string, unknown>
  error?: string
}

/**
 * 起一个短命进程问导出函数。
 *
 * 失败（进程起不来 / 超时 / 脚本有语法错）统一成 `ok: false` ——
 * **不让一个坏脚本把整份清单带崩**（列表里它显示成"没有可调用的函数"，真点时再报具体原因）。
 */
export async function inspectScript(scriptPath: string): Promise<InspectResult> {
  return new Promise<InspectResult>((resolve) => {
    let out = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const done = (r: InspectResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill()
      } catch {
        /* 已经退了 */
      }
      resolve(r)
    }

    const child = spawn(
      process.execPath,
      ['--input-type=module', '-e', INSPECT_CODE, pathToFileURL(scriptPath).href],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    )
    timer = setTimeout(() => done({ ok: false, methods: [], docs: {}, error: '问脚本有多少函数超时了' }), INSPECT_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: unknown) => {
      out += String(chunk)
    })
    child.on('error', (err) => done({ ok: false, methods: [], docs: {}, error: '起不了内省进程：' + err.message }))
    child.on('close', () => {
      const line = out.trim()
      if (!line) return done({ ok: false, methods: [], docs: {}, error: '脚本没给出任何导出信息' })
      try {
        const parsed = JSON.parse(line) as { ok?: boolean; methods?: unknown; docs?: unknown; error?: unknown }
        if (parsed.ok && Array.isArray(parsed.methods)) {
          const docs =
            parsed.docs && typeof parsed.docs === 'object' && !Array.isArray(parsed.docs)
              ? (parsed.docs as Record<string, unknown>)
              : {}
          return done({
            ok: true,
            methods: parsed.methods.filter((m): m is string => typeof m === 'string'),
            docs,
          })
        }
        return done({
          ok: false,
          methods: [],
          docs: {},
          error: typeof parsed.error === 'string' ? parsed.error : '脚本加载失败',
        })
      } catch {
        return done({ ok: false, methods: [], docs: {}, error: '脚本输出看不懂（可能它自己打了别的东西）' })
      }
    })
  })
}
