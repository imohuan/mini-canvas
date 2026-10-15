const [, , wsUrl] = process.argv
const ws = new WebSocket(wsUrl)
const fs = await import('node:fs')
const done = (msg, code) => { fs.writeFileSync('cdp-clear-result.txt', msg); process.exit(code) }
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id === 3) done('CLEARED + reloaded', 0)
}
ws.onopen = () => {
  ws.send(JSON.stringify({ id: 1, method: 'Page.enable', params: {} }))
  ws.send(JSON.stringify({ id: 2, method: 'Storage.clearDataForOrigin', params: { origin: 'http://127.0.0.1:8865', storageTypes: 'local_storage,session_storage' } }))
  ws.send(JSON.stringify({ id: 3, method: 'Page.reload', params: { ignoreCache: true } }))
}
setTimeout(() => done('TIMEOUT', 1), 15000)
ws.onerror = () => done('WS_ERROR', 1)
