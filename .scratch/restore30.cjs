const CS = 'http://127.0.0.1:8865';
const CANVAS = '430c8f1f00bd4aba';
(async () => {
  const art = 'http://localhost:8033/api/resources/images/doubao/chat-auto-982345f0.jpeg';
  const buf = Buffer.from(await (await fetch(art)).arrayBuffer());
  console.log('fetched', buf.length, 'bytes');
  const up = await (await fetch(CS + '/api/canvases/' + CANVAS + '/resources?name=chat-auto-982345f0.jpeg', {
    method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: buf,
  })).json();
  console.log('upload ->', JSON.stringify(up));
  const url = '/api/canvases/' + CANVAS + '/resources/' + up.hashName;
  const patch = await (await fetch(CS + '/api/canvases/' + CANVAS + '/nodes', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ update: [{ id: '30', data: { imageUrl: url } }] }),
  })).json();
  console.log('patch ->', JSON.stringify(patch));
  const check = await (await fetch(CS + '/api/canvases/' + CANVAS + '/resources/' + up.hashName, { method: 'HEAD' })).status;
  console.log('resource HEAD =', check);
})();
