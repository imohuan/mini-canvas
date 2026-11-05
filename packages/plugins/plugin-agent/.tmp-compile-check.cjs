const fs = require('fs')
const { parse, compileScript } = require('vue/compiler-sfc')
const src = fs.readFileSync(__dirname + '/src/ui/conversation/AgentMessageList.vue', 'utf8')
const { descriptor, errors } = parse(src, { filename: 'AgentMessageList.vue' })
console.log('parse errors:', errors.length, errors.map(String).join('; ').slice(0, 300))
try {
  compileScript(descriptor, { id: 'x', inlineTemplate: true })
  console.log('compileScript OK')
} catch (e) { console.log('compileScript fail:', e.message.slice(0, 500)) }
