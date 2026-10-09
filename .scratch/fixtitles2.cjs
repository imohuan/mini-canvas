const fs = require('fs');
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases';
/** 完整标记 → @名字；被截断的半截标记（@[:...](... 无闭括号）→ 直接砍掉 */
function clean(s) {
  let t = String(s ?? '')
    .replace(/@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\([^)]*\))?/g, (_m, _k, name) => '@' + name)
    .replace(/@\[[^\]]*\(?\S*/g, (m) => {
      // 半截：试着从 "@[kind:" 里抠出名字；抠不出就整个去掉
      const m2 = /^@\[[a-zA-Z][a-zA-Z0-9_-]*:([^\]]*)/.exec(m);
      return m2 && m2[1] ? '@' + m2[1] : '';
    });
  return t.replace(/\s+/g, ' ').trim().slice(0, 24);
}
let fixed = 0;
for (const canvasId of fs.readdirSync(ROOT)) {
  const idxFile = ROOT + '/' + canvasId + '/agent/sessions.json';
  if (!fs.existsSync(idxFile)) continue;
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const s of (idx.sessions || [])) {
    const t = clean(s.title);
    if (t !== s.title) { s.title = t || '新会话'; fixed++; }
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx));
}
console.log('fixed', fixed);
