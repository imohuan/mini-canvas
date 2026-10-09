const fs = require("fs");
const path = require("path");
const dir = "I:/Assets/liblib-assets";
const full = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE, "Downloads/liblib_style_library.json"), "utf8"));

// 分类桶：名称对齐参考图的分类行；每桶给一组"命中即归入"的源标签（有序，先命中先用）
const BUCKETS = [
  ["摄影写真", ["摄影写真","商业摄影","人像摄影","艺术照","日常摄影","写实摄影","产品精修","摄影通用","人文摄影","美食摄影","宠物摄影","其他摄影","证件照"]],
  ["电商营销", ["电商产品","电商设计","头图/详情页","促销/折扣","商业零售","产品展示","营销推广","商品"]],
  ["动漫游戏", ["动漫游戏","亚洲动漫","欧美动漫","动漫/卡通","游戏设计","游戏原画","Q版/九头身","动漫通用","动漫/卡通","游戏"]],
  ["风格插画", ["插画/动画制作","艺术插画","插画设计","经典艺术插画","商业插画","现代创意插画","绘本","儿童插画","儿童绘本","新中式插画","复古中式插画"]],
  ["平面设计", ["平面设计","海报/Banner","海报设计","Logo/图标设计","Logo图标设计","Logo图标","符号图标logo","字体/封面设计","字体设计","品牌VI/包装","UI/PPT设计","独立icon"]],
  ["建筑及室内设计", ["建筑空间","住宅空间","家装设计","古代建筑","空间设计","空间建筑","空间场景","建筑设计","城市景观","餐饮空间","工业设计"]],
  ["创意玩法", ["创意物品","创意合成","创意场景","超现实","拟人化","贴纸挂件","梗图/表情包","涂鸦","纸艺拼贴","其他"]],
  ["文创周边", ["文创周边","玩具手办","盲盒手办","工艺品","珠宝玉石","卡牌桌游"]],
  ["小说推文", ["影视/小说","古代小说","现代小说","恐怖悬疑灵异"]],
];
const LABEL_TO_BUCKET = new Map();
for (const [bucket, labels] of BUCKETS) for (const l of labels) if (!LABEL_TO_BUCKET.has(l)) LABEL_TO_BUCKET.set(l, bucket);
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/u;

function pickCategory(tagsV2) {
  const order = ["newModelTag","modelContent","modelContent2","modelactivity"];
  const labels = [];
  for (const gk of order) {
    for (const g of (tagsV2 || [])) if (g.k === gk) for (const l of (g.labels||[])) if (!labels.includes(l)) labels.push(l);
  }
  for (const g of (tagsV2||[])) for (const l of (g.labels||[])) if (!labels.includes(l)) labels.push(l);
  for (const l of labels) { const b = LABEL_TO_BUCKET.get(l); if (b) return b; }
  return "";
}
function safeName(u) {
  const m = u.match(/([a-f0-9]{32}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-f0-9]{8}\/[a-f0-9]{64}\.[a-zA-Z0-9]+)$/) || u.match(/([a-zA-Z0-9_-]+\.[a-zA-Z0-9]+)$/);
  return m ? m[1].replace("/", "_") : ("img_" + [...u].reduce((a,c)=>((a*31+c.charCodeAt(0))|0),0).toString(36) + ".bin");
}
const have = new Set(fs.readdirSync(dir));
const items = []; let dropped = 0;
for (const x of full) {
  let extra = {}; try { extra = JSON.parse(x.extraInfo || "{}"); } catch(e) {}
  const urls = (extra.images && extra.images.length ? extra.images : (x.imageUrl ? [x.imageUrl] : []));
  const files = [];
  for (const u of urls) { const n = safeName(u); if (have.has(n)) files.push(n); else dropped++; }
  if (!files.length) continue;
  const tags = [];
  for (const g of (x.tagsV2 || [])) for (const l of (g.labels || [])) if (!tags.includes(l)) tags.push(l);
  items.push({ id: x.id, name: x.name || "", author: x.nickname || "", category: pickCategory(x.tagsV2) || "其他",
    modelType: x.modelType, modelTypeName: x.modelTypeName || "", baseType: x.baseType || [], tags,
    commercial: Array.isArray(x.privilege) && x.privilege.includes("1"), exclusive: tags.includes("独家"),
    runCount: typeof x.runCount === "number" ? x.runCount : 0, likeCount: typeof x.likeCount === "number" ? x.likeCount : 0,
    imageCount: typeof x.imageCount === "number" ? x.imageCount : files.length, images: files });
}
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(items), "utf8");
const cat = {}; items.forEach(i => cat[i.category] = (cat[i.category]||0)+1);
console.log("items=" + items.length, "images=" + items.reduce((a,b)=>a+b.images.length,0), "dropped=" + dropped);
console.log(JSON.stringify(Object.entries(cat).sort((a,b)=>b[1]-a[1])));

