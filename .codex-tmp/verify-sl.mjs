async function main() {
  const base = 'http://127.0.0.1:8865'
  // 先卸再装（拿新产物）
  await fetch(base + '/api/server-plugins/uninstall', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: 'plugin-style-library' }) })
  const cat = await (await fetch(base + '/plugin-catalog.json')).json()
  const entry = cat.plugins.find(p => p.id === 'plugin-style-library')
  const code = await (await fetch(base + entry.server.url)).text()
  const r = await fetch(base + '/api/server-plugins/install', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: entry.id, code, sha256: entry.server.sha256, confirm: true, origin: base }),
  })
  console.log('install ->', r.status, JSON.stringify(await r.json()))
  await new Promise(r => setTimeout(r, 900))
  const page = await (await fetch(base + '/api/style-library/items?offset=0&limit=2')).json()
  console.log('total', page.total, 'cover', page.items[0].cover)
  const img = await fetch(base + page.items[0].cover)
  console.log('cover ->', img.status, img.headers.get('content-type'), img.headers.get('content-length'))
  const bad = await fetch(base + '/api/style-library/file?name=../secret.png')
  console.log('traversal ->', bad.status, (await bad.text()).slice(0,90))
}
main().catch(e => { console.error('ERR', e); process.exit(1) })

