const fs=require('fs');const path=require('path');
const roots=['packages/ui/src','packages/plugins'];
const skip=/node_modules|dist|assets|theme-lab|__tests__/;
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(skip.test(p))continue;if(e.isDirectory())walk(p,out);else if(p.endsWith('.vue'))out.push(p);}return out;}
const files=[];for(const r of roots)walk(r,files);
const modes={hover:[],contextmenu:[],openAtPoint:[],nestedIn:[]};
for(const f of files){const src=fs.readFileSync(f,'utf8');
 if(src.includes('trigger="hover"')||src.includes("trigger='hover'"))modes.hover.push(f);
 if(src.includes('trigger="contextmenu"')||src.includes("trigger='contextmenu'"))modes.contextmenu.push(f);
 if(/openAtPoint|openAt\(/.test(src))modes.openAtPoint.push(f);
 if(/nested-in|nestedIn/.test(src))modes.nestedIn.push(f);
}
for(const k of Object.keys(modes))console.log(k+': '+JSON.stringify(modes[k]));
