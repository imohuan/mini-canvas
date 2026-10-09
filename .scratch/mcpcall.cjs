const base = 'http://127.0.0.1:8865/mcp';
async function call(id, name, args) {
  // handshake per request (stateless server)
  await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'p',version:'0'}}}) }).then(r=>r.text());
  const res = await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}}) });
  const text = await res.text();
  const line = text.split('\n').find(l=>l.startsWith('data:')) ?? text;
  const json = JSON.parse(line.replace(/^data:\s*/,''));
  return JSON.parse(json.result.content[0].text);
}
(async () => {
  console.log('list =', JSON.stringify(await call(2,'canvas_list_canvases',{})));
  const a = await call(3,'canvas_get',{canvasId:'430c8f1f00bd4aba'});
  console.log('on 430 nodeCount =', a.nodeCount);
  const d = await call(4,'canvas_get',{});
  console.log('on default nodeCount =', d.nodeCount);
  console.log('bad canvas =', JSON.stringify(await call(5,'canvas_get',{canvasId:'deadbeefdeadbeef'})));
})();
