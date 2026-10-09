const fs = require('fs');
const path = require('path');
const CS = 'http://127.0.0.1:8865';
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases';

/** 把 provider 产物地址存进画布资源目录，返回同源地址（按 url 缓存，同一产物只存一次） */
const cache = new Map();
async function sameOrigin(canvasId, url) {
  if (!/^https?:\/\//.test(url)) return url;          // 已经是同源 / 相对地址
  if (cache.has(url)) return cache.get(url);
  const name = url.split('?')[0].split('/').pop();
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const r = await (await fetch(CS + '/api/canvases/' + canvasId + '/resources?name=' + encodeURIComponent(name), {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes,
  })).json();
  const out = '/api/canvases/' + canvasId + '/resources/' + r.hashName;
  cache.set(url, out);
  return out;
}

(async () => {
  for (const canvasId of fs.readdirSync(ROOT)) {
    const canvasJson = path.join(ROOT, canvasId, 'canvas.json');
    const histJson = path.join(ROOT, canvasId, 'history.json');
    if (fs.existsSync(histJson)) {
      const hist = JSON.parse(fs.readFileSync(histJson, 'utf8'));
      let changed = 0;
      for (const e of hist) {
        if (e.urls && e.urls[0] && /^https?:\/\//.test(e.urls[0])) {
          try { e.urls[0] = await sameOrigin(canvasId, e.urls[0]); changed++; } catch (err) { console.log('  hist skip', e.urls[0], err.message); }
        }
      }
      fs.writeFileSync(histJson, JSON.stringify(hist));
      console.log(canvasId, 'history fixed', changed, '/', hist.length);
    }
    if (fs.existsSync(canvasJson)) {
      const c = JSON.parse(fs.readFileSync(canvasJson, 'utf8'));
      let changed = 0;
      for (const n of (c.nodes || [])) {
        for (const field of ['imageUrl', 'audioUrl', 'videoUrl']) {
          const u = n.data && n.data[field];
          if (typeof u === 'string' && /^https?:\/\//.test(u)) {
            try { n.data[field] = await sameOrigin(canvasId, u); changed++; } catch (err) { console.log('  node skip', n.id, field, err.message); }
          }
        }
      }
      if (changed) fs.writeFileSync(canvasJson, JSON.stringify(c));
      console.log(canvasId, 'nodes fixed', changed);
    }
  }
  console.log('done');
})();
