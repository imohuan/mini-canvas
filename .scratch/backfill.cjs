const fs = require('fs');
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases/430c8f1f00bd4aba';
(async () => {
  const hist = JSON.parse(fs.readFileSync(ROOT + '/history.json', 'utf8'));
  const c = JSON.parse(fs.readFileSync(ROOT + '/canvas.json', 'utf8'));
  const byId = new Map((c.nodes||[]).map(n => [n.id, n]));
  let fixable = 0, missingNode = 0, noMedia = 0;
  for (const e of hist) {
    if (e.kind !== 'image') continue;
    if ((e.urls||[]).length) continue;
    const n = byId.get(e.nodeId);
    if (!n) { missingNode++; continue; }
    const u = n.data && n.data.imageUrl;
    if (typeof u === 'string' && u.startsWith('/api/canvases/')) {
      const file = ROOT + '/resources/' + u.split('/').pop();
      if (fs.existsSync(file)) { e.urls = [u]; fixable++; }
      else { noMedia++; }
    } else { noMedia++; }
  }
  fs.writeFileSync(ROOT + '/history.json', JSON.stringify(hist));
  console.log('backfilled', fixable, '| node gone', missingNode, '| no usable media', noMedia);
})();
