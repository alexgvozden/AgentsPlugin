#!/usr/bin/env node
// plan-page.mjs - the review page of a plan, for /ag:plan.
//
// Each plan has a folder of its own in the project:
//   plans/<yyyymmdd>-<slug>/plan.md     the plan: the source the goal runs read and mark
//   plans/<yyyymmdd>-<slug>/plan.html   made from it: the page the user reads, with an answer bar
// (a project that already keeps plans in .planning/ or docs/plans/ gets the folders there).
//
// Usage (run with --help for this text):
//   node plan-page.mjs folder <slug words> [--root <dir>]     print the new plan's path (plans/<date>-<slug>/plan.md)
//   node plan-page.mjs render <plan.md> [--strict]            check the plan and write plan.html next to it
//   node plan-page.mjs open   <plan.md> [--id <ref>] [--no-open]  open the page (at a step, phase or question)
//   node plan-page.mjs record [<plan.md>] --from <answers.txt>    record pasted answer lines into the plan
//   node plan-page.mjs refs   <plan.md>                       list the refs the page uses (PLAN, Q1, P1, 1.2, sections)
//
// The page shows every phase, step and section of the plan with its status, the open questions
// with their options, and a comment box on each. "Copy answer" gives lines such as
//   Plan: plans/20261115-plan-pages/plan.md
//   PLAN ok | PLAN changes: why
//   Q2 B | Q2 B: note | Q2: own words
//   1.2: a comment on step 1.2 | P1: a comment on phase 1 | Context: a comment on a section
// and `record` writes them into the plan: answers under their question in "Open questions",
// everything else as a dated line in its "Feedback" section ("— open" until /ag:plan acts on it).
// The page is never written by hand. Exit 0 ok, 1 check warnings with --strict, 2 bad input.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { ANSWER_JS, CSS, esc, launch, page, slugify, today } from './ideas.mjs'
import { mermaidSvg } from './mermaid-svg.mjs'

class InputError extends Error {}

const letterOf = (i) => String.fromCharCode(65 + i)
const plain = (t) => String(t ?? '').replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_]+|[*_]+(?=\s|$)/g, '$1').trim()
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- Markdown to HTML (escaped; links only to http(s), anchors and relative paths) ----------

const safeUrl = (u) => !/^\s*(?:javascript|data|vbscript):/i.test(u) && (/^(?:https?:\/\/|#|\.{0,2}\/)/i.test(u) || /^[\w][\w.\-/]*(?:#[\w.-]*)?$/.test(u))

export function inline(t) {
  const codes = []
  let s = String(t ?? '').replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
  s = esc(s)
  // Images first, kept aside so the link rule below does not touch them.
  const imgs = []
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*?&quot;)?\)/g, (m, alt, url) => {
    if (!safeUrl(url.replace(/&amp;/g, '&'))) return alt ? `[image: ${alt}]` : ''
    return `\u0001${imgs.push(`<a class="imga" href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${alt}" loading="lazy"></a>`) - 1}\u0001`
  })
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const raw = url.replace(/&amp;/g, '&')
    if (!safeUrl(raw)) return m
    return /^https?:/i.test(raw) ? `<a href="${url}" target="_blank" rel="noopener">${label}</a>` : `<a href="${url}">${label}</a>`
  })
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
  s = s.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>').replace(/__([^_]+?)__/g, '<b>$1</b>')
  s = s.replace(/(^|[^\w*])\*([^*\s](?:[^*]*?[^*\s])?)\*(?![\w*])/g, '$1<i>$2</i>')
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>')
  return s.replace(/\u0001(\d+)\u0001/g, (_, n) => imgs[Number(n)]).replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[Number(n)])}</code>`)
}

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const indentOf = (l) => l.replace(/\t/g, '    ').match(/^ */)[0].length
const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
export const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
const startsBlock = (l, next) => /^\s*(```|~~~)/.test(l) || /^#{1,6}\s/.test(l) || LIST.test(l) || /^\s*>/.test(l) || (/^\s*\|/.test(l) && next != null && isTableSep(next))

function dedent(lines) {
  const n = Math.min(...lines.filter((l) => l.trim()).map(indentOf), Infinity)
  return n === Infinity || n === 0 ? lines : lines.map((l) => l.replace(/\t/g, '    ').slice(Math.min(n, indentOf(l))))
}

function listHtml(lines) {
  const base = indentOf(lines[0])
  const items = []
  for (const l of lines) {
    const m = l.match(LIST)
    if (m && indentOf(l) <= base + 1) items.push({ marker: m[2], text: m[3], rest: [] })
    else if (items.length) items[items.length - 1].rest.push(l)
  }
  const ordered = /\d/.test(items[0]?.marker ?? '')
  const li = items.map((it) => {
    let text = it.text
    let box = ''
    const cb = text.match(/^\[( |x|X)\]\s+(.*)$/)
    if (cb) { box = `<span class="box${cb[1] === ' ' ? '' : ' on'}" aria-hidden="true">${cb[1] === ' ' ? '' : '✓'}</span>`; text = cb[2] }
    const rest = it.rest.length ? blocks(dedent(it.rest)) : ''
    return `<li${box ? ' class="cb"' : ''}>${box}${inline(text)}${rest}</li>`
  }).join('')
  return ordered ? `<ol>${li}</ol>` : `<ul>${li}</ul>`
}

// Diagram numbers give each SVG its own marker ids; renderPlan starts them at 0 for each page.
let diagrams = 0

export function blocks(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.trim()) { i++; continue }
    let m
    if ((m = l.match(/^\s*(```+|~~~+)\s*([\w-]+)?/))) {
      const buf = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(m[1])) buf.push(lines[i++])
      i++
      const code = dedent(buf).join('\n')
      const pre = `<pre class="code"><code>${esc(code)}</code></pre>`
      if ((m[2] || '').toLowerCase() === 'mermaid') {
        const svg = mermaidSvg(code, ++diagrams)
        out.push(svg
          ? `<figure class="mm-fig"><div class="mm-scroll">${svg}</div><details class="mm-src"><summary>Diagram source</summary>${pre}</details></figure>`
          : `<figure class="mm-fig"><p class="mm-none">This kind of diagram is not drawn here; GitHub and other Mermaid viewers draw it. Its source:</p>${pre}</figure>`)
      } else out.push(pre)
      continue
    }
    if ((m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/))) { out.push(`<h4>${inline(m[2])}</h4>`); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { out.push('<hr>'); i++; continue }
    if (/^\s*\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l)
      i += 2
      const rows = []
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]))
      out.push(`<div class="tw"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
      continue
    }
    if (/^\s*>/.test(l)) {
      const buf = []
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push(`<blockquote>${blocks(buf)}</blockquote>`)
      continue
    }
    if (LIST.test(l)) {
      const base = indentOf(l)
      const buf = [l]
      i++
      while (i < lines.length) {
        const x = lines[i]
        if (!x.trim()) {
          const next = lines.slice(i + 1).find((y) => y.trim())
          if (next != null && (indentOf(next) > base || (LIST.test(next) && indentOf(next) === base))) { buf.push(x); i++; continue }
          break
        }
        if (indentOf(x) > base || (LIST.test(x) && indentOf(x) >= base)) { buf.push(x); i++; continue }
        if (!startsBlock(x, lines[i + 1]) && indentOf(x) === base && !LIST.test(x) && buf[buf.length - 1].trim()) { buf.push('  '.repeat(1) + ' '.repeat(base) + x.trim()); i++; continue }
        break
      }
      out.push(listHtml(buf))
      continue
    }
    const buf = [l.trim()]
    i++
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i], lines[i + 1])) buf.push(lines[i++].trim())
    const img = buf.length === 1 && /^!\[([^\]]*)\]\([^)]*\)$/.exec(buf[0])
    const html = buf.map(inline).join(' ')
    out.push(img && html.startsWith('<a class="imga"') ? `<figure class="img">${html}${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>` : `<p>${html}</p>`)
  }
  return out.join('\n')
}

// ---------- reading the plan ----------

// The same heading ids as the goal-progress bar reads (hooks/progress.ts): "Phase 2: x" is P2;
// "1.2 x", "Step 1.2: x", "S16. x", "3.3-ui x" carry their id; other headings are sections.
const ID_HEAD = /^(?:(fix|step|task|story|epic)\s+)?([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?:\s*[.:]\s*|\s+[-—–]\s*|\s+|$)(.*)$/i
const isIdToken = (v) => /\d/.test(v) || /^[A-Z]{2,}$/.test(v)
const STATUS_LINE = /^(?:[-*+]\s+)?(?:\*\*|__)?Status(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/i
const QUESTIONS = /^(?:open\s+)?questions\b/i
const FEEDBACK = /^feedback\b/i

export function headingRef(text) {
  const t = plain(text)
  const ph = /^Phase\s+(\w[\w.]*)\s*(?:[.:—–-]\s*)?(.*)$/i.exec(t)
  if (ph && /\d/.test(ph[1])) return { ref: `P${ph[1]}`, title: plain(ph[2]) || t, kind: 'phase' }
  const h = ID_HEAD.exec(t)
  if (h && isIdToken(h[2]) && !/^\d{4}$/.test(h[2])) {
    const ref = h[1] ? `${h[1][0].toUpperCase()}${h[1].slice(1).toLowerCase()} ${h[2]}` : h[2]
    return { ref, title: plain(h[3]) || t, kind: /^P\d/i.test(h[2]) && !h[1] ? 'phase' : 'step' }
  }
  return { ref: t.replace(/[.:]+$/, ''), title: t, kind: 'section' }
}

export function statusClass(text) {
  const s = plain(text).toLowerCase()
  if (/^(?:✅|✔|☑|✓)/u.test(s) || /^done\b/.test(s)) return 'done'
  if (/^shown\b/.test(s)) return 'shown'
  if (/^waiting\b/.test(s)) return 'waiting'
  if (/^blocked\b/.test(s)) return 'blocked'
  if (/^(?:⏳|⌛|🔄)/u.test(s) || /^(?:running|doing|in progress|started)\b/.test(s)) return 'running'
  if (/^(?:todo|to do|not started|open|next)\b/.test(s)) return 'todo'
  return 'other'
}

// The plan as a tree of headings, each with its body lines (absolute line numbers kept for record).
export function parsePlan(text, file = 'plan.md') {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/)
  const heads = []
  let fence = null
  lines.forEach((l, i) => {
    const f = l.match(/^\s*(```+|~~~+)/)
    if (f) { if (!fence) fence = f[1]; else if (l.trim().startsWith(fence)) fence = null; return }
    if (fence) return
    const m = l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (m) heads.push({ level: m[1].length, text: m[2], line: i })
  })
  const root = { level: 0, text: '', line: -1, children: [], kind: 'root' }
  const stack = [root]
  heads.forEach((h, n) => {
    const end = n + 1 < heads.length ? heads[n + 1].line : lines.length
    const node = { ...h, ...headingRef(h.text), start: h.line + 1, end, children: [] }
    while (stack[stack.length - 1].level >= h.level) stack.pop()
    const parent = stack[stack.length - 1]
    node.parent = parent
    if (parent.kind === 'questions' || parent.inQuestions) node.inQuestions = true
    if (FEEDBACK.test(node.title) && node.kind === 'section') node.kind = 'feedback'
    else if (QUESTIONS.test(node.title) && node.kind === 'section') node.kind = 'questions'
    else if (node.inQuestions) node.kind = 'qhead'
    parent.children.push(node)
    stack.push(node)
  })
  root.start = 0
  root.end = heads.length ? heads[0].line : lines.length
  // The plan's title: its first level-1 heading (its body is the intro), else the file's name.
  const h1 = root.children.length === 1 && root.children[0].level === 1 ? root.children[0] : null
  const title = h1 ? plain(h1.text) : path.basename(path.dirname(path.resolve(file))) || path.basename(file, '.md')
  const top = h1 ? h1.children : root.children
  const intro = h1 ? lines.slice(h1.start, h1.children[0]?.line ?? h1.end) : lines.slice(root.start, root.end)
  const all = []
  const walk = (n) => { for (const c of n.children) { all.push(c); walk(c) } }
  walk(h1 || root)
  for (const n of all) {
    const own = lines.slice(n.start, n.children[0]?.line ?? n.end)
    n.body = own
    const st = own.map((l) => l.match(STATUS_LINE)).find(Boolean)
    n.status = st ? plain(st[1]) : null
  }
  // A tracker table (a header cell "Status") gives the status of steps that have no Status line.
  const tracker = {}
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i]) || !isTableSep(lines[i + 1])) continue
    const head = cells(lines[i]).map((c) => plain(c).toLowerCase())
    const sc = head.findIndex((c) => c === 'status')
    const ic = Math.max(0, head.findIndex((c) => /^(id|step|#)$/.test(c)))
    let j = i + 2
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const r = cells(lines[j])
      if (sc >= 0 && r[ic] && r[sc]) tracker[plain(r[ic]).toLowerCase()] = plain(r[sc])
    }
    i = j - 1
  }
  for (const n of all) if (!n.status && (n.kind === 'step' || n.kind === 'phase') && tracker[n.ref.toLowerCase()]) n.status = tracker[n.ref.toLowerCase()]
  const questions = []
  for (const q of all.filter((n) => n.kind === 'questions')) questions.push(...readQuestions(q, lines))
  return { file, title, lines, eol: /\r\n/.test(text) ? '\r\n' : '\n', intro, top, all, questions, feedback: all.find((n) => n.kind === 'feedback') || null }
}

const OPTION = /^\s*(?:\*\*)?([A-H])(?:\*\*)?[.)](?:\*\*)?\s+(.*)$/
const ANSWER = /^\s*(?:\*\*|__)?Answer\b/i
const QID = /^\s*(?:\*\*|__)?Q(\d+)\b[.:)]?(?:\*\*|__)?[.:)]?\s*/i

function optionsOf(texts) {
  const options = []
  for (const t of texts) {
    const m = t.match(OPTION)
    if (!m) continue
    const rec = /\((?:recommended|default)\)/i.test(m[2])
    options.push({ letter: m[1].toUpperCase(), text: m[2].replace(/\s*\((?:recommended|default)\)\s*/i, ' ').trim(), rec })
  }
  return options
}

function finishQuestion(q) {
  const DEF = /\b[Dd]efault\b\s*:?\s*(?:\*\*)?([A-H])\b/
  const d = q.text.match(DEF) || q.extra.join(' ').match(DEF)
  if (d && !q.options.some((o) => o.rec)) { const o = q.options.find((x) => x.letter === d[1]); if (o) o.rec = true }
  q.hasDefault = q.options.some((o) => o.rec) || /\bdefault\b/i.test(q.text + ' ' + q.extra.join(' '))
  return q
}

// Questions are list items (`- **Q1.** Where? Default: A.` with options `A. ...` below it) or
// headings (`### Q1. Where?`) under "Open questions". Items without an id are numbered in order.
function readQuestions(node, lines) {
  const out = []
  let n = 0
  const body = lines.slice(node.start, node.children[0]?.line ?? node.end)
  const base = Math.min(...body.filter((l) => LIST.test(l)).map(indentOf), Infinity)
  for (let i = 0; i < body.length; i++) {
    const m = body[i].match(LIST)
    if (!m || indentOf(body[i]) !== base) continue
    let j = i + 1
    while (j < body.length && (indentOf(body[j]) > base || (!body[j].trim() && body.slice(j + 1).find((y) => y.trim()) && indentOf(body.slice(j + 1).find((y) => y.trim())) > base))) j++
    let end = j
    while (end > i + 1 && !body[end - 1].trim()) end--
    const sub = body.slice(i + 1, end).map((l) => l.replace(LIST, '$3').trim()).filter(Boolean)
    const id = m[3].match(QID)
    n = id ? Number(id[1]) : n + 1
    out.push(finishQuestion({
      ref: `Q${n}`, numbered: !!id, text: m[3].replace(QID, '').trim(), kind: 'item',
      options: optionsOf(sub), answers: sub.filter((t) => ANSWER.test(t)), extra: sub.filter((t) => !OPTION.test(t) && !ANSWER.test(t)),
      indent: indentOf(body[i]), insertAt: node.start + end,
    }))
    i = j - 1
  }
  for (const h of node.children) {
    const id = plain(h.text).match(/^Q(\d+)\b[.:)]?\s*/i)
    n = id ? Number(id[1]) : n + 1
    const hb = lines.slice(h.start, h.end)
    const texts = hb.map((l) => l.replace(LIST, '$3').trim()).filter(Boolean)
    let end = h.end
    while (end > h.start && !lines[end - 1].trim()) end--
    h.ref = `Q${n}`
    out.push(finishQuestion({
      ref: `Q${n}`, numbered: !!id, text: plain(h.text).replace(/^Q\d+\b[.:)]?\s*/i, ''), kind: 'heading',
      options: optionsOf(texts), answers: texts.filter((t) => ANSWER.test(t)), extra: texts.filter((t) => !OPTION.test(t) && !ANSWER.test(t)),
      insertAt: end,
    }))
  }
  return out
}

// Every ref the page and the answer lines use, in page order.
export function refsOf(plan) {
  const refs = ['PLAN']
  for (const n of plan.all) if (n.kind !== 'questions' && n.kind !== 'feedback' && n.kind !== 'qhead') refs.push(n.ref)
  for (const q of plan.questions) refs.push(q.ref)
  return refs
}

export function checkPlan(plan) {
  const w = []
  const seen = new Map()
  for (const r of refsOf(plan)) seen.set(r.toLowerCase(), (seen.get(r.toLowerCase()) || 0) + 1)
  for (const [r, c] of seen) if (c > 1) w.push(`"${r}" is used by ${c} headings; a comment on it would be ambiguous`)
  for (const n of plan.all) if (n.kind === 'step' && !n.status && !n.children.some((c) => c.kind === 'step')) w.push(`step ${n.ref} has no status mark (Status: todo)`)
  for (const q of plan.questions) {
    if (!q.numbered) w.push(`open question "${q.text.slice(0, 40)}" has no id: write it as **${q.ref}.**`)
    if (!q.hasDefault) w.push(`${q.ref} has no default (mark an option "(recommended)" or write "Default: ...")`)
  }
  return w
}

// ---------- the page ----------

const STATUS_LABEL = { done: 'done', shown: 'shown', waiting: 'waiting for you', blocked: 'blocked', running: 'running', todo: 'todo', other: '' }

function statusChip(text) {
  if (!text) return ''
  const c = statusClass(text)
  return `<span class="st ps-${c}" title="${esc(text)}">${esc(c === 'other' ? text.slice(0, 30) : text.length > 34 ? STATUS_LABEL[c] : text)}</span>`
}

const anchor = (ref) => 'r-' + String(ref).replace(/[^A-Za-z0-9.-]+/g, '_')

function commentBox(ref, done) {
  return `<details class="cm" data-ref="${esc(ref)}" data-kind="c"><summary>Comment on ${esc(ref)}${done ? ' <span class="sub">(done: a change becomes a new step)</span>' : ''}</summary>
<textarea data-note="${esc(ref)}" rows="2" placeholder="Your comment on ${esc(ref)}"></textarea></details>`
}

function questionRow(q) {
  const opts = q.options.map((o) => `<button class="choice" type="button" data-pick="${esc(q.ref)}" data-v="${o.letter}"><b>${o.letter}</b> ${inline(o.text)}${o.rec ? '<span class="rec">recommended</span>' : ''}</button>`).join('')
  return `<div class="qrow" id="${anchor(q.ref)}" data-ref="${esc(q.ref)}" data-kind="q"><div class="qt"><span class="ref">${esc(q.ref)}</span> ${inline(q.text)}</div>
${q.extra.length ? `<div class="why">${q.extra.map(inline).join('<br>')}</div>` : ''}
${q.answers.map((a) => `<div class="answered">${inline(a)}</div>`).join('')}
<div class="ans">${opts}<textarea data-note="${esc(q.ref)}" rows="1" placeholder="${q.options.length ? 'A note, or your own answer' : 'Your answer'}"></textarea></div></div>`
}

function feedbackList(node) {
  const items = node.body.filter((l) => LIST.test(l) && indentOf(l) === 0).map((l) => l.replace(LIST, '$3'))
  if (!items.length) return blocks(node.body)
  return `<ul class="fb">${items.map((t) => {
    const open = /—\s*open\s*$/i.test(t)
    return `<li class="${open ? 'open' : 'closed'}">${inline(t.replace(/\s*—\s*open\s*$/i, ''))} ${open ? '<span class="st ps-waiting">open</span>' : ''}</li>`
  }).join('')}</ul>`
}

// A part of the page that opens and closes. Its open state is kept per page in the browser.
function fold(open, summary, inner, cls, after = '') {
  return `<details class="fold"${open ? ' open' : ''}><summary>${summary}</summary><div class="${cls}">${inner}</div>${after}</details>`
}

function nodeHtml(n, plan, depth, many) {
  if (n.kind === 'feedback') {
    const open = n.body.some((l) => /—\s*open\s*$/i.test(l))
    return `<section class="card sec" id="r-feedback">${fold(open, `<h2>${inline(n.text)}</h2>`, `<p class="sub">What you wrote on this page, recorded by <code>/ag:plan</code>. An open line is still to be acted on.</p>${feedbackList(n)}`, 'in')}</section>`
  }
  if (n.kind === 'questions') {
    const qs = plan.questions
    return `<section class="card sec" id="r-questions">${fold(true, `<h2>${inline(n.text)}</h2>`, `<p class="sub">Pick an option or write your own answer. The recommended option is what the plan does if you say nothing.</p>${qs.length ? '' : blocks(n.body)}`, 'in', qs.map(questionRow).join(''))}</section>`
  }
  const done = /^(done|shown)$/.test(statusClass(n.status || ''))
  const open = !done && !(many && n.kind === 'step')
  const head = `<span class="hd">${n.kind === 'section' ? '' : `<span class="ref">${esc(n.ref)}</span>`}${inline(n.kind === 'section' ? n.text : n.title)}</span>${statusChip(n.status)}`
  const body = blocks(n.body.filter((l) => !STATUS_LINE.test(l)))
  const kids = n.children.map((c) => nodeHtml(c, plan, depth + 1, many)).join('\n')
  const cls = n.status ? ` ps-${statusClass(n.status)}` : ''
  const words = esc(plain(n.text + ' ' + n.body.join(' ')).toLowerCase().slice(0, 4000))
  if (depth === 0) return `<section class="card sec ${n.kind}${cls}" id="${anchor(n.ref)}" data-text="${words}">${fold(open, `<h2>${head}</h2>`, `${body}${kids}${commentBox(n.ref, done)}`, 'in')}</section>`
  const h = depth === 1 ? 'h3' : 'h4'
  return `<div class="node ${n.kind}${cls}" id="${anchor(n.ref)}" data-text="${words}">${fold(open, `<${h} class="nh">${head}</${h}>`, `${body}${kids}${commentBox(n.ref, done)}`, 'nb')}</div>`
}

// The contents list: the top parts and one level below them, then the questions and Feedback.
function tocHtml(plan) {
  const item = (n) => `<a href="#${anchor(n.ref)}"><i class="dot${n.status ? ` ps-${statusClass(n.status)}` : ''}"></i>${n.kind === 'section' ? '' : `<span class="ref">${esc(n.ref)}</span>`}<span class="tt">${esc(plain(n.kind === 'section' ? n.text : n.title))}</span></a>`
  const li = plan.top.filter((n) => n.kind !== 'questions' && n.kind !== 'feedback').map((n) => `<li>${item(n)}${n.children.length ? `<ol>${n.children.map((k) => `<li>${item(k)}</li>`).join('')}</ol>` : ''}</li>`)
  const q = plan.top.find((n) => n.kind === 'questions')
  if (q) li.push(`<li><a href="#r-questions"><i class="dot ps-waiting"></i><span class="tt">${esc(plain(q.text))}${plan.questions.length ? ` (${plan.questions.length})` : ''}</span></a></li>`)
  if (plan.feedback) li.push('<li><a href="#r-feedback"><i class="dot"></i><span class="tt">Feedback</span></a></li>')
  return `<aside class="toc"><details class="toc-d"><summary>Contents</summary><nav aria-label="Contents"><ol>${li.join('')}</ol></nav></details></aside>`
}

export function renderPlan(plan, { rel = plan.file, generated = today() } = {}) {
  diagrams = 0
  const steps = plan.all.filter((n) => n.kind === 'step')
  const many = steps.length > 15
  const counts = {}
  for (const s of steps) { const c = statusClass(s.status || 'todo'); counts[c] = (counts[c] || 0) + 1 }
  const phases = plan.all.filter((n) => n.kind === 'phase')
  const nav = (phases.length ? phases : plan.top.filter((n) => n.kind !== 'feedback')).map((n) => `<a class="pill" href="#${anchor(n.ref)}">${esc(n.kind === 'phase' ? n.ref : n.ref.length > 18 ? n.ref.slice(0, 16) + '…' : n.ref)}</a>`)
  if (plan.questions.length) nav.push(`<a class="pill" href="#r-questions">Questions (${plan.questions.length})</a>`)
  if (plan.feedback) nav.push('<a class="pill" href="#r-feedback">Feedback</a>')
  const chips = [`<span class="chip"><b>${steps.length}</b> steps</span>`, ...['done', 'running', 'todo', 'waiting', 'blocked'].filter((c) => counts[c]).map((c) => `<span class="chip"><b>${counts[c]}</b> ${STATUS_LABEL[c]}</span>`)]
  if (phases.length) chips.push(`<span class="chip"><b>${phases.length}</b> phases</span>`)
  if (plan.questions.length) chips.push(`<span class="chip"><b>${plan.questions.length}</b> open questions</span>`)
  const verdict = `<section class="card verdict" data-ref="PLAN" data-kind="call"><div class="in"><h2>Your call on this plan</h2><p class="sub">Say whether the plan is right as it stands. Comments on single steps go in their own boxes below.</p></div>
<div class="ans"><span class="lbl">The plan:</span><button class="choice" type="button" data-pick="PLAN" data-v="ok">Looks good</button><button class="choice" type="button" data-pick="PLAN" data-v="changes">Needs changes</button>
<textarea data-note="PLAN" rows="2" placeholder="What to change, or a note on the whole plan"></textarea></div></section>`
  const body = `
<div class="bar"><div class="wrap"><span class="t">Plan</span><div class="pills" role="navigation" aria-label="Go to">${nav.join('')}</div>
<span class="folds"><button class="pill" id="openall" type="button">Open all</button><button class="pill" id="closeall" type="button">Close all</button></span>
<input class="search" id="q" type="search" placeholder="Find in the plan" aria-label="Find in the plan"></div></div>
<main class="wrap">
<div class="head"><div class="kicker">Plan · <code>${esc(rel)}</code></div><h1>${inline(plan.title)}</h1>
<div class="chips">${chips.join('')}</div>
${plan.intro.some((l) => l.trim()) ? `<div class="intro">${blocks(plan.intro)}</div>` : ''}
<p class="howto">Read the plan; answer the open questions; write a comment on any phase, step or section with its <b>Comment</b> box; give your call on the whole plan. Then press <b>Copy answer</b> and paste the lines into the chat. They are recorded in the plan and <code>/ag:plan</code> changes it to match. Steps marked done stay as they are: a change to them becomes a new step. Each part opens and closes with a click on its heading.</p></div>
<div class="pg">${tocHtml(plan)}<div class="col">
${verdict}
${plan.top.map((n) => nodeHtml(n, plan, 0, many)).join('\n')}
<footer class="end">Made ${esc(generated)} from ${esc(path.basename(plan.file))} · ag plan page · the plan file is the source; this page is made from it</footer>
</div></div>
</main>`
  const script = `const KEY=${JSON.stringify('ag-plan:' + rel)};const PLANFILE=${JSON.stringify(rel)};
${ANSWER_JS}
function compose(){const out=[];
  for(const e of $$('[data-ref]')){const r=e.dataset.ref;const s=S[r]||{};const t=one(s.t);
    if(e.dataset.kind==='c'){if(t)out.push(r+': '+t)}
    else if(s.v||t)out.push(r+(s.v?' '+s.v:'')+(t?': '+t:''))}
  return out.length?['Plan: '+PLANFILE,...out].join('\\n'):''}
const FK=KEY+':open';let FO={};try{FO=JSON.parse(localStorage.getItem(FK)||'{}')}catch(e){}
const saveFolds=()=>{try{localStorage.setItem(FK,JSON.stringify(FO))}catch(e){}};
const folds=$$('details.fold');
for(const d of folds){const id=d.parentElement.id;if(id&&id in FO)d.open=FO[id];
  d.addEventListener('toggle',()=>{const k=d.parentElement.id;if(k){FO[k]=d.open;saveFolds()}})}
function setAll(v){for(const d of folds){d.open=v;if(d.parentElement.id)FO[d.parentElement.id]=v}saveFolds()}
$('#openall').addEventListener('click',()=>setAll(true));$('#closeall').addEventListener('click',()=>setAll(false));
function openTo(el){for(let p=el.parentElement;p;p=p.parentElement){if(p.matches('details.fold'))p.open=true}const own=el.querySelector(':scope > details.fold');if(own)own.open=true}
for(const d of $$('details.cm')){const k=d.dataset.ref;if(((S[k]||{}).t||'').trim()){d.open=true;openTo(d)}}
function find(){const q=$('#q').value.trim().toLowerCase();
  for(const c of $$('section.card[data-text],div.node[data-text]')){const self=!!q&&c.dataset.text.includes(q);const hit=!q||self||!!c.querySelector('[data-text*="'+CSS.escape(q)+'"]');
    c.classList.toggle('dim',!hit);if(self&&q.length>2)openTo(c)}}
$('#q').addEventListener('input',find);
function focusHash(first){const id=decodeURIComponent(location.hash.slice(1));if(!id)return;const c=document.getElementById(id);if(!c)return;
  for(const x of $$('.focus'))x.classList.remove('focus');c.classList.add('focus');openTo(c);
  if(first){const d=c.querySelector(':scope > details.fold > div > details.cm');if(d)d.open=true}
  setTimeout(()=>c.scrollIntoView({block:'start'}),30)}
window.addEventListener('hashchange',()=>focusHash(false));
const wide=matchMedia('(min-width:1100px)');const td=$('.toc-d');const tocOpen=()=>{if(wide.matches)td.open=true};tocOpen();wide.addEventListener('change',tocOpen);
const links=new Map($$('.toc a').map((a)=>[a.getAttribute('href').slice(1),a]));
for(const a of links.values())a.addEventListener('click',()=>{if(!wide.matches)td.open=false});
if('IntersectionObserver' in window){const io=new IntersectionObserver((es)=>{for(const e of es){if(!e.isIntersecting)continue;const a=links.get(e.target.id);if(!a)continue;for(const x of links.values())x.classList.remove('on');a.classList.add('on')}},{rootMargin:'-80px 0px -70% 0px'});
  for(const id of links.keys()){const el=document.getElementById(id);if(el)io.observe(el)}}
paint();focusHash(true);`
  return page({ title: `Plan · ${plain(plan.title)}`, body: body + PLAN_CSS, script, generator: 'ag plan page 2' })
}

const PLAN_CSS = `<style>
.intro{max-width:90ch}.intro p{margin:0 0 10px}
.card .in>p,.nb>p{max-width:90ch}
.card h2 .hd,.nh .hd{flex:1}
.ref{display:inline-block;font-family:var(--mono);font-size:.78em;font-weight:700;color:var(--acc);background:var(--acc-bg);border-radius:6px;padding:1px 7px;margin-right:8px;vertical-align:2px}
.node{border:1px solid var(--line);border-left:4px solid var(--line2);border-radius:12px;padding:10px 16px;margin:14px 0;background:var(--card);scroll-margin-top:80px}
.node .node{margin:10px 0 4px;background:var(--bg)}
.card .nh{display:flex;align-items:center;gap:10px;font-size:17px;margin:0;text-transform:none;letter-spacing:0;color:var(--ink);flex:1}
.card h4.nh{font-size:15.5px}
.choice code{background:none;border:0;color:inherit;padding:0}
details.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::before{content:"";flex:0 0 auto;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(-45deg);transition:transform .15s;margin:0 4px 0 2px}
details.fold[open]>summary::before{transform:rotate(45deg) translate(-2px,-2px)}
details.fold>summary:hover::before{border-color:var(--acc)}
.card>.fold>summary{padding:18px 24px}
.card>.fold[open]>summary{padding-bottom:8px}
.card>.fold>summary h2{margin:0;flex:1}
.card>.fold>.in{padding:0 24px 20px}
.node>.fold>summary{padding:2px 0}
.node>.fold>.nb{padding-top:6px}
.folds{display:inline-flex;gap:6px}
.ps-done,.ps-shown{border-left-color:var(--ok)}.ps-running{border-left-color:var(--pick)}.ps-waiting{border-left-color:var(--chg)}.ps-blocked{border-left-color:var(--bad)}
.st.ps-done,.st.ps-shown{color:var(--ok);border-color:var(--ok);background:var(--ok-bg)}
.st.ps-running{color:var(--pick);border-color:var(--pick);background:var(--pick-bg)}
.st.ps-waiting{color:var(--chg);border-color:var(--chg);background:var(--chg-bg)}
.st.ps-blocked{color:var(--bad);border-color:var(--bad);background:var(--bad-bg)}
.st.ps-todo{color:var(--acc);border-color:var(--acc);background:var(--acc-bg)}
section.card{scroll-margin-top:80px}section.card.ps-done{border-left:4px solid var(--ok)}
.focus{border-color:var(--acc)!important;box-shadow:0 0 0 4px var(--acc-bg),var(--shadow)}
.dim{opacity:.35}
.card ul,.card ol{padding-left:22px;margin:6px 0 10px}.card li{margin:3px 0}
li.cb{list-style:none;margin-left:-20px}.box{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1.5px solid var(--line2);border-radius:4px;margin-right:8px;font-size:11px;vertical-align:-2px}.box.on{background:var(--ok);border-color:var(--ok);color:#fff}
pre.code{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px;overflow-x:auto;font-family:var(--mono);font-size:13px;line-height:1.45}
pre.code code{border:0;background:none;padding:0}
blockquote{margin:8px 0;padding:4px 14px;border-left:3px solid var(--line2);color:var(--muted)}
h4{font-size:15px;margin:14px 0 6px}
details.cm{margin-top:10px}details.cm summary{cursor:pointer;font-size:13.5px;font-weight:600;color:var(--muted);list-style:none;display:inline-block;padding:3px 10px;border:1px dashed var(--line2);border-radius:999px}
details.cm summary::-webkit-details-marker{display:none}details.cm[open] summary{color:var(--acc);border-color:var(--acc)}
details.cm textarea{display:block;width:100%;margin-top:8px;min-height:44px;resize:vertical;border:1.5px solid var(--line2);border-radius:10px;padding:9px 12px;font-size:15px;background:var(--card)}
.qrow .qt .ref{font-size:.85em}
.verdict{border-color:var(--pick)}
ul.fb{list-style:none;padding:0}ul.fb li{padding:8px 0;border-top:1px solid var(--line)}ul.fb li.closed{color:var(--muted)}
figure{margin:12px 0}
figure.img img{display:block;max-width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
figure.img figcaption{font-size:13px;color:var(--muted);margin-top:6px}
.nb>p>a.imga img,.in>p>a.imga img,li a.imga img{max-width:100%;height:auto;border-radius:8px;vertical-align:middle}
.mm-fig{border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:12px}
.mm-scroll{overflow-x:auto}
svg.mm{display:block;margin:0 auto;height:auto;max-width:100%}
.mm-n{fill:var(--card);stroke:var(--acc);stroke-width:1.5}
.mm-t{fill:var(--ink);font-family:inherit;font-size:13px}
.mm-lt{font-size:12px;fill:var(--muted)}.mm-mt{font-size:12.5px}
.mm-e{fill:none;stroke:var(--muted);stroke-width:1.5}
.mm-dot{stroke-dasharray:5 4}.mm-thick{stroke-width:3}
.mm-ah{fill:var(--muted)}.mm-x{fill:none;stroke:var(--muted);stroke-width:2}
.mm-lb{fill:var(--card);stroke:var(--line)}
.mm-g0{fill:color-mix(in srgb,var(--acc) 14%,var(--card))}.mm-g1{fill:color-mix(in srgb,var(--ok) 16%,var(--card))}.mm-g2{fill:color-mix(in srgb,var(--pick) 16%,var(--card))}
.mm-g3{fill:color-mix(in srgb,var(--chg) 18%,var(--card))}.mm-g4{fill:color-mix(in srgb,var(--bad) 14%,var(--card))}.mm-g5{fill:var(--soft)}
.mm-life{stroke:var(--line2);stroke-dasharray:4 4}
.mm-note{fill:var(--chg-bg);stroke:var(--chg);stroke-width:1}
.mm-fr{fill:none;stroke:var(--line2);stroke-width:1.2}.mm-rect{fill:var(--soft);fill-opacity:.5}
.mm-tab{fill:var(--soft);stroke:var(--line2)}.mm-fl{font-size:11.5px;font-weight:700;fill:var(--muted)}
details.mm-src{margin-top:8px}details.mm-src summary{cursor:pointer;font-size:12.5px;color:var(--muted)}
.mm-none{font-size:13.5px;color:var(--muted);margin:0 0 8px}
.toc-d{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);margin:0 0 18px}
.toc-d>summary{cursor:pointer;padding:12px 16px;font-weight:700;font-size:14px}
.toc nav{padding:0 10px 12px}
.toc ol{list-style:none;margin:0;padding:0}.toc ol ol{padding-left:16px}
.toc a{display:flex;align-items:baseline;gap:6px;padding:4px 6px;border-radius:8px;color:var(--ink);text-decoration:none;font-size:13.5px;line-height:1.35}
.toc ol ol a{font-size:13px;color:var(--muted)}
.toc a:hover{background:var(--soft)}.toc a.on{background:var(--acc-bg);color:var(--acc)}
.toc a .ref{font-size:11px;margin-right:0;padding:0 5px}
.toc .tt{flex:1;min-width:0}
.dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:var(--line2);align-self:center}
.dot.ps-done,.dot.ps-shown{background:var(--ok)}.dot.ps-running{background:var(--pick)}.dot.ps-waiting{background:var(--chg)}.dot.ps-blocked{background:var(--bad)}.dot.ps-todo{background:var(--acc)}
@media (min-width:1100px){
  .bar .wrap,main.wrap{max-width:1480px}
  .pg{display:grid;grid-template-columns:260px minmax(0,1fr);gap:28px;align-items:start}
  .toc{position:sticky;top:76px;max-height:calc(100vh - 92px);overflow:auto}
  .toc-d{margin:0}.toc-d>summary{pointer-events:none;list-style:none}.toc-d>summary::-webkit-details-marker{display:none}
}
@media (max-width:760px){.node{padding:8px 12px}.nh{flex-wrap:wrap}.card>.fold>summary{padding:14px 16px}.card>.fold>.in{padding:0 16px 16px}.folds{order:3}}
</style>`

// ---------- answer lines ----------

export function parseAnswers(text, plan) {
  const refs = refsOf(plan).filter((r) => r !== 'PLAN' && !/^Q\d+$/.test(r)).sort((a, b) => b.length - a.length)
  const out = { plan: null, items: [], unknown: [] }
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*]\s+/, '')
    if (!line) continue
    let m
    if ((m = line.match(/^plan\s*:\s*(\S.*\.md)\s*$/i))) { out.plan = m[1]; continue }
    if ((m = line.match(/^PLAN\s+(ok|changes)\b\s*(?::\s*(.*))?$/i))) { out.items.push({ kind: 'call', ref: 'PLAN', call: m[1].toLowerCase(), text: (m[2] || '').trim() }); continue }
    if ((m = line.match(/^PLAN\s*:\s*(.+)$/i))) { out.items.push({ kind: 'comment', ref: 'PLAN', text: m[1].trim() }); continue }
    if ((m = line.match(/^Q(\d+)(?:\s+([A-H]))?\b\s*(?::\s*(.*))?$/i)) && (m[2] || m[3])) {
      out.items.push({ kind: 'answer', ref: `Q${Number(m[1])}`, option: m[2] ? m[2].toUpperCase() : null, text: (m[3] || '').trim() })
      continue
    }
    const ref = refs.find((r) => line.toLowerCase().startsWith(r.toLowerCase()) && /^\s*:/.test(line.slice(r.length)))
    if (ref) { out.items.push({ kind: 'comment', ref, text: line.slice(ref.length).replace(/^\s*:\s*/, '').trim() }); continue }
    out.unknown.push(raw.trim())
  }
  return out
}

// Writes the answers into the plan's text: question answers under their question, the rest as
// dated lines in "## Feedback" (made at the end of the plan when it has none). Returns the new text.
export function applyAnswers(plan, answers, date = today()) {
  const lines = [...plan.lines]
  const inserts = []
  const recorded = []
  const notes = []
  let seq = 0
  for (const a of answers.items) {
    if (a.kind === 'answer') {
      const q = plan.questions.find((x) => x.ref === a.ref)
      if (!q) { notes.push(`${a.ref}: the plan has no such question; not recorded`); continue }
      const opt = a.option ? q.options.find((o) => o.letter === a.option) : null
      if (a.option && !opt) notes.push(`${a.ref}: option ${a.option} is not one of ${q.options.map((o) => o.letter).join(', ') || 'its options'}; recorded as written`)
      const what = [a.option ? `${a.option}${opt ? ` (${plain(opt.text).replace(/\s*\(.*$/, '').slice(0, 60)})` : ''}` : '', a.text].filter(Boolean).join('; ')
      const text = q.kind === 'item' ? `${' '.repeat(q.indent + 2)}- **Answer ${date}:** ${what}` : `**Answer ${date}:** ${what}`
      inserts.push({ at: q.insertAt, text, seq: seq++, blank: q.kind === 'heading' })
      recorded.push(`${a.ref} answered: ${what}`)
      continue
    }
    const t = a.kind === 'call' ? `PLAN ${a.call}${a.text ? `: ${a.text}` : ''}` : `${a.ref}: ${a.text}`
    const open = !(a.kind === 'call' && a.call === 'ok' && !a.text)
    inserts.push({ at: 'feedback', text: `- ${date} · ${t}${open ? ' — open' : ''}`, seq: seq++ })
    recorded.push(`feedback: ${t}`)
  }
  const fb = inserts.filter((x) => x.at === 'feedback')
  const qs = inserts.filter((x) => x.at !== 'feedback').sort((a, b) => b.at - a.at || b.seq - a.seq)
  let fbAt = null
  if (fb.length && plan.feedback) {
    let end = plan.feedback.end
    while (end > plan.feedback.start && !lines[end - 1].trim()) end--
    fbAt = end
  }
  // Insert from the bottom up so earlier line numbers stay right; the feedback block counts as one insert.
  const all = [...qs]
  if (fbAt != null) all.push({ at: fbAt, block: fb.map((x) => x.text), seq: -1 })
  all.sort((a, b) => b.at - a.at || b.seq - a.seq)
  for (const x of all) {
    if (x.block) {
      const prevIsList = fbAt > 0 && LIST.test(lines[fbAt - 1] || '')
      lines.splice(x.at, 0, ...(prevIsList ? [] : ['']), ...x.block)
    } else lines.splice(x.at, 0, ...(x.blank ? ['', x.text] : [x.text]))
  }
  if (fb.length && fbAt == null) {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push('', '## Feedback', '', ...fb.map((x) => x.text))
  }
  let text = lines.join(plan.eol)
  if (!text.endsWith(plan.eol)) text += plan.eol
  return { text, recorded, notes }
}

// ---------- where plans go ----------

export function projectRoot(cwd = process.cwd(), home = os.homedir()) {
  let root = cwd
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd } catch { /* not a git repository */ }
  root = path.resolve(root)
  if (root.toLowerCase() === path.resolve(home).toLowerCase()) throw new InputError(`plans belong to a project: run this from the project's folder, not ${root}, or give --root`)
  return root
}

// A new plan's path: <plans folder>/<yyyymmdd>-<slug>/plan.md, in the folder the project already
// keeps plans in (plans/, .planning/, docs/plans/), else plans/. A taken folder gets -2, -3.
export function newPlanPath(root, words, date = today()) {
  const base = ['plans', '.planning', path.join('docs', 'plans')].find((d) => fs.existsSync(path.join(root, d))) || 'plans'
  const slug = slugify(words).split('-').slice(0, 5).join('-') || 'plan'
  const stem = `${date.replace(/-/g, '')}-${slug}`
  let dir = path.join(root, base, stem)
  for (let n = 2; fs.existsSync(dir); n++) dir = path.join(root, base, `${stem}-${n}`)
  return path.join(dir, 'plan.md')
}

export const pageOf = (file) => (path.basename(file).toLowerCase() === 'plan.md' ? path.join(path.dirname(file), 'plan.html') : file.replace(/\.md$/i, '') + '.html')

// ---------- command line ----------

function args(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (['strict', 'no-open', 'help'].includes(k)) o[k] = true
      else o[k] = argv[++i]
    } else o._.push(a)
  }
  return o
}

const readText = (f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8')).replace(/^﻿/, '')

function loadPlan(file) {
  if (!file) throw new InputError('give the plan file (plan.md)')
  const f = path.resolve(file)
  if (!fs.existsSync(f)) throw new InputError(`${file} does not exist`)
  return parsePlan(readText(f), f)
}

function relTo(file) {
  try { return path.relative(projectRoot(path.dirname(file)), file).split(path.sep).join('/') } catch { return path.basename(file) }
}

export function render(file, { strict = false, log = console.log } = {}) {
  const plan = loadPlan(file)
  const warnings = checkPlan(plan)
  const out = pageOf(plan.file)
  fs.writeFileSync(out, renderPlan(plan, { rel: relTo(plan.file) }))
  for (const w of warnings) log(`warning: ${w}`)
  log(`${plan.all.filter((n) => n.kind === 'step').length} steps, ${plan.questions.length} questions, ${warnings.length} warnings -> ${out}`)
  return { warnings, ok: !(strict && warnings.length), out }
}

export function openTarget(file, ref) {
  const html = path.resolve(pageOf(path.resolve(file)))
  if (!fs.existsSync(html)) throw new InputError(`${html} does not exist; run render first`)
  if (!ref) return html
  const plan = loadPlan(file)
  const known = refsOf(plan).find((r) => r.toLowerCase() === String(ref).toLowerCase())
  if (!known) throw new InputError(`${ref} is not a step, phase, section or question of this plan (see: refs)`)
  const url = pathToFileURL(html).href + '#' + anchor(known)
  const tmp = path.join(os.tmpdir(), 'ag-plan')
  fs.mkdirSync(tmp, { recursive: true })
  const redirect = path.join(tmp, `open-${anchor(known)}.html`)
  fs.writeFileSync(redirect, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc(url)}"><title>${esc(known)}</title><script>location.replace(${JSON.stringify(url)})</script><a href="${esc(url)}">Open ${esc(known)}</a>\n`)
  return redirect
}

const HELP = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(1, 26).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')

export function main(argv = process.argv.slice(2), log = console.log) {
  const o = args(argv)
  const cmd = o._[0]
  if (!cmd || o.help) { log(HELP); return cmd ? 0 : 2 }
  try {
    if (cmd === 'folder') {
      const words = o._.slice(1).join(' ')
      if (!words.trim()) throw new InputError('give 2 to 5 words for the plan folder: folder <words>')
      const root = o.root ? path.resolve(o.root) : projectRoot()
      log(path.relative(root, newPlanPath(root, words)).split(path.sep).join('/'))
      return 0
    }
    if (cmd === 'render') return render(o._[1], { strict: o.strict, log }).ok ? 0 : 1
    if (cmd === 'refs') { log(refsOf(loadPlan(o._[1])).join('\n')); return 0 }
    if (cmd === 'open') {
      const file = openTarget(o._[1], o.id)
      if (!o['no-open']) launch(file)
      log(file)
      return 0
    }
    if (cmd === 'record') {
      if (!o.from) throw new InputError('give the answer lines: record [<plan.md>] --from <file>')
      const text = readText(o.from)
      let file = o._[1]
      if (!file) {
        const m = text.match(/^\s*plan\s*:\s*(\S.*\.md)\s*$/im)
        if (!m) throw new InputError('the lines have no "Plan: <path>" line; give the plan file')
        file = path.isAbsolute(m[1]) ? m[1] : path.join(projectRoot(), m[1])
      }
      const plan = loadPlan(file)
      const answers = parseAnswers(text, plan)
      if (answers.plan && path.resolve(projectRoot(path.dirname(plan.file)), answers.plan).toLowerCase() !== plan.file.toLowerCase()) {
        throw new InputError(`these lines are for ${answers.plan}, not ${relTo(plan.file)}`)
      }
      const res = applyAnswers(plan, answers)
      if (res.recorded.length) fs.writeFileSync(plan.file, res.text)
      for (const r of res.recorded) log(`recorded: ${r}`)
      for (const n of res.notes) log(`note: ${n}`)
      for (const u of answers.unknown) log(`not understood: ${u}`)
      log(`${res.recorded.length} recorded, ${answers.unknown.length} not understood -> ${plan.file}`)
      return 0
    }
    throw new InputError(`unknown command "${cmd}" (folder, render, open, record, refs)`)
  } catch (e) {
    if (e instanceof InputError) { log(`error: ${e.message}`); return 2 }
    throw e
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
