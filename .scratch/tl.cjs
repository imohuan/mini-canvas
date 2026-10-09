const base = 'http://127.0.0.1:8865/mcp';
async function rpc(method, params) {
  await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'p',version:'0'}}}) }).then(r=>r.text());
  const res = await fetch(base, { method:'POST', headers:{'content-type':'application/json','accept':'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc:'2.0',id:2,method,params}) });
  const t = await res.text(); const line = t.split('\n').find(l=>l.startsWith('data:')) ?? t;
  return JSON.parse(line.replace(/^data:\s*/,''));
}
(async () => {
  const list = await rpc('tools/list', {});
  console.log('tools =', list.result.tools.map(t=>t.name).join(', '));
  const res = await rpc('tools/call', {name:'canvas_list_canvases', arguments:{}});
  console.log('canvases =', res.result.content[0].text);
})();
