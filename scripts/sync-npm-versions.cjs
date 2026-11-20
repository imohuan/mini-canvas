const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const REPO = 'D:/Code/Git/mini-canvas'
const versions = {"plugin-clipboard":"0.1.2","plugin-theme-components":"0.1.2","plugin-theme-canvas":"0.1.2","plugin-manager":"0.1.2","plugin-agent":"0.1.3","plugin-node-ui":"0.1.3","plugin-bottom-bar":"0.1.2","plugin-node-text":"0.1.3","plugin-node-image":"0.1.3","plugin-node-video":"0.1.3","plugin-node-audio":"0.1.3","plugin-node-3d-preview":"0.1.3","plugin-node-rotate":"0.1.3","plugin-image-grid-split":"0.1.3","plugin-context-menu":"0.1.2","plugin-file-drop":"0.1.2","plugin-group":"0.1.3","plugin-multi-select":"0.1.2","plugin-edge-cutting":"0.1.3","plugin-style-library":"0.1.2","plugin-shortcut-manager":"0.1.3","plugin-mini-map":"0.1.3","plugin-auto-layout":"0.1.2","plugin-cloud-client":"0.1.3"}
for (const [d, v] of Object.entries(versions)) {
  const p = path.join(REPO, 'packages/plugins', d, 'package.json')
  const j = JSON.parse(fs.readFileSync(p, 'utf8'))
  j.version = v
  j.main = './src/index.ts'
  j.exports = { '.': { types: './src/index.ts', default: './src/index.ts' }, './*': './src/*' }
  if (j.plume) delete j.plume.web
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n')
}
console.log('restored dev form for ' + Object.keys(versions).length + ' packages with npm versions')
