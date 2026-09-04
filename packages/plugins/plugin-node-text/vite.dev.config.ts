import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import vue from '@vitejs/plugin-vue'

// plugin-node-text —— 独立 dev server（宿主跨端口热拉开发用）。
//
// 与 vite.config.ts（UMD 打包）区分：dev 场景不打包，起一个真正的 dev server，
// 宿主 `import('http://localhost:5311/src/index.ts?t=ts')` 直接拉源码模块。
//
// 关键(vue 单例, docs/plan/plugin-dev-hmr-reload-plan.md §1)：宿主与插件都 resolve vue 到
// pnpm 同一真实路径(.pnpm/vue@…)，插件 dev 的 .vue import 'vue' 会和宿主拿同一份，
// 浏览器 ES 模块缓存自动去重 → 单 vue。若 Chrome 实测发现仍双份，再补 resolve.alias 指宿主。

/**
 * 监听 vite 自己 watcher(chokidar) 的文件变更，经 SSE 端点推给宿主。
 * 绕开三坎：HMR 模块图(直接用 watcher，不需 import 进图) / token(SSE 非 vite ws) /
 * update 内部格式(只关心"文件绝对路径变了")。实现参照 docs/tmp/vite-hmr-probe/02。
 */
function fileChangeFeed(): Plugin {
  const CHANGED = 'changed'
  // 记录所有已连接的宿主 response（SSE 推送目标）
  const clients = new Set<import('node:http').ServerResponse>()

  function notify(file: string) {
    for (const res of clients) {
      try {
        res.write(`event: ${CHANGED}\ndata: ${JSON.stringify({ file })}\n\n`)
      } catch {
        /* 连接已断，下面 close 时会清掉 */
      }
    }
  }

  return {
    name: 'mini-canvas:file-change-feed',
    configureServer(server: ViteDevServer) {
      // server.watcher / server.middlewares 在 configureServer 时均已就绪。
      const watcher = server.watcher
      const onFile = (file: string) => {
        notify(String(file))
        server.config.logger.info(`[file-change-feed] ${file}`, { timestamp: true })
      }
      watcher.on('change', onFile)
      watcher.on('add', onFile)
      watcher.on('unlink', onFile)

      // SSE 端点：宿主 EventSource 连进来即收文件变更。跨端口=跨源 → 显式 CORS 放行。
      server.middlewares.use('/__plugin_changed', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        res.write('retry: 2000\n\n')
        clients.add(res)
        req.on('close', () => clients.delete(res))
      })
    },
  }
}

// 宿主 import 的是 src/index.ts 及它 import 的 .vue——vite 会自动把它们当模块 serve，
// 无需 html 入口（这就是"设 html 才有效"直觉背后的机制被绕开的关键）。
export default defineConfig({
  plugins: [vue(), fileChangeFeed()],
  server: {
    port: 5311,
    strictPort: true,
    cors: true,
  },
})
