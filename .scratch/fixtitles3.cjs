const fs = require('fs');
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases';
/** 剥完整标记 + 清掉剥完后残留的半截括号段（"@图片 4(430c8f1f00b" → "@图片 4"） */
function clean(s) {
  let t = String(s ?? '')
    .replace(/@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\([^)]*\))?/g, (_m, _k, name) => '@' + name)
    .replace(/\((?:[0-9a-fA-F][0-9a-fA-F_-]{4,})[^)]*$/g, (m) => (m.includes('#') || /430c8f/.test(m) ? '' : m))
    .replace(/@\w*\((?:[0-9a-fA-F][0-9a-fA-F_-]{4,}).*$/g, '');
  return t.replace(/\s+/g, ' ').trim().slice(0, 24) || '新会话';
}
let fixed = 0;
for (const canvasId of fs.readdirSync(ROOT)) {
  const idxFile = ROOT + '/' + canvasId + '/agent/sessions.json';
  if (!fs.existsSync(idxFile)) continue;
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const s of (idx.sessions || [])) {
    const t = clean(s.title);
    if (t !== s.title) { s.title = t; fixed++; }
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx));
}
console.log('fixed', fixed);
