/**
 * demo.mjs —— 任务脚本样例（三件事：回话、长任务+进度、校验子进程能起来）
 *
 * 放这里就是「一台机器上有哪些事可以做」的清单项：
 *   列：POST /api/task/call { type: "list" }           → name: "demo", methods: [...]
 *   跑：POST /api/task/call { type: "call", name: "demo", methods: "echo", args: ["hi"] }
 *
 * ctx 里有什么见 docs/plan/task-script-router-plan.md §四：
 *   workspace（本次调用专属空目录，跑完自动删）、dir（本文件所在目录）、
 *   canvasId / nodeId / name、log(s)、signal（AbortSignal）、progress(v)
 * 这里刻意**不用任何封装命令** —— ffmpeg 这类要自己 spawn（见 version）。
 */
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * 说明书（可选，但强烈建议写）：把它们交给 MCP 的 canvas_fn_list / canvas_fn_info，
 * AI 才知道每个函数「干什么、收什么、回什么、怎么调」。
 *
 * 注意 docs 是**对象**不是函数 —— 它不会出现在「可调函数」清单里（那份清单只列 function）。
 */
export const docs = {
  echo: {
    what: '把收到的参数原样回话，并报出这次调用拿到的 ctx（画布 / 节点 / 工作目录）',
    args: [{ name: 'text', type: 'string', required: true, desc: '随便一段话，会原样回给你' }],
    returns: '{ text, name, canvasId, nodeId, hasWorkspace, workspaceWritable, dir }',
    example: 'canvas_fn_call({ script: "demo", fn: "echo", argsJson: "[\"你好\"]" })',
  },
  tick: {
    what: '模拟一个长任务：边跑边报进度，并且能被取消',
    args: [{ name: 'count', type: 'number', desc: '跑几步（1-60，缺省 5）' }],
    returns: '{ cancelled, done }',
    example: 'canvas_fn_call({ script: "demo", fn: "tick", argsJson: "[3]" })',
  },
  version: {
    what: '跑一下 ffmpeg -version，验证这台机器上能不能起子进程',
    args: [],
    returns: '{ ok, exitCode, firstLine }',
    example: 'canvas_fn_call({ script: "demo", fn: "version" })',
  },
}

/** 最小的一件事：把参数原样回话，并报出 ctx 里拿到了什么 */
export async function echo(text, ctx) {
  ctx.log('收到：' + text)
  const probe = path.join(ctx.workspace, 'probe.txt')
  await fs.writeFile(probe, 'ok', 'utf8')
  return {
    text: String(text),
    name: ctx.name,
    canvasId: ctx.canvasId,
    nodeId: ctx.nodeId,
    hasWorkspace: !!ctx.workspace,
    workspaceWritable: (await fs.readFile(probe, 'utf8')) === 'ok',
    dir: ctx.dir,
  }
}

/** 长任务的样子：边跑边报进度，并且**能被取消**（收到 signal 就收摊） */
export async function tick(count, ctx) {
  const total = Math.max(1, Math.min(60, Number(count) || 5))
  for (let i = 1; i <= total; i++) {
    if (ctx.signal?.aborted) {
      ctx.log('收到取消，第 ' + i + ' 步停下')
      return { cancelled: true, done: i - 1 }
    }
    ctx.log('第 ' + i + '/' + total + ' 步')
    ctx.progress(i / total)
    await new Promise((r) => setTimeout(r, 250))
  }
  return { cancelled: false, done: total }
}

/** 子进程能起来吗（顺带验证「脚本自己开命令」这条路） */
export async function version(ctx) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version'], { windowsHide: true })
    let out = ''
    p.stdout.on('data', (c) => { out += String(c) })
    p.stderr.on('data', (c) => { out += String(c) })
    p.on('error', (err) => resolve({ ok: false, error: '起不了 ffmpeg：' + err.message }))
    p.on('close', (code) => {
      const first = out.split('\n')[0] || ''
      ctx.log('ffmpeg 退出码 ' + code + '：' + first.slice(0, 80))
      resolve({ ok: code === 0, exitCode: code, firstLine: first })
    })
  })
}

