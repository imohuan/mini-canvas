/*
 * 生成历史 · 卡片方案实验室
 *
 * 用户口径（2026-10-27 第三轮，方案 1 定为标准）：
 *   1. 只保留**流式（瀑布流）卡片**布局 —— 列表 / 表格类方案全部删掉；
 *   2. 资源**没有标题**，卡外只显示：宽高、文件大小；视频再加时长；
 *   3. 音频**没有宽高**（它没有画面），只显示时长与大小；
 *   4. 类型标签放在**卡外文字行的左侧**（不压图片）；
 *   5. 要有明确的**多选状态**。
 *
 * 纯静态页：只读 /api/history，不写任何数据；文件大小优先用历史里记的 media.bytes，
 * 老记录没有时就对资源发 HEAD 读 Content-Length 补上（后台资源接口本来就带这个头）。
 */
(function () {
  'use strict'

  var SCHEMES = [
    {
      id: 's1',
      name: '单行 · 标签左下',
      note: '基准方案。类型标签在左下角；卡外一行：宽高 · 大小（视频多时长，音频只有时长 · 大小）。',
      tags: ['基准', '标签左下', '单行'],
    },
    {
      id: 's2',
      name: '两行 · 信息右对齐',
      note: '与基准同样的标签位置；卡外信息分两行右对齐，视觉上像一条注释，卡间距更紧。',
      tags: ['紧凑', '两行', '右对齐'],
    },
    {
      id: 's3',
      name: '间距基线 · 标签左下',
      note: '与基准同排布，只把图片与文字之间的间距拉大、字号略大，用来对比"贴近 vs 留白"的感受。',
      tags: ['留白更大', '字号略大', '同一排布'],
    },
    {
      id: 's4',
      name: '底栏条 · 标签左下',
      note: '卡外一行信息带一层很浅的底色（仍在图片外），让"信息属于这张卡"更明确。',
      tags: ['浅色底', '分组清楚', '不遮图'],
    },
    {
      id: 's5',
      name: '极简 · 常显一行',
      note: '图片外只保留一行最淡的信息（同一行放下宽高 + 大小），字号更小、颜色更淡，让画面成为绝对主角。',
      tags: ['最安静', '极小字号', '仍是常显'],
    },
    {
      id: 's6',
      name: '当前实现（对照）',
      note: '现版本：尺寸/类型/时间压在图片底部的渐变条上，勾选钮压在图左上角。放最后，方便与上面五种对照。',
      tags: ['现状对照', '信息在卡内'],
    },
  ]

  var KIND_LABEL = { image: '图片', video: '视频', audio: '音频' }

  var ICON = {
    image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="1.6"/><path d="m21 15-4.5-4.5L6 21"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="2"/><path d="m16 10 6-3v10l-6-3"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>',
  }

  var state = { scheme: 's1', selecting: false, picks: {}, items: [] }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function fmtBytes(n) {
    if (!n || n <= 0) return ''
    var kb = 1024
    var mb = kb * 1024
    if (n >= mb) return (n / mb).toFixed(1) + ' MB'
    if (n >= kb) return Math.round(n / kb) + ' KB'
    return n + ' B'
  }

  function fmtDur(ms) {
    if (!ms || ms <= 0) return ''
    var total = Math.round(ms / 1000)
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0')
  }

  function fallbackArt(index, kind) {
    var palettes = [
      ['#e2e6e9', '#c6cdd3'],
      ['#e8e3dd', '#d2cac1'],
      ['#e0e7e5', '#c4d0cc'],
      ['#e5e1e8', '#cdc5d3'],
    ]
    var pair = palettes[index % palettes.length]
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + pair[0] + '"/><stop offset="1" stop-color="' + pair[1] + '"/>' +
      '</linearGradient></defs><rect width="480" height="360" fill="url(#g)"/>' +
      '<text x="240" y="186" text-anchor="middle" font-family="sans-serif" font-size="16" fill="#6b7280">' +
      (KIND_LABEL[kind] || '素材') + ' ' + (index + 1) + '</text></svg>'
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  function audioArt(seed) {
    var bars = ''
    for (var i = 0; i < 30; i++) {
      var h = 12 + Math.round(Math.abs(Math.sin((i + seed) * 1.7)) * 54)
      bars += '<i style="height:' + h + '%"></i>'
    }
    return '<div class="audio-art">' + bars + '</div>'
  }

  /** 多选：卡片左上角的方形勾选框（在图片外/图面上都不抢缩略图，这里放在卡片角上） */
  function pickBox(id) {
    var on = !!state.picks[id]
    return '<button class="pick' + (on ? ' on' : '') + '" type="button" role="checkbox" aria-checked="' +
      on + '" aria-label="选择这一项" data-pick="' + esc(id) + '">' + ICON.check + '</button>'
  }

  function fit(item) {
    return item.width && item.height ? item.width + ' / ' + item.height : '4 / 3'
  }

  /** 拿不到历史元数据时，用媒体自身补齐宽高（图片 naturalWidth / 视频 videoWidth） */
  function measure(el, item, card) {
    if (!el || (item.width && item.height)) return
    var w = el.naturalWidth || el.videoWidth || 0
    var h = el.naturalHeight || el.videoHeight || 0
    if (w > 0 && h > 0) {
      item.width = w
      item.height = h
      if (card) {
        var thumbEl = card.querySelector('.thumb')
        if (thumbEl) thumbEl.style.aspectRatio = w + ' / ' + h
        var factsEl = card.querySelector('.facts')
        if (factsEl) refreshFacts(card, item)
      }
    }
    if (item.kind === 'video' && !item.durationMs && isFinite(el.duration) && el.duration > 0) {
      item.durationMs = Math.round(el.duration * 1000)
      if (card) refreshFacts(card, item)
    }
  }

  /** 重画一张卡的卡外信息（尺寸补上后调用） */
  function refreshFacts(card, item) {
    var old = card.querySelector('.facts')
    if (!old) return
    var host = document.createElement('div')
    if (old.classList.contains('facts-rows')) {
      var dim = item.kind === 'audio' ? '' : item.width && item.height ? item.width + '×' + item.height : '尺寸未知'
      var rest = [item.kind === 'video' || item.kind === 'audio' ? fmtDur(item.durationMs) : '', fmtBytes(item.bytes)].filter(Boolean).join(' · ')
      host.innerHTML = (dim ? '<span>' + esc(dim) + '</span>' : '') + (rest ? '<span>' + esc(rest) + '</span>' : '')
      host.className = 'facts facts-rows'
    } else {
      host.innerHTML = '<span>' + esc(factLine(item)) + '</span>'
      host.className = old.className
    }
    old.replaceWith(host)
  }

  function thumb(item, index, opts) {
    var o = opts || {}
    var inner
    if (item.kind === 'audio') {
      inner = audioArt(index)
    } else if (item.kind === 'video') {
      // 视频封面：地址在本机服务上时用视频首帧；跨端地址（如 web2api 的 :8033）打不开就用占位图，
      // 不让它显示成一块空白 + "尺寸未知"（真机踩到）。
      var remote = /^https?:/i.test(item.url) || !item.url
      inner = remote
        ? '<img src="' + esc(fallbackArt(index, 'video')) + '" alt="" />'
        : '<video src="' + esc(item.url) + '#t=0.5" preload="metadata" muted playsinline></video>'
    } else {
      var src = item.url || fallbackArt(index, 'image')
      inner = '<img src="' + esc(src) + '" alt="" loading="lazy" data-fallback="' + esc(fallbackArt(index, 'image')) + '" />'
    }
    // 类型标签默认压在图片左下角（方案 1–4）；方案 5 用 noKind/noDur 把标签与时长移到卡外
    var kindTag = o.noKind ? '' : '<span class="kind">' + ICON[item.kind] + KIND_LABEL[item.kind] + '</span>'
    var durTag = !o.noDur && item.kind === 'video' && item.durationMs
      ? '<span class="dur">' + fmtDur(item.durationMs) + '</span>'
      : ''
    var info = o.noInfo ? '' : '<button class="info" type="button" title="详情" aria-label="查看生成参数">' + ICON.info + '</button>'
    return '<div class="thumb" style="' + (o.style || 'aspect-ratio:' + fit(item)) + '">' + inner + kindTag + durTag + info + '</div>'
  }

  /**
   * 卡外信息：宽高 / 时长（视频）/ 大小；没有标题。
   * 音频**没有宽高**（它没有画面），只显示时长 · 大小。
   */
  function facts(item, layout) {
    var dim = item.kind === 'audio' ? '' : item.width && item.height ? item.width + '×' + item.height : '尺寸未知'
    var size = fmtBytes(item.bytes)
    var dur = item.kind === 'video' || item.kind === 'audio' ? fmtDur(item.durationMs) : ''
    var parts = [dim, dur, size].filter(Boolean)
    if (layout === 'rows') {
      return '<div class="facts facts-rows">' +
        (parts.length ? '<span>' + esc(parts[0]) + '</span>' : '') +
        (parts.length > 1 ? '<span>' + esc(parts.slice(1).join(' · ')) + '</span>' : '') +
        '</div>'
    }
    return '<div class="facts"><span>' + esc(parts.join(' · ')) + '</span></div>'
  }

  /** 单行信息串（宽高 · 时长 · 大小；音频没有宽高） */
  function factLine(item) {
    var dim = item.kind === 'audio' ? '' : item.width && item.height ? item.width + '×' + item.height : '尺寸未知'
    var dur = item.kind === 'video' || item.kind === 'audio' ? fmtDur(item.durationMs) : ''
    return [dim, dur, fmtBytes(item.bytes)].filter(Boolean).join(' · ')
  }

  /** 卡外文字行：类型标签在左，后面跟尺寸（音频只有时长）与大小 */
  function kindLine(it) {
    var chip = '<span class="cap-kind">' + ICON[it.kind] + KIND_LABEL[it.kind] + '</span>'
    return '<div class="facts facts-quiet cap-line">' + chip + '<span class="cap-facts">' + esc(factLine(it)) + '</span></div>'
  }

  /**
   * 所有方案共用同一张卡的骨架：图片 + 卡外信息。
   * 标签位置由各方案决定（方案 5 在文字行左侧），信息一律不塞回图面。
   */
  function cell(it, i, extraClass, factsHtml) {
    var noKind = extraClass === 'quiet'
    return '<article class="cell' + (extraClass ? ' ' + extraClass : '') +
      (state.picks[it.id] ? ' selected' : '') + '" data-id="' + esc(it.id) + '">' +
      '<div class="frame">' + thumb(it, i, noKind ? { noKind: true, noDur: true } : undefined) + pickBox(it.id) + '</div>' +
      factsHtml +
      '</article>'
  }

  /* ---------------- 方案 1：基准（单行） ---------------- */
  function renderS1(items) {
    return '<div class="masonry m-4">' + items.map(function (it, i) {
      return cell(it, i, '', facts(it, 'line'))
    }).join('') + '</div>'
  }

  /* ---------------- 方案 2：两行 + 右对齐 + 更紧 ---------------- */
  function renderS2(items) {
    return '<div class="masonry m-4 tight">' + items.map(function (it, i) {
      return cell(it, i, 'rows', facts(it, 'rows'))
    }).join('') + '</div>'
  }

  /* ---------------- 方案 3：留白更大、字号略大 ---------------- */
  function renderS3(items) {
    return '<div class="masonry m-4">' + items.map(function (it, i) {
      return cell(it, i, 'roomy', facts(it, 'line'))
    }).join('') + '</div>'
  }

  /* ---------------- 方案 4：信息带浅色底 ---------------- */
  function renderS4(items) {
    return '<div class="masonry m-4">' + items.map(function (it, i) {
      return cell(it, i, 'banded', '<div class="facts facts-band"><span>' + esc(factLine(it)) + '</span></div>')
    }).join('') + '</div>'
  }

  /* ---------------- 方案 5：极简（更小更淡） ---------------- */
  function renderS5(items) {
    return '<div class="masonry m-4">' + items.map(function (it, i) {
      // 图上什么都不放：类型标签 + 尺寸/时长/大小都在图片外的一行里
      return cell(it, i, 'quiet', kindLine(it))
    }).join('') + '</div>'
  }

  /* ---------------- 方案 6：当前实现（对照） ---------------- */
  function renderS6(items) {
    return '<div class="masonry m-4">' + items.map(function (it, i) {
      var left = it.width && it.height ? it.width + '×' + it.height : ''
      if (it.kind === 'video' && it.durationMs) left += ' · ' + fmtDur(it.durationMs)
      if (it.bytes) left += ' · ' + fmtBytes(it.bytes)
      return '<article class="cell current' + (state.picks[it.id] ? ' selected' : '') + '" data-id="' + esc(it.id) + '">' +
        '<div class="current-media">' +
        thumb(it, i, { style: 'aspect-ratio:4 / 3', noInfo: true, noDur: true }) +
        '<span class="current-check sel-only"></span>' +
        '<div class="current-tags"><span>' + esc(left.trim()) + '</span>' +
        '<span>' + KIND_LABEL[it.kind] + '</span></div>' +
        '</div></article>'
    }).join('') + '</div>'
  }

  var RENDER = { s1: renderS1, s2: renderS2, s3: renderS3, s4: renderS4, s5: renderS5, s6: renderS6 }

  /* ---------------- 页面装配 ---------------- */
  function renderTabs() {
    var el = document.getElementById('tabs')
    el.innerHTML = SCHEMES.map(function (s, i) {
      return '<button class="lab-tab" type="button" role="tab" data-scheme="' + s.id + '" aria-selected="' +
        (state.scheme === s.id) + '">方案 ' + (i + 1) + (s.id === 's6' ? ' · 对照' : '') +
        '<small>' + esc(s.name) + '</small></button>'
    }).join('')
  }

  function renderScheme() {
    var index = 0
    for (var i = 0; i < SCHEMES.length; i++) if (SCHEMES[i].id === state.scheme) index = i
    var meta = SCHEMES[index]
    var items = state.items.slice(0, 12)
    var body = RENDER[state.scheme](items)
    var note = state.scheme === 's6'
      ? '<div class="note"><b>对照：</b>这一版把尺寸、类型、时间都贴在图片上，缩略图被渐变条吃掉一截，勾选也压在图面上。方案 1–5 都只用卡外的文字，且不再显示标题。</div>'
      : ''
    document.getElementById('scheme').innerHTML =
      '<div class="scheme-head"><div>' +
      '<div class="scheme-idx">SCHEME ' + String(index + 1).padStart(2, '0') + '</div>' +
      '<h2>' + esc(meta.name) + '</h2>' +
      '<p class="scheme-note">' + esc(meta.note) + '</p></div>' +
      '<div class="scheme-tags">' + meta.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>' }).join('') + '</div>' +
      '</div>' + body + note
    updateCount()
  }

  function updateCount() {
    var n = Object.keys(state.picks).length
    var el = document.getElementById('count')
    if (state.selecting) {
      el.innerHTML = '<b>已选 ' + n + ' 项</b><span class="sep">·</span><button class="link" id="clear-picks" type="button">清空</button>'
      var clear = document.getElementById('clear-picks')
      if (clear) clear.onclick = function () { state.picks = {}; refresh() }
    } else {
      el.textContent = '多选关闭时，卡片只展示尺寸与大小'
    }
    document.getElementById('batchbar').hidden = !state.selecting
    document.getElementById('batch-count').textContent = n
  }

  function refresh() {
    document.body.classList.toggle('selecting', state.selecting)
    renderTabs()
    renderScheme()
  }

  function togglePick(id) {
    if (!id) return
    if (state.picks[id]) delete state.picks[id]
    else state.picks[id] = true
    // 只刷新选择态，避免整块重绘（瀑布流高度不跳）
    var root = document.getElementById('scheme')
    var cells = root.querySelectorAll('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]')
    Array.prototype.forEach.call(cells, function (cell) {
      cell.classList.toggle('selected', !!state.picks[id])
      var box = cell.querySelector('.pick')
      if (box) {
        box.classList.toggle('on', !!state.picks[id])
        box.setAttribute('aria-checked', String(!!state.picks[id]))
      }
    })
    updateCount()
  }

  document.getElementById('tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-scheme]')
    if (!btn) return
    state.scheme = btn.getAttribute('data-scheme')
    refresh()
  })

  document.getElementById('selecting').addEventListener('change', function (e) {
    state.selecting = e.target.checked
    if (!state.selecting) state.picks = {}
    refresh()
  })

  document.getElementById('scheme').addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]')
    if (pick) {
      e.preventDefault()
      togglePick(pick.getAttribute('data-pick'))
      return
    }
    if (!state.selecting) return
    var cell = e.target.closest('[data-id]')
    if (!cell) return
    e.preventDefault()
    togglePick(cell.getAttribute('data-id'))
  })

  // 媒体加载出真实尺寸后补卡外信息（老记录没有 media 元数据）
  function onMediaReady(e) {
    var el = e.target
    if (!el || (el.tagName !== 'IMG' && el.tagName !== 'VIDEO')) return
    var card = el.closest('.cell')
    if (!card) return
    var id = card.getAttribute('data-id')
    var item = null
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) item = state.items[i]
    if (item) measure(el, item, card)
  }
  document.getElementById('scheme').addEventListener('load', onMediaReady, true)
  document.getElementById('scheme').addEventListener('loadedmetadata', onMediaReady, true)

  // 瀑布流的"流式"效果：按图片实际宽高排版（CSS columns 天然支持不同高度）
  document.getElementById('scheme').addEventListener('error', function (e) {
    var img = e.target
    if (!img || img.tagName !== 'IMG') return
    var fb = img.getAttribute('data-fallback')
    if (fb && img.src !== fb) img.src = fb
  }, true)

  function fillMissingBytes(items) {
    return Promise.all(items.map(function (it) {
      if (it.bytes > 0 || !it.url) return Promise.resolve(it)
      return fetch(it.url, { method: 'HEAD' })
        .then(function (r) {
          var n = Number(r.headers.get('content-length') || 0)
          if (n > 0) it.bytes = n
          return it
        })
        .catch(function () { return it })
    }))
  }

  function normalize(raw, kind, index) {
    var media = raw.media || {}
    return {
      id: raw.id || kind + '-' + index,
      kind: kind,
      url: (raw.urls && raw.urls[0]) || '',
      width: media.width || 0,
      height: media.height || 0,
      bytes: media.bytes || 0,
      durationMs: media.durationMs || 0,
    }
  }

  function setSource(text, ok) {
    document.getElementById('source-text').textContent = text
    document.getElementById('source-dot').classList.toggle('ok', !!ok)
  }

  function load() {
    var kinds = ['image', 'video', 'audio']
    Promise.all(kinds.map(function (k) {
      return fetch('/api/history?page=1&pageSize=14&kind=' + k)
        .then(function (r) { return r.ok ? r.json() : null })
        .catch(function () { return null })
    })).then(function (pages) {
      var all = []
      pages.forEach(function (page, idx) {
        var list = (page && page.items) || []
        list.forEach(function (raw) {
          if (!raw.urls || !raw.urls.length) return
          all.push(normalize(raw, kinds[idx], all.length))
        })
      })
      if (all.length < 4) throw new Error('history is empty')
      // 图片 / 视频 / 音频轮流排：每种方案都能看到三种卡（以前音频永远排在很后面，看不到）
      var imgs = all.filter(function (x) { return x.kind === 'image' })
      var vids = all.filter(function (x) { return x.kind === 'video' })
      var auds = all.filter(function (x) { return x.kind === 'audio' })
      var mixed = []
      var ii = 0, vi = 0, ai = 0
      while (ii < imgs.length || vi < vids.length || ai < auds.length) {
        if (imgs[ii]) mixed.push(imgs[ii++])
        if (imgs[ii]) mixed.push(imgs[ii++])
        if (vids[vi]) mixed.push(vids[vi++])
        if (auds[ai]) mixed.push(auds[ai++])
      }
      return fillMissingBytes(mixed.slice(0, 16)).then(function (filled) {
        state.items = filled
        setSource('已读取真实历史 ' + all.length + ' 条（图片 / 视频 / 音频）', true)
        refresh()
      })
    }).catch(function () {
      state.items = demoItems()
      setSource('未连上云端：下方为占位素材（布局效果不变；用 cloud-server 托管界面时可读真实记录）', false)
      refresh()
    })
  }

  function demoItems() {
    var kinds = ['image', 'image', 'video', 'image', 'audio', 'image', 'image', 'video', 'image', 'audio', 'image', 'image']
    return kinds.map(function (kind, i) {
      return {
        id: 'demo-' + i,
        kind: kind,
        url: '',
        width: 1024,
        height: i % 3 === 0 ? 1024 : 640,
        bytes: 320000 + i * 97000,
        durationMs: kind === 'video' ? 8000 : kind === 'audio' ? 12000 : 0,
      }
    })
  }

  refresh()
  load()
})()
