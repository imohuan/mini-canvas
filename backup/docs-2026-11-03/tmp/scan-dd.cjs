const fs=require('fs');const path=require('path');
const roots=['packages/ui/src','packages/plugins'];
const skip=/node_modules|dist|assets|theme-lab|__tests__/;
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(skip.test(p))continue;if(e.isDirectory())walk(p,out);else if(p.endsWith('.vue'))out.push(p);}return out;}
const files=[];for(const r of roots)walk(r,files);
for(const f of files){const src=fs.readFileSync(f,'utf8');
 const n=(src.match(/<AxDropdown/g)||[]).length; if(!n)continue;
 const hasMenu=(src.match(/<AxMenu/g)||[]).length;
 const hasItem=(src.match(/<AxMenuItem/g)||[]).length;
 console.log(n+'\tmenu='+hasMenu+'\titem='+hasItem+'\t'+f);}
