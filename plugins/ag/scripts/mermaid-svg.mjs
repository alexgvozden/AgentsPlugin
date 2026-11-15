// mermaid-svg.mjs - a small, offline subset of Mermaid for the plan pages: flowcharts (graph,
// flowchart) and sequence diagrams drawn as inline SVG, with no outside script. Colours come from
// the page's CSS variables, so the diagrams follow light and dark mode. A diagram it cannot read
// gives null, and the page shows the diagram's source instead (GitHub still draws it).
//
// Flowcharts: TD, TB, LR, RL, BT; nodes id, id[..], id(..), id([..]), id[(..)], id((..)), id{..},
// id{{..}}, id[[..]], id[/../], id>..]; edges -->, ---, -.->, ==>, --o, --x, <-->, with labels as
// -->|text| or -- text -->; chains (a --> b --> c) and a & b --> c. A subgraph tints its nodes and
// gets a line in the legend. class, classDef, style, linkStyle and click are skipped.
// Sequence diagrams: participant and actor (with "as"), ->>, -->>, ->, -->, -x, --x, -), --),
// notes (left of, right of, over), loop, alt/else, opt, par/and, critical, break, rect, autonumber.

import { esc } from './ideas.mjs'

const CW = 7.2
const LH = 16
const r1 = (n) => Math.round(n * 10) / 10
const tw = (s) => Math.ceil([...String(s)].length * CW)

function clean(t) {
  return String(t ?? '').trim().replace(/^"([\s\S]*)"$/, '$1').replace(/^`([\s\S]*)`$/, '$1').replace(/#quot;/g, '"').replace(/#amp;/g, '&').replace(/\*\*/g, '').trim()
}

function wrap(text, max = 24) {
  const out = []
  for (const part of String(text).split(/<br\s*\/?>|\\n/i)) {
    let line = ''
    for (const w of part.trim().split(/\s+/)) {
      if (!w) continue
      if (line && (line + ' ' + w).length > max) { out.push(line); line = w } else line = line ? `${line} ${w}` : w
    }
    out.push(line)
  }
  return out.length ? out : ['']
}

function text(lines, x, y, cls = 'mm-t') {
  const y0 = y - ((lines.length - 1) * LH) / 2
  return `<text class="${cls}" x="${r1(x)}" y="${r1(y0)}" text-anchor="middle" dominant-baseline="central">${lines.map((l, i) => `<tspan x="${r1(x)}" dy="${i ? LH : 0}">${esc(l)}</tspan>`).join('')}</text>`
}

const marker = (id, cls = 'mm-ah') => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="${cls}" d="M0,0 L10,5 L0,10 z"/></marker>`
const crossMarker = (id) => `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path class="mm-x" d="M1,1 L9,9 M9,1 L1,9"/></marker>`

function svgWrap(w, h, inner, label, uid) {
  const W = Math.ceil(w)
  const H = Math.ceil(h)
  return `<svg class="mm" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="min-width:${Math.min(W, 540)}px" role="img" aria-label="${esc(label)}"><defs>${marker(`mma${uid}`)}${crossMarker(`mmx${uid}`)}</defs>${inner}</svg>`
}

// ---------- flowcharts ----------

const SHAPES = [
  ['(((', ')))', 'circle'], ['((', '))', 'circle'], ['([', '])', 'stadium'], ['[(', ')]', 'db'], ['[[', ']]', 'sub'],
  ['[/', '/]', 'para'], ['[\\', '\\]', 'para'], ['[/', '\\]', 'trap'], ['[\\', '/]', 'trap'], ['{{', '}}', 'hex'],
  ['(', ')', 'round'], ['[', ']', 'rect'], ['{', '}', 'diamond'], ['>', ']', 'flag'],
]
const SKIP = /^(?:%%|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|accTitle\b|accDescr\b)/
const EDGE_PLAIN = /^\s*(<?)(-{2,}>|={2,}>|-\.+->|-{3,}|={3,}|-\.+-|--[ox](?!\w)|==[ox](?!\w))(?:\s*\|([^|]*)\|)?/
const EDGE_TEXT = /^\s*(<?)(--|==|-\.)(?![-=.>])\s*([^|]+?)\s*(-{2,}>|={2,}>|\.-+>|-{3,}|={3,}|\.-+)(?=\s*[\w])/

function readNode(s, i) {
  const m = /^\s*([A-Za-z0-9_][\w]*)/.exec(s.slice(i))
  if (!m) return null
  const id = m[1]
  let j = i + m[0].length
  let found = { id, text: null, shape: null, end: j }
  for (const [open, close, shape] of SHAPES) {
    if (!s.startsWith(open, j)) continue
    let k = j + open.length
    const q = /^\s*"/.exec(s.slice(k))
    if (q) {
      const e = s.indexOf('"', k + q[0].length)
      if (e < 0) return null
      const c = s.indexOf(close, e + 1)
      if (c < 0 || s.slice(e + 1, c).trim()) continue
      found = { id, text: s.slice(k + q[0].length, e), shape, end: c + close.length }
      break
    }
    const c = s.indexOf(close, k)
    if (c < 0) continue
    found = { id, text: s.slice(k, c), shape, end: c + close.length }
    break
  }
  const cls = /^:::[\w-]+/.exec(s.slice(found.end))
  if (cls) found.end += cls[0].length
  return found
}

function parseFlow(lines) {
  const head = /^(?:flowchart|graph)(?:\s+(TD|TB|LR|RL|BT))?\s*;?\s*$/i.exec(lines[0])
  if (!head) return null
  const g = { dir: (head[1] || 'TD').toUpperCase().replace('TB', 'TD'), nodes: new Map(), edges: [], groups: [] }
  const stack = []
  const add = (n) => {
    let x = g.nodes.get(n.id)
    if (!x) { x = { id: n.id, text: n.id, shape: 'rect', group: null }; g.nodes.set(n.id, x) }
    if (n.text != null) { x.text = clean(n.text) || ' '; x.shape = n.shape }
    if (x.group == null && stack.length) x.group = stack[stack.length - 1]
  }
  for (const raw of lines.slice(1)) {
    for (const st of raw.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim()).filter(Boolean)) {
      if (SKIP.test(st)) continue
      const sg = /^subgraph\s+(.*)$/i.exec(st)
      if (sg) {
        const t = /^([\w-]+)\s*\[\s*(.*?)\s*\]$/.exec(sg[1].trim())
        g.groups.push(clean(t ? t[2] : sg[1]))
        stack.push(g.groups.length - 1)
        continue
      }
      if (/^end$/i.test(st)) { stack.pop(); continue }
      let i = 0
      let prev = null
      for (;;) {
        const group = []
        for (;;) {
          const n = readNode(st, i)
          if (!n) return null
          group.push(n)
          i = n.end
          const amp = /^\s*&/.exec(st.slice(i))
          if (!amp) break
          i += amp[0].length
        }
        for (const n of group) add(n)
        if (prev) for (const a of prev.nodes) for (const b of group) g.edges.push({ from: a.id, to: b.id, ...prev.edge })
        const rest = st.slice(i)
        if (!rest.trim()) break
        let m = EDGE_PLAIN.exec(rest)
        let tok
        let label
        if (m) { tok = m[2]; label = m[3] } else if ((m = EDGE_TEXT.exec(rest))) { tok = m[2] + m[4]; label = m[3] } else return null
        i += m[0].length
        prev = { nodes: group, edge: { label: label ? clean(label) : '', dotted: tok.includes('.'), thick: tok.includes('='), head: /[>]$/.test(tok) ? 'arrow' : /x$/.test(tok) ? 'cross' : /o$/.test(tok) ? 'arrow' : null, both: m[1] === '<' } }
      }
    }
  }
  return g.nodes.size ? g : null
}

function sizeNode(n, horiz) {
  const diamond = n.shape === 'diamond'
  n.lines = wrap(n.text, diamond ? 16 : horiz ? 22 : 24)
  const w = Math.max(...n.lines.map(tw), 10)
  const h = n.lines.length * LH
  let W = w + 28
  let H = h + 18
  if (diamond) { W = w * 1.5 + 36; H = h * 2.6 + 14 }
  else if (n.shape === 'circle') { W = H = Math.max(w, h) + 30 }
  else if (n.shape === 'hex' || n.shape === 'para' || n.shape === 'trap' || n.shape === 'flag') W = w + 50
  else if (n.shape === 'db') H = h + 30
  else if (n.shape === 'sub') W = w + 40
  n.w = Math.max(W, 64)
  n.h = Math.max(H, 36)
}

function shapeSvg(n) {
  const { x, y, w, h } = n
  const l = x - w / 2
  const t = y - h / 2
  const cls = `mm-n${n.group != null ? ` mm-g${n.group % 6}` : ''}`
  const poly = (pts) => `<polygon class="${cls}" points="${pts.map(([a, b]) => `${r1(a)},${r1(b)}`).join(' ')}"/>`
  switch (n.shape) {
    case 'circle': return `<circle class="${cls}" cx="${r1(x)}" cy="${r1(y)}" r="${r1(w / 2)}"/>`
    case 'diamond': return poly([[x, t], [l + w, y], [x, t + h], [l, y]])
    case 'hex': return poly([[l + 16, t], [l + w - 16, t], [l + w, y], [l + w - 16, t + h], [l + 16, t + h], [l, y]])
    case 'para': return poly([[l + 14, t], [l + w, t], [l + w - 14, t + h], [l, t + h]])
    case 'trap': return poly([[l + 14, t], [l + w - 14, t], [l + w, t + h], [l, t + h]])
    case 'flag': return poly([[l, t], [l + w, t], [l + w, t + h], [l, t + h], [l + 14, y]])
    case 'db': {
      const ry = 7
      return `<path class="${cls}" d="M${r1(l)},${r1(t + ry)} A${r1(w / 2)},${ry} 0 0 1 ${r1(l + w)},${r1(t + ry)} L${r1(l + w)},${r1(t + h - ry)} A${r1(w / 2)},${ry} 0 0 1 ${r1(l)},${r1(t + h - ry)} Z"/><path class="${cls}" style="fill:none" d="M${r1(l)},${r1(t + ry)} A${r1(w / 2)},${ry} 0 0 0 ${r1(l + w)},${r1(t + ry)}"/>`
    }
    case 'sub': return `<rect class="${cls}" x="${r1(l)}" y="${r1(t)}" width="${r1(w)}" height="${r1(h)}" rx="4"/><path class="mm-e" d="M${r1(l + 8)},${r1(t)} V${r1(t + h)} M${r1(l + w - 8)},${r1(t)} V${r1(t + h)}"/>`
    default: {
      const rx = n.shape === 'stadium' ? h / 2 : n.shape === 'round' ? 14 : 6
      return `<rect class="${cls}" x="${r1(l)}" y="${r1(t)}" width="${r1(w)}" height="${r1(h)}" rx="${r1(rx)}"/>`
    }
  }
}

function layoutFlow(g, uid) {
  const horiz = g.dir === 'LR' || g.dir === 'RL'
  const nodes = [...g.nodes.values()]
  nodes.forEach((n, i) => { n.i = i; sizeNode(n, horiz) })
  const byId = g.nodes
  // Back edges (those closing a cycle) are found by a depth-first walk in the order nodes appear.
  const out = new Map(nodes.map((n) => [n.id, []]))
  g.edges.forEach((e, k) => out.get(e.from).push(k))
  const state = new Map()
  const back = new Set()
  const walk = (u) => {
    state.set(u, 1)
    for (const k of out.get(u)) {
      const v = g.edges[k].to
      if (state.get(v) === 1) back.add(k)
      else if (!state.get(v)) walk(v)
    }
    state.set(u, 2)
  }
  for (const n of nodes) if (!state.get(n.id)) walk(n.id)
  const fwd = g.edges.filter((e, k) => !back.has(k) && e.from !== e.to)
  // Rank: the longest path from a source; a source is then pulled down next to what it feeds.
  for (const n of nodes) n.rank = 0
  for (let p = 0; p < nodes.length; p++) {
    let changed = false
    for (const e of fwd) { const a = byId.get(e.from), b = byId.get(e.to); if (b.rank < a.rank + 1) { b.rank = a.rank + 1; changed = true } }
    if (!changed) break
  }
  for (const n of nodes) {
    if (fwd.some((e) => e.to === n.id)) continue
    const succ = fwd.filter((e) => e.from === n.id).map((e) => byId.get(e.to).rank)
    if (succ.length) n.rank = Math.min(...succ) - 1
  }
  const ranks = []
  for (const n of nodes) (ranks[n.rank] ||= []).push(n)
  const layers = ranks.filter(Boolean)
  layers.forEach((L, ri) => L.forEach((n, k) => { n.layer = ri; n.pos = k }))
  // Order within each layer by the mean place of the neighbours (a few sweeps down and up).
  const nb = new Map(nodes.map((n) => [n.id, { up: [], down: [] }]))
  for (const e of g.edges) {
    if (e.from === e.to) continue
    const a = byId.get(e.from), b = byId.get(e.to)
    const [hi, lo] = a.layer <= b.layer ? [a, b] : [b, a]
    nb.get(lo.id).up.push(hi)
    nb.get(hi.id).down.push(lo)
  }
  for (let s = 0; s < 6; s++) {
    const down = s % 2 === 0
    const order = down ? layers : [...layers].reverse()
    for (const L of order) {
      for (const n of L) {
        const ns = nb.get(n.id)[down ? 'up' : 'down']
        n.bc = ns.length ? ns.reduce((t, x) => t + x.pos, 0) / ns.length : n.pos
      }
      L.sort((a, b) => a.bc - b.bc || a.i - b.i)
      L.forEach((n, k) => { n.pos = k })
    }
  }
  // Places: along the flow by layer; across it side by side, each layer centred.
  // Each gap between layers is as wide as the labels of the edges that cross it need.
  const gapAfter = layers.map((_, ri) => {
    const crossing = g.edges.filter((e) => {
      if (!e.label) return false
      const r1 = byId.get(e.from).rank, r2 = byId.get(e.to).rank
      return Math.min(r1, r2) <= ri && Math.max(r1, r2) > ri
    })
    if (!crossing.length) return horiz ? 56 : 48
    if (!horiz) return 76
    return Math.max(80, ...crossing.map((e) => Math.max(...wrap(e.label, 20).map(tw)) + 44))
  })
  const gapAcross = horiz ? 26 : 34
  const along = (n) => (horiz ? n.w : n.h)
  const across = (n) => (horiz ? n.h : n.w)
  const spans = layers.map((L) => L.reduce((t, n) => t + across(n), 0) + gapAcross * (L.length - 1))
  const widest = Math.max(...spans)
  let a = 0
  layers.forEach((L, ri) => {
    const depth = Math.max(...L.map(along))
    let c = (widest - spans[ri]) / 2
    for (const n of L) {
      const ac = c + across(n) / 2
      const al = a + depth / 2
      if (horiz) { n.x = al; n.y = ac } else { n.x = ac; n.y = al }
      c += across(n) + gapAcross
    }
    a += depth + gapAfter[ri]
  })
  const totalAlong = a - gapAfter[layers.length - 1]
  // Edges as cubic curves; back edges loop round the side, self edges round the corner.
  const parts = []
  const labels = []
  let extra = 0
  for (const e of g.edges) {
    const A = byId.get(e.from), B = byId.get(e.to)
    let d
    let mid
    if (A === B) {
      const sx = horiz ? A.x + 10 : A.x + A.w / 2
      const sy = horiz ? A.y + A.h / 2 : A.y - 8
      d = horiz ? `M${r1(A.x - 10)},${r1(sy)} C${r1(A.x - 26)},${r1(sy + 36)} ${r1(sx + 16)},${r1(sy + 36)} ${r1(sx)},${r1(sy)}` : `M${r1(sx)},${r1(sy)} C${r1(sx + 40)},${r1(sy - 26)} ${r1(sx + 40)},${r1(sy + 42)} ${r1(sx)},${r1(sy + 16)}`
      mid = horiz ? [A.x, sy + 34] : [sx + 36, A.y]
      extra = Math.max(extra, 46)
    } else if (A.layer < B.layer) {
      const p1 = horiz ? [A.x + A.w / 2, A.y] : [A.x, A.y + A.h / 2]
      const p2 = horiz ? [B.x - B.w / 2, B.y] : [B.x, B.y - B.h / 2]
      const k = (horiz ? p2[0] - p1[0] : p2[1] - p1[1]) * 0.5
      const c1 = horiz ? [p1[0] + k, p1[1]] : [p1[0], p1[1] + k]
      const c2 = horiz ? [p2[0] - k, p2[1]] : [p2[0], p2[1] - k]
      d = `M${r1(p1[0])},${r1(p1[1])} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`
      mid = [(p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8, (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8]
    } else if (A.layer === B.layer) {
      const before = A.pos < B.pos
      const p1 = horiz ? [A.x, A.y + (before ? A.h / 2 : -A.h / 2)] : [A.x + (before ? A.w / 2 : -A.w / 2), A.y]
      const p2 = horiz ? [B.x, B.y + (before ? -B.h / 2 : B.h / 2)] : [B.x + (before ? -B.w / 2 : B.w / 2), B.y]
      d = `M${r1(p1[0])},${r1(p1[1])} L${r1(p2[0])},${r1(p2[1])}`
      mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
    } else {
      // Back edge: out of the far side of both nodes and round, clear of the layers between.
      const side = horiz ? Math.max(A.y + A.h / 2, B.y + B.h / 2) : Math.max(A.x + A.w / 2, B.x + B.w / 2)
      const off = side + 34
      const p1 = horiz ? [A.x, A.y + A.h / 2] : [A.x + A.w / 2, A.y]
      const p2 = horiz ? [B.x, B.y + B.h / 2] : [B.x + B.w / 2, B.y]
      const c1 = horiz ? [p1[0], off] : [off, p1[1]]
      const c2 = horiz ? [p2[0], off] : [off, p2[1]]
      d = `M${r1(p1[0])},${r1(p1[1])} C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`
      mid = [(p1[0] + 3 * c1[0] + 3 * c2[0] + p2[0]) / 8, (p1[1] + 3 * c1[1] + 3 * c2[1] + p2[1]) / 8]
      const reach = (horiz ? mid[1] : mid[0]) - widest + 30
      extra = Math.max(extra, reach, 30)
    }
    const cls = `mm-e${e.dotted ? ' mm-dot' : ''}${e.thick ? ' mm-thick' : ''}`
    const end = e.head === 'arrow' ? ` marker-end="url(#mma${uid})"` : e.head === 'cross' ? ` marker-end="url(#mmx${uid})"` : ''
    const start = e.both ? ` marker-start="url(#mma${uid})"` : ''
    parts.push(`<path class="${cls}" d="${d}"${end}${start}/>`)
    if (e.label) {
      const ls = wrap(e.label, 20)
      const w = Math.max(...ls.map(tw)) + 10
      const h = ls.length * LH + 4
      labels.push({ ls, w, h, x: mid[0], y: mid[1] })
    }
  }
  const pad = 14
  let W = (horiz ? totalAlong : widest) + (horiz ? 0 : extra)
  let H = (horiz ? widest : totalAlong) + (horiz ? extra : 0)
  // Legend: one line for each subgraph, in its tint.
  let legend = ''
  if (g.groups.length) {
    let lx = 0
    let ly = H + 18
    g.groups.forEach((name, i) => {
      const w = tw(name) + 30
      if (lx && lx + w > Math.max(W, 300)) { lx = 0; ly += 24 }
      legend += `<rect class="mm-n mm-g${i % 6}" x="${r1(lx)}" y="${r1(ly - 7)}" width="14" height="14" rx="3"/><text class="mm-t mm-lt" x="${r1(lx + 20)}" y="${r1(ly)}" dominant-baseline="central">${esc(name)}</text>`
      lx += w + 14
      W = Math.max(W, lx)
    })
    H = ly + 12
  }
  // BT and RL: the edges are mirrored as a group; nodes and labels move to the mirrored place
  // but are drawn upright, so their text reads the right way round.
  const flip = g.dir === 'BT' ? `translate(0 ${r1(totalAlong)}) scale(1 -1)` : g.dir === 'RL' ? `translate(${r1(totalAlong)} 0) scale(-1 1)` : ''
  const m = (x, y) => (g.dir === 'BT' ? [x, totalAlong - y] : g.dir === 'RL' ? [totalAlong - x, y] : [x, y])
  for (const n of nodes) [n.x, n.y] = m(n.x, n.y)
  for (const l of labels) [l.x, l.y] = m(l.x, l.y)
  const edges = `<g class="mm-edges"${flip ? ` transform="${flip}"` : ''}>${parts.join('')}</g>`
  const nodeOut = nodes.map((n) => shapeSvg(n) + text(n.lines, n.x, n.y)).join('')
  const labelOut = labels.map((l) => `<rect class="mm-lb" x="${r1(l.x - l.w / 2)}" y="${r1(l.y - l.h / 2)}" width="${r1(l.w)}" height="${r1(l.h)}" rx="4"/>${text(l.ls, l.x, l.y, 'mm-t mm-lt')}`).join('')
  return svgWrap(W + pad * 2, H + pad * 2, `<g transform="translate(${pad} ${pad})">${edges}${nodeOut}${labelOut}${legend}</g>`, `Flowchart: ${nodes.slice(0, 6).map((n) => n.text).join(', ')}${nodes.length > 6 ? '…' : ''}`, uid)
}

// ---------- sequence diagrams ----------

const ARROWS = /^([\w.]+)\s*(-->>|->>|--x|-x|--\)|-\)|-->|->)\s*[+-]?\s*([\w.]+)\s*(?::\s*(.*))?$/

function parseSeq(lines) {
  if (!/^sequenceDiagram\s*$/i.test(lines[0])) return null
  const parts = new Map()
  const items = []
  let auto = false
  const part = (id, label, actor) => {
    if (!parts.has(id)) parts.set(id, { id, label: label || id, actor: !!actor })
    else if (label) parts.get(id).label = label
  }
  for (const l of lines.slice(1)) {
    let m
    if (!l || /^(?:%%|activate\b|deactivate\b|title\b|links?\b|properties\b|details\b|accTitle\b|accDescr\b|create\b|destroy\b)/i.test(l)) continue
    if (/^autonumber\b/i.test(l)) { auto = true; continue }
    if ((m = /^(participant|actor)\s+([\w.]+)(?:\s+as\s+(.+))?$/i.exec(l))) { part(m[2], m[3] && clean(m[3]), /actor/i.test(m[1])); continue }
    if ((m = /^box\b/i.exec(l))) { items.push({ t: 'open', kind: 'box', hidden: true }); continue }
    if ((m = /^(loop|alt|opt|par|critical|break|rect)\b\s*(.*)$/i.exec(l))) { items.push({ t: 'open', kind: m[1].toLowerCase(), label: m[1].toLowerCase() === 'rect' ? '' : clean(m[2]) }); continue }
    if ((m = /^(else|and|option)\b\s*(.*)$/i.exec(l))) { items.push({ t: 'else', label: clean(m[2]) }); continue }
    if (/^end\s*$/i.test(l)) { items.push({ t: 'end' }); continue }
    if ((m = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(l))) {
      const ids = m[2].split(',').map((x) => x.trim()).filter(Boolean)
      for (const id of ids) part(id)
      items.push({ t: 'note', where: m[1].toLowerCase(), ids, text: clean(m[3]) })
      continue
    }
    if ((m = ARROWS.exec(l))) {
      part(m[1]); part(m[3])
      const a = m[2]
      items.push({ t: 'msg', from: m[1], to: m[3], text: clean(m[4] || ''), dashed: a.startsWith('--'), head: /x$/.test(a) ? 'cross' : />>$|\)$/.test(a) ? 'arrow' : null })
      continue
    }
    return null
  }
  if (!parts.size) return null
  return { parts: [...parts.values()], items, auto }
}

function layoutSeq(s, uid) {
  const P = s.parts
  const idx = new Map(P.map((p, i) => [p.id, i]))
  for (const p of P) { p.lines = wrap(p.label, 18); p.w = Math.max(Math.max(...p.lines.map(tw)) + 26, 96); p.h = p.lines.length * LH + (p.actor ? 44 : 18) }
  const boxH = Math.max(...P.map((p) => p.h))
  // Gaps between neighbouring lifelines: wide enough for the boxes and the messages between them.
  const gap = P.map((p, i) => (i ? P[i - 1].w / 2 + p.w / 2 + 34 : 0))
  let n = 0
  for (const it of s.items) {
    if (it.t !== 'msg') continue
    n++
    it.label = (s.auto ? `${n}. ` : '') + it.text
    it.lines = it.label ? wrap(it.label, 44) : []
    const need = Math.max(0, ...it.lines.map(tw)) + 30
    const a = idx.get(it.from), b = idx.get(it.to)
    if (a === b) { if (a + 1 < P.length) gap[a + 1] = Math.max(gap[a + 1], need + 40); else it.tail = need + 40; continue }
    const [lo, hi] = a < b ? [a, b] : [b, a]
    let have = 0
    for (let k = lo + 1; k <= hi; k++) have += gap[k]
    if (have < need) gap[hi] += need - have
  }
  for (const it of s.items) {
    if (it.t !== 'note') continue
    it.lines = wrap(it.text, 30)
    it.w = Math.max(...it.lines.map(tw)) + 20
    if (it.ids.length === 1 && it.where === 'over') {
      const a = idx.get(it.ids[0])
      if (a + 1 < P.length) gap[a + 1] = Math.max(gap[a + 1], it.w / 2 + P[a + 1].w / 2 + 12)
    }
  }
  const left = Math.max(P[0].w / 2, ...s.items.filter((it) => it.t === 'note' && it.where === 'left of' && idx.get(it.ids[0]) === 0).map((it) => it.w + 12)) + 14
  const xs = []
  let x = left
  P.forEach((p, i) => { x += gap[i]; xs.push(x) })
  const lastX = xs[xs.length - 1]
  let right = lastX + P[P.length - 1].w / 2
  for (const it of s.items) {
    if (it.tail) right = Math.max(right, lastX + it.tail)
    if (it.t === 'note' && it.where === 'right of') right = Math.max(right, xs[idx.get(it.ids[0])] + 12 + it.w)
  }
  const fr = []
  const msgs = []
  const notes = []
  const stack = []
  let y = boxH + 22
  for (const it of s.items) {
    if (it.t === 'msg') {
      const a = xs[idx.get(it.from)], b = xs[idx.get(it.to)]
      const cls = `mm-e${it.dashed ? ' mm-dot' : ''}`
      const end = it.head === 'arrow' ? ` marker-end="url(#mma${uid})"` : it.head === 'cross' ? ` marker-end="url(#mmx${uid})"` : ''
      const th = it.lines.length * LH
      if (a === b) {
        y += th + 4
        msgs.push(`<path class="${cls}" d="M${r1(a)},${r1(y)} C${r1(a + 46)},${r1(y - 4)} ${r1(a + 46)},${r1(y + 30)} ${r1(a + 3)},${r1(y + 26)}"${end}/>`)
        if (th) msgs.push(text(it.lines, a + 10 + Math.max(...it.lines.map(tw)) / 2, y - th / 2 - 2, 'mm-t mm-mt'))
        y += 26 + 18
      } else {
        y += th + 6
        if (th) msgs.push(text(it.lines, (a + b) / 2, y - th / 2 - 4, 'mm-t mm-mt'))
        msgs.push(`<line class="${cls}" x1="${r1(a)}" y1="${r1(y)}" x2="${r1(b + (b > a ? -2 : 2))}" y2="${r1(y)}"${end}/>`)
        y += 20
      }
    } else if (it.t === 'note') {
      const cs = it.ids.map((id) => xs[idx.get(id)])
      const h = it.lines.length * LH + 12
      let l
      let w = it.w
      if (it.where === 'left of') l = cs[0] - 12 - w
      else if (it.where === 'right of') l = cs[0] + 12
      else if (cs.length > 1) { const lo = Math.min(...cs), hi = Math.max(...cs); w = Math.max(w, hi - lo + 40); l = (lo + hi) / 2 - w / 2 }
      else l = cs[0] - w / 2
      notes.push(`<rect class="mm-note" x="${r1(l)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" rx="4"/>${text(it.lines, l + w / 2, y + h / 2)}`)
      y += h + 14
    } else if (it.t === 'open') {
      stack.push({ ...it, y0: y, depth: stack.length })
      y += it.hidden ? 0 : it.label || it.kind ? 30 : 10
    } else if (it.t === 'else') {
      const f = stack[stack.length - 1]
      if (!f || f.hidden) continue
      const inset = 10 + f.depth * 8
      fr.push(`<line class="mm-fr mm-dot" x1="${r1(left - P[0].w / 2 - 4 + inset)}" y1="${r1(y)}" x2="${r1(right + 4 - inset)}" y2="${r1(y)}"/>`)
      if (it.label) fr.push(`<text class="mm-t mm-fl" x="${r1((left + right) / 2)}" y="${r1(y + 12)}" text-anchor="middle" dominant-baseline="central">[${esc(it.label)}]</text>`)
      y += 26
    } else if (it.t === 'end') {
      const f = stack.pop()
      if (!f || f.hidden) continue
      const inset = 10 + f.depth * 8
      const l = left - P[0].w / 2 - 4 + inset
      const w = right + 4 - inset - l
      const tag = f.kind === 'rect' ? '' : f.kind
      const tagW = tw(tag) + 16
      fr.push(`<rect class="mm-fr${f.kind === 'rect' ? ' mm-rect' : ''}" x="${r1(l)}" y="${r1(f.y0)}" width="${r1(w)}" height="${r1(y - f.y0 + 4)}" rx="4"/>`)
      if (tag) fr.push(`<path class="mm-tab" d="M${r1(l)},${r1(f.y0)} h${r1(tagW)} v12 l-6,8 h${r1(-tagW + 6)} z"/><text class="mm-t mm-fl" x="${r1(l + tagW / 2 - 2)}" y="${r1(f.y0 + 10)}" text-anchor="middle" dominant-baseline="central">${esc(tag)}</text>`)
      if (f.label) fr.push(`<text class="mm-t mm-lt" x="${r1(l + tagW + 8)}" y="${r1(f.y0 + 10)}" dominant-baseline="central">[${esc(f.label)}]</text>`)
      y += 14
    }
  }
  y += 10
  const bottom = y
  const lifes = xs.map((cx) => `<line class="mm-life" x1="${r1(cx)}" y1="${r1(boxH)}" x2="${r1(cx)}" y2="${r1(bottom)}"/>`).join('')
  const box = (p, cx, top) => {
    const t = top + (boxH - p.h) / 2
    if (!p.actor) return `<rect class="mm-n" x="${r1(cx - p.w / 2)}" y="${r1(t)}" width="${r1(p.w)}" height="${r1(p.h)}" rx="6"/>${text(p.lines, cx, top + boxH / 2)}`
    return `<circle class="mm-n" cx="${r1(cx)}" cy="${r1(t + 8)}" r="7"/><path class="mm-e" d="M${r1(cx)},${r1(t + 15)} v12 M${r1(cx - 10)},${r1(t + 19)} h20 M${r1(cx)},${r1(t + 27)} l-8,9 M${r1(cx)},${r1(t + 27)} l8,9"/>${text(p.lines, cx, t + 44 + ((p.lines.length - 1) * LH) / 2)}`
  }
  const boxes = P.map((p, i) => box(p, xs[i], 0) + box(p, xs[i], bottom)).join('')
  const W = right + 14
  const H = bottom + boxH
  return svgWrap(W + 16, H + 16, `<g transform="translate(8 8)">${fr.join('')}${lifes}${msgs.join('')}${notes.join('')}${boxes}</g>`, `Sequence diagram: ${P.map((p) => p.label).join(', ')}`, uid)
}

// The SVG for a Mermaid source, or null when it is not a kind or form drawn here.
export function mermaidSvg(src, uid = 1) {
  try {
    const lines = String(src ?? '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('%%'))
    if (!lines.length || lines.length > 400) return null
    if (/^(?:flowchart|graph)\b/i.test(lines[0])) { const g = parseFlow(lines); return g && g.nodes.size <= 120 ? layoutFlow(g, uid) : null }
    if (/^sequenceDiagram\b/i.test(lines[0])) { const s = parseSeq(lines); return s && s.parts.length <= 20 ? layoutSeq(s, uid) : null }
    return null
  } catch {
    return null
  }
}
