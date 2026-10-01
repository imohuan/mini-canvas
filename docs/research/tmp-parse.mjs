import fs from 'node:fs';
const p='D:/Code/Git/mini-canvas/docs/research/tmp-apimart.txt';
let s=fs.readFileSync(p,'utf8');
s=s.split('\\n').join('\n');
const L=s.split('\n').map(x=>x.trim()).filter(Boolean);
console.log('LINES',L.length);
const out=[];
for(let i=0;i<L.length;i++){
  if(L[i]==='Credits'){
    const unit=L[i+1]||'', num=L[i-1]||'', usd=L[i+2]||'';
    let model='';
    for(let j=i;j>=0&&j>i-800;j--){ if(/^\d+ price tiers$/.test(L[j])&&L[j-1]){model=L[j-1];break;} }
    let spec='';
    for(let j=i-1;j>=Math.max(0,i-30);j--){
      const c=L[j];
      if(/^[0-9]+[.,]?[0-9]*$/.test(c))continue;
      if(['Credits','Spec','Our Price','Official Price','Saving'].includes(c))continue;
      spec=c;break;
    }
    if(unit.startsWith('/')&&/^[0-9]/.test(num)) out.push(model+' ## '+spec+' ## '+num+'cr'+unit+' ## '+usd);
  }
}
const u=[...new Set(out)];
console.log('ROWS',u.length);
console.log(u.join('\n'));

