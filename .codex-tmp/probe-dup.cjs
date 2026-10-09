const fs=require('fs');const path=require('path');
const dir='I:/Assets/liblib-effects';
const idx=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));
const files=new Set(fs.readdirSync(dir));
function cands(u){const b=u.split('?')[0].split('/').pop();return [b,'tool_cinematic_'+b]}
// 复刻服务端逻辑：每个条目 -> 封面图、视频
const rows=[];
for(const e of idx){
  const imgs=[];
  for(const im of (e.images||[])){
    for(const k of ['imageUrl','webpUrl','originalImageUrl']){
      const u=im[k]; if(typeof u!=='string'||!u) continue;
      for(const c of cands(u)){ if(files.has(c) && !imgs.includes(c)){imgs.push(c);break} }
    }
  }
  if(!imgs.length) continue;
  const vids=[];
  for(const img of imgs){const stem=img.replace(/\.[^.]+$/,'');for(const ext of ['mp4','webm','mov']){const v=stem+'.'+ext;if(files.has(v)&&!vids.includes(v))vids.push(v)}}
  rows.push({name:e.name, imgs, vids});
}
// 哪些视频被多个条目引用
const vmap={};
for(const r of rows) for(const v of r.vids) (vmap[v]=vmap[v]||[]).push(r.name);
const dup=Object.entries(vmap).filter(([,n])=>n.length>1);
console.log('entries with video:', rows.filter(r=>r.vids.length).length);
console.log('duplicate video refs:', JSON.stringify(dup, null, 1));
console.log('demo rows:', JSON.stringify(rows.filter(r=>r.vids.length).slice(0,6), null, 1));

