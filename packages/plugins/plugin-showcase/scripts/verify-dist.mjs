// 产物自检（开发用，不进 npm files）：前端 UMD 全局名 + server.js 的 external 边界
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const web = readFileSync(path.join(PKG, 'dist/plugin-showcase.js'), 'utf8')
const srv = readFileSync(path.join(PKG, 'dist/server.js'), 'utf8')

const m = web.match(/.(MiniCanvasPlugin[A-Za-z0-9_]+)s*=s*{}/)
console.log('web global:', m?.[1] ?? '(未找到!)')
console.log('server has workspace import:', /froms*["']@mini-canvas/.test(srv))
console.log('server has hono import:', /froms*["']hono/.test(srv))
console.log('server bytes:', srv.length)
