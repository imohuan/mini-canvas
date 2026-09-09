import json, subprocess, sys
target = json.load(open(r"D:\Code\Git\mini-canvas\cdp_ctx.json"))
script = r'''
const ws = new WebSocket(process.argv[1]);
let id=0; const pending=new Map();
function send(m,p={}){return new Promise((res,rej)=>{const mid=++id;pending.set(mid,{res,rej});ws.send(JSON.stringify({id:mid,method:m,params:p}))})}
ws.onmessage=(ev)=>{const msg=JSON.parse(ev.data);if(msg.id&&pending.has(msg.id)){const {res,rej}=pending.get(msg.id);pending.delete(msg.id);msg.error?rej(new Error(msg.error.message)):res(msg.result)}};
await new Promise(r=>ws.onopen=r);
await send('Page.enable');
await new Promise(r=>setTimeout(r,4000));
// right click empty pane center-ish (avoid nodes at 120,120 & 560,160). Use (600,500)
await send('Input.dispatchMouseEvent',{type:'mousePressed',x:700,y:550,button:'right',clickCount:1});
await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:700,y:550,button:'right',clickCount:1});
await new Promise(r=>setTimeout(r,700));
const r=await send('Runtime.evaluate',{expression:`(() => {
  const menu=document.querySelector('.ctx-menu');
  if(!menu) return {open:false};
  const items=[...menu.querySelectorAll('.ctx-menu-item')].map(b=>({
    label:(b.querySelector('.ctx-menu-label')||{}).textContent,
    shortcut:(b.querySelector('.ctx-menu-shortcut')||{}).textContent||null
  }));
  const groups=[];
  let last=null;
  for(const b of menu.querySelectorAll('.ctx-menu-item')){
    // group boundary approximated by divider before item
  }
  return {open:true, count: items.length, items};
})()`,returnByValue:true});
console.log('MENU ' + JSON.stringify(r.result.value,null,1));
ws.close(); process.exit(0);
'''
res = subprocess.run(["node","--input-type=module","-e",script, target["ws"]],capture_output=True,text=True,encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
print(res.stdout[:8000])
if res.stderr: print("ERR", res.stderr[:1500])
