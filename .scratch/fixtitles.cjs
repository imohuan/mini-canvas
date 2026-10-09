const fs = require('fs');
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases';
const strip = (s) => String(s ?? '')
  .replace(/@\[([a-zA-Z][a-zA-Z0-9_-]*):([^\]]+)\](?:\([^)]*\))?/g, (_m, _k, name) => '@' + name);
let fixedTitles = 0, fixedPreviews = 0;
for (const canvasId of fs.readdirSync(ROOT)) {
  const idxFile = ROOT + '/' + canvasId + '/agent/sessions.json';
  if (!fs.existsSync(idxFile)) continue;
  const idx = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
  for (const s of (idx.sessions || [])) {
    const t = strip(s.title);
    if (t !== s.title) { s.title = t.slice(0, 24); fixedTitles++; }
    if (s.preview && s.preview.includes('@[')) { s.preview = strip(s.preview).slice(0, 120); fixedPreviews++; }
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx));
  // 会话记录文件本身一般不带标记（appendTurn 已剥），只修索引即可
  console.log(canvasId, 'titles fixed:', fixedTitles, 'previews:', fixedPreviews);
}
console.log('done');
