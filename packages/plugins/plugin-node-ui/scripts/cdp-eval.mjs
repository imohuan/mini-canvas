// 临时 CDP 取证脚本：对指定 target 执行 JS 并把结果写到 cdp-eval-result.txt
const [, , wsUrl, expr] = process.argv
const fs = await import('node:fs')
const ws = new WebSocket(wsUrl)
const result = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve('EVAL_TIMEOUT_10S'), 10000)
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
  }
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id === 1) { clearTimeout(timer); resolve(m.result?.result?.value ?? JSON.stringify(m.result)) }
  }
  ws.onerror = () => { clearTimeout(timer); resolve('WS_ERROR') }
})
ws.close()
fs.writeFileSync(import.meta.dirname + '/cdp-eval-result.txt', String(result))
console.log('EVAL_RESULT=' + String(result))
