const fs = require('fs');
const ROOT = 'D:/Code/Git/mini-canvas/packages/cloud-server/.mini-canvas/canvases/430c8f1f00bd4aba/agent';
const idx = JSON.parse(fs.readFileSync(ROOT + '/sessions.json', 'utf8'));
for (const s of idx.sessions.slice(0, 10)) console.log(JSON.stringify(s.title));
