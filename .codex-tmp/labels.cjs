const fs = require("fs");
const path = require("path");
const full = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, "Downloads/liblib_style_library.json"), "utf8"));
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
const cnt = {};
for (const x of full) for (const g of (x.tagsV2||[])) for (const l of (g.labels||[])) {
  if (EMOJI_RE.test(l) || l.length > 12) continue;
  cnt[l] = (cnt[l]||0)+1;
}
const arr = Object.entries(cnt).sort((a,b)=>b[1]-a[1]);
console.log("全部合格标签数:", arr.length);
console.log(arr.map(([k,v])=>k+":"+v).join("  "));

