import fs from 'node:fs';
for(const f of ['apimart_sd20','hiapi']){
  let s=''; try{ s=fs.readFileSync(`D:/Code/Git/mini-canvas/docs/research/tmp-${f}.html`,'utf8'); }catch(e){ console.log(f,'NOFILE'); continue; }
  s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
  const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
  console.log('=====',f,'lines',L.length);
  const hits=L.filter(x=>x.length<150 && (/\$|Credits|480p|720p|1080p|每秒|张|\/s/.test(x)));
  console.log([...new Set(hits)].slice(0,90).join(' | '));
}

