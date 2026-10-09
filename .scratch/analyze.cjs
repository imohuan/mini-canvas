const fs = require('fs');
const obj = JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/11.txt','utf8'));
const body = JSON.parse(obj.request_json.body);
const msgs = body.messages;
function short(s, n){ s = String(s==null?'':s); return s.length>n ? s.slice(0,n)+'…' : s; }
msgs.forEach((m,i)=>{
  let tag = '['+i+' '+m.role+']';
  if (m.role==='system') { console.log(tag+' SYSTEM len='+m.content.length); return; }
  if (m.role==='user') { console.log(tag+' USER: '+short(m.content,400)); return; }
  if (m.role==='assistant') {
    let line = tag;
    if (m.content) line += ' TEXT: '+short(m.content,300);
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        line += ' | CALL '+ (tc.function&&tc.function.name) +' '+ short(tc.function&&tc.function.arguments, 350);
      }
    }
    console.log(line);
    return;
  }
  if (m.role==='tool') { console.log('  -> TOOL RESULT '+short(m.tool_call_id,20)+': '+short(m.content,300)); return; }
});
console.log('\n=== declared tools ===');
for (const t of (body.tools||[])) console.log(' -', t.function && t.function.name);
