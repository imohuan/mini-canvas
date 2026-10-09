async function main() {
  const base = 'http://127.0.0.1:8865'
  await fetch(base + '/api/server-plugins/uninstall', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ id: 'plugin-style-library' }) })
  const cat = await (await fetch(base + '/plugin-catalog.json')).json()
  const entry = cat.plugins.find(p => p.id === 'plugin-style-library')
  const code = await (await fetch(base + entry.server.url)).text()
  const r = await fetch(base + '/api/server-plugins/install', { method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ id: entry.id, code, sha256: entry.server.sha256, confirm: true, origin: base }) })
  console.log('install ->', r.status, JSON.stringify(await r.json()))
  await new Promise(r => setTimeout(r, 900))
  const meta = await (await fetch(base + '/api/style-library/meta')).json()
  console.log('categories:', JSON.stringify(meta.categories.map(c=>c.name+':'+c.count)))
  const c = meta.categories.find(x=>x.name!=='其他')
  const page = await (await fetch(base + '/api/style-library/items?offset=0&limit=2&category=' + encodeURIComponent(c.name))).json()
  console.log('filtered by', c.name, '->', page.total, page.items.map(i=>i.name).join(' / '))
  const hot = await (await fetch(base + '/api/style-library/items?offset=0&limit=2&sort=hot')).json()
  console.log('hot top:', hot.items.map(i=>i.name+'('+i.runCount+')').join(' / '))
  const q = await (await fetch(base + '/api/style-library/items?offset=0&limit=2&q=猫')).json()
  console.log('search 猫 ->', q.total)
}
main().catch(e => { console.error('ERR', e) })

