import fs from 'node:fs';
for(const f of ['am_sd25','am_kl','am_wan','am_hl']){
  let s=''; try{ s=fs.readFileSync(`D:/Code/Git/mini-canvas/docs/research/tmp-${f}.html`,'utf8'); }catch(e){ continue; }
  if(s.length<3000) continue;
  s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
  const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
  const hits=L.filter(x=>x.length<120 && (/^\$?[0-9]/.test(x)||/Credits|480p|720p|1080p|\/s$/.test(x)));
  console.log('==='+f+': '+[...new Set(hits)].slice(0,30).join(' | '));
}

