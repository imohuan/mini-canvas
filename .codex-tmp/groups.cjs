const fs = require("fs");
const path = require("path");
const full = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, "Downloads/liblib_style_library.json"), "utf8"));
// 按组统计：每个组在每个条目上"能不能出一个合格标签"
const GENERIC = new Set(["通用","主体","风格","创作手段","创作形式","垂类","行业","功能","精选","独家","设计/渲染通用","主体强化","全部","是"]);
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;
const good = (l) => !GENERIC.has(l) && !EMOJI_RE.test(l) && l.length <= 12;
const groupCov = {}; const groupLabels = {};
for (const x of full) {
  const seen = new Set();
  for (const g of (x.tagsV2 || [])) {
    const labels = (g.labels||[]).filter(good);
    if (labels.length) { groupCov[g.k] = (groupCov[g.k]||0)+1; if (!groupLabels[g.k]) groupLabels[g.k]=new Set(); labels.forEach(l=>groupLabels[g.k].add(l)); }
  }
}
for (const [k,v] of Object.entries(groupCov).sort((a,b)=>b[1]-a[1])) {
  console.log(k, v, "->", [...(groupLabels[k]||[])].slice(0,18).join(" | "));
}

