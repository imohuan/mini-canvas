const fs=require('fs');const path=require('path');
const roots=['packages/ui/src','packages/plugins','packages/canvas-render/src'];
const skip=/node_modules|dist|assets|theme-lab|__tests__/;
function walk(d,out){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(skip.test(p))continue;if(e.isDirectory())walk(p,out);else if(/\.(vue|ts)$/.test(p))out.push(p);}return out;}
const files=[];for(const r of roots)walk(r,files);
const names=['AxButton','AxDialog','AxDropdown','AxMenu','AxMenuItem','AxResizeHandle','AxScrollArea','AxSubMenu','AxTooltip','AxImageViewer'];
const rows=[];
for(const f of files){const src=fs.readFileSync(f,'utf8');const c={};
 for(const n of names){const m=src.match(new RegExp('\\b'+n+'\\b','g'));if(m)c[n]=m.length;}
 if(Object.keys(c).length)rows.push({f,c,total:Object.values(c).reduce((a,b)=>a+b,0)});}
rows.sort((a,b)=>b.total-a.total);
for(const r of rows)console.log(r.total+'\t'+r.f+'\t'+JSON.stringify(r.c));
