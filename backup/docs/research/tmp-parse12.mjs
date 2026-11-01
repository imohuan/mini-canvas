import fs from 'node:fs';
for(const f of ['apimart_sd','apimart_sd20','apimart_z']){
  let s=fs.readFileSync(`D:/Code/Git/mini-canvas/docs/research/tmp-${f}.html`,'utf8');
  s=s.replace(/<script[\s\S]*?<\/script>/g,' ').replace(/<style[\s\S]*?<\/style>/g,' ').replace(/<[^>]+>/g,'\n');
  const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
  const out=[];
  for(let i=0;i<L.length;i++){
    if(L[i]==='Credits' && /^\//.test(L[i+1]||'')){
      let model='';
      for(let j=i;j>=0&&j>i-12;j--){ if(/^[A-Za-z0-9][A-Za-z0-9 \-\.\(\)\u00b7]{2,45}$/.test(L[j])&&/seedance|kling|wan|hailuo|grok|vidu|veo|sora|minimax|pixverse|skyreels|gemini|gpt|flux|nano|z-image|seedream|qwen|midjourney|imagen|mai/i.test(L[j])){ model=L[j]; break; } }
      out.push(model+' | '+L[i-1]+'cr'+(L[i+1])+' | '+L[i+2]);
    }
  }
  console.log('==='+f); console.log([...new Set(out)].join('\n'));
}

