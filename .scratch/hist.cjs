const base = 'http://127.0.0.1:8865';
(async () => {
  const r = await (await fetch(base + '/api/history?canvasId=430c8f1f00bd4aba&pageSize=50')).json();
  const imgs = r.items.filter(e => e.kind === 'image');
  console.log('image entries:', imgs.length);
  const buckets = { sameOrigin: 0, provider: 0, none: 0 };
  for (const e of imgs) {
    const u = (e.urls || [])[0] || '';
    if (!u) buckets.none++;
    else if (u.startsWith('/api/canvases/')) buckets.sameOrigin++;
    else buckets.provider++;
  }
  console.log(JSON.stringify(buckets));
  console.log('--- first 6 image entries ---');
  for (const e of imgs.slice(0,6)) console.log(e.nodeId, '|', (e.urls||[])[0] || '(none)');
})();
