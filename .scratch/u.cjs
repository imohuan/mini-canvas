const fs = require('fs');
const obj = JSON.parse(fs.readFileSync('C:/Users/Administrator/Desktop/11.txt','utf8'));
const body = JSON.parse(obj.request_json.body);
const msgs = body.messages;
function textOf(c){ if(typeof c==='string') return c; if(Array.isArray(c)) return c.map(p=>p.text||('['+p.type+']')).join(' '); return JSON.stringify(c); }
console.log('===== SYSTEM PROMPT (first 3000 chars) =====');
console.log(textOf(msgs[0].content).slice(0,3000));
console.log('\n===== SYSTEM PROMPT (chars 12000-14560) =====');
console.log(textOf(msgs[0].content).slice(12000));
console.log('\n===== USER MESSAGES =====');
msgs.forEach((m,i)=>{ if(m.role==='user'){ console.log('--- user#'+i+' ---'); console.log(textOf(m.content).slice(0,2500)); } });
