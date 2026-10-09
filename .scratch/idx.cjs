const fs = require('fs');
const p = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases/430c8f1f00bd4aba/agent/sessions.json';
const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const s of idx.sessions.slice(0, 12)) {
  console.log('title:', s.title);
  console.log('  preview:', JSON.stringify((s.preview||'').slice(0, 90)));
}
