
const cp = require('child_process');
const origSpawnSync = cp.spawnSync;
cp.spawnSync = function (cmd, args, opts) {
  if (typeof cmd === 'string' && /esbuild(\.exe)?$/.test(cmd) && Array.isArray(args)) {
    return origSpawnSync.call(this, 'C:\\Windows\\System32\\cmd.exe', ['/c', cmd].concat(args), opts);
  }
  return origSpawnSync.call(this, cmd, args, opts);
};

