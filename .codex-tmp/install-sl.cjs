async function main() {
  const base = 'http://127.0.0.1:8865'
  const cat = await (await fetch(base + '/plugin-catalog.json')).json()
  const entry = cat.plugins.find(p => p.id === 'plugin-style-library')
  if (!entry) throw new Error('catalog 里没有 plugin-style-library')
  const code = await (await fetch(base + entry.server.url)).text()
  const r = await fetch(base + '/api/server-plugins/install', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: entry.id, code, sha256: entry.server.sha256, confirm: true, origin: base }),
  })
  console.log('install ->', r.status, JSON.stringify(await r.json()))
  // 等热装完成
  await new Promise(r => setTimeout(r, 800))
  const meta = await (await fetch(base + '/api/style-library/meta')).json()
  console.log('meta ->', JSON.stringify({ ok: meta.ok, root: meta.root, itemCount: meta.itemCount, fileCount: meta.fileCount, source: meta.source, categories: (meta.categories||[]).slice(0,6) }))
  const page = await (await fetch(base + '/api/style-library/items?offset=0&limit=3')).json()
  console.log('items ->', JSON.stringify({ total: page.total, hasMore: page.hasMore, first: page.items && page.items[0] && { name: page.items[0].name, author: page.items[0].author, category: page.items[0].category, cover: page.items[0].cover, images: page.items[0].images.length } }))
  if (page.items && page.items[0]) {
    const img = await fetch(base + page.items[0].cover)
    console.log('cover ->', img.status, img.headers.get('content-type'), img.headers.get('content-length'))
  }
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
async function main() {
  const base = 'http://127.0.0.1:8865'
  const u = base + '/api/style-library/file/196839fdfe0c4922bd6b8412407022cb_08a35db09431614a9b50e1784d6b20e078ae9467306d9b6bf2285027b3e2d9ba.png'
  const r = await fetch(u)
  console.log('status', r.status, r.headers.get('content-type'))
  const t = await r.text()
  console.log('body head:', t.slice(0, 200).replace(/\n/g,' '))
  // 对照：一个不存在的名字
  const r2 = await fetch(base + '/api/style-library/file/nope.png')
  console.log('missing ->', r2.status, (await r2.text()).slice(0, 120))
}
main().catch(e => { console.error('ERR', e) })

