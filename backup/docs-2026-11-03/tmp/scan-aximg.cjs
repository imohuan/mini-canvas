const fs=require('fs');
const files=['packages/plugins/plugin-theme-default/src/components/ui/MediaViewer.vue','packages/plugins/plugin-bottom-bar/src/MediaPreviewOverlay.vue','packages/plugins/plugin-agent/src/components/AgentConversation.vue'];
for(const f of files){const s=fs.readFileSync(f,'utf8').split(/\r?\n/);console.log('== '+f);s.forEach((l,i)=>{if(l.includes('AxImageViewer'))console.log('  '+(i+1)+' '+l.trim().slice(0,140));});}
