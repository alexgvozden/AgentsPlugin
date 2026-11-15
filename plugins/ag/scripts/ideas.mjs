#!/usr/bin/env node
// ideas.mjs - the project's ideas list, for /ag:ideas, /ag:idea and /ag:idea-research.
//
// The list lives in the project's ideas/ folder:
//   ideas/ideas.json                    the source: every idea (id, title, description, SWOT, RAID,
//                                       questions, comments, research summary)
//   ideas/ideas.html                    rendered from it: every idea on one page, with an answer bar
//   ideas/<AGPL-IDEA-003-slug>/research.json the research of one idea (written by /ag:idea-research)
//   ideas/<AGPL-IDEA-003-slug>/research.html rendered from it: the idea's own research page
//   ideas/<AGPL-IDEA-003-slug>/data/         raw research data (DataForSEO answers, threads); gitignored
//
// Usage (run with --help for this text):
//   node ideas.mjs add     [--dir ideas] --from <draft.json> [--project <name>] [--code <ABCD>]   new idea, prints its id
//   node ideas.mjs render  [--dir ideas] [--strict]          check and write ideas.html and research pages
//   node ideas.mjs open    [--dir ideas] [--id <ref>] [--research] [--no-open]    open a page in the browser
//   node ideas.mjs record  [--dir ideas] --from <answers.txt> [--id <ref>]        record pasted answer lines
//   node ideas.mjs resolve [--dir ideas] <ref>               print id, folder and paths of one idea
//   node ideas.mjs list    [--dir ideas]                     one line per idea
//   node ideas.mjs status  [--dir ideas] <ref> <status>      set the status (new, discussed, researching, ...)
//   node ideas.mjs link    [--dir ideas] <ref>               copy research.json's verdict into the list; researched
//
// The ideas belong to the project, like its plans: without --dir the folder is ideas/ at the root
// of the git repository the command runs in (else the current folder), never the home folder.
// Each list has a project code of 4 or 5 capital letters ("code" in ideas.json), set by --code on
// the first add or made from the project's name (AgentsPlugin -> AGPL), and every id carries it:
// AGPL-IDEA-003, in the folder AGPL-IDEA-003-<slug>. Once the list has ideas the code stays.
// <ref> is AGPL-IDEA-003, IDEA-003, IDEA-3, idea-3 or 3; another project's code is refused. Exit 0 ok, 1 check warnings with --strict, 2 bad input.

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

export const STATUSES = ['new', 'discussed', 'researching', 'researched', 'planned', 'parked', 'dropped']
export const KINDS = ['extension', 'new']
export const CALLS = ['go', 'go-with-changes', 'park', 'drop']
export const LEVELS = ['low', 'medium', 'high']
export const SIZES = ['small', 'medium', 'large']
const CALL_LABEL = { go: 'Go', 'go-with-changes': 'Go with changes', park: 'Park', drop: 'Drop' }
const STATUS_LABEL = { new: 'New', discussed: 'Discussed', researching: 'Researching', researched: 'Researched', planned: 'Planned', parked: 'Parked', dropped: 'Dropped' }
const KIND_LABEL = { extension: 'Builds on this project', new: 'Something new' }

class InputError extends Error {}

// ---------- small helpers ----------

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x])
const asItem = (x) => (typeof x === 'string' ? { text: x } : x && typeof x === 'object' ? x : { text: String(x ?? '') })
export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const isHttp = (u) => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u)
const words = (t) => String(t ?? '').trim().split(/\s+/).filter(Boolean).length
const letter = (i) => String.fromCharCode(65 + i)

// Text fields allow only `code`, **bold** and [links](https://...). Everything else is escaped.
export function md(t) {
  let s = esc(t)
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
  return s
}

export function slugify(t) {
  const s = String(t ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (s.length <= 40) return s || 'idea'
  const cut = s.slice(0, 41)
  return cut.slice(0, cut.lastIndexOf('-') > 10 ? cut.lastIndexOf('-') : 40).replace(/-+$/, '') || 'idea'
}

export const CODE_RE = /^[A-Z]{4,5}$/
export const idOf = (n, code) => `${code ? code + '-' : ''}IDEA-${String(n).padStart(3, '0')}`
const numOf = (id) => Number(String(id).replace(/^(?:[A-Z]{4,5}-)?IDEA-/i, ''))

// The project code from its name, 4 capital letters: AgentsPlugin -> AGPL, Tamarind -> TAMA,
// my-shop-front-end -> MSFE. --code overrides it.
export function projectCode(name) {
  const words = String(name ?? '').normalize('NFKD').replace(/([a-z])([A-Z])/g, '$1 $2')
    .toUpperCase().split(/[^A-Z]+/).filter(Boolean)
  let code = words.length === 2 ? words[0].slice(0, 2) + words[1].slice(0, 2)
    : words.length === 3 ? words[0].slice(0, 2) + words[1][0] + words[2][0]
    : words.length > 3 ? words.slice(0, 4).map((w) => w[0]).join('')
    : (words[0] || '').slice(0, 4)
  if (code.length < 4) code = (code + words.join('').slice(code.length)).slice(0, 4)
  if (!CODE_RE.test(code)) throw new InputError(`cannot make a project code from "${name}": give --code with 4 or 5 letters`)
  return code
}

export function resolveId(data, ref) {
  const r = String(ref ?? '').trim()
  const m = r.match(/^([a-z]{4,5})-idea-?0*(\d+)$/i) || r.match(/^()(?:idea-?)?0*(\d+)$/i)
  if (!m) throw new InputError(`not an idea id: "${ref}" (use ${idOf(3, data.code)}, IDEA-3 or 3)`)
  if (m[1] && data.code && m[1].toUpperCase() !== data.code) throw new InputError(`${String(ref).trim()} is an idea of project ${m[1].toUpperCase()}; this list is ${data.code}`)
  const idea = data.ideas.find((i) => numOf(i.id) === Number(m[2]))
  if (!idea) throw new InputError(`no idea ${idOf(m[2], data.code)} in the list (${data.ideas.length} ideas)`)
  return idea
}

// ---------- the list on disk ----------

export function emptyList(project) {
  return { version: 1, project: project || 'Project', ideas: [] }
}

export function loadIdeas(dir, project) {
  const file = path.join(dir, 'ideas.json')
  if (!fs.existsSync(file)) return emptyList(project || path.basename(path.resolve(dir, '..')))
  let data
  try { data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (e) { throw new InputError(`${file} is not valid JSON: ${e.message}`) }
  if (!data || !Array.isArray(data.ideas)) throw new InputError(`${file} has no "ideas" list`)
  return data
}

export function saveIdeas(dir, data) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ideas.json'), JSON.stringify(data, null, 2) + '\n')
  const gi = path.join(dir, '.gitignore')
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# Raw research data (DataForSEO answers, fetched threads): bulky and re-fetchable.\n*/data/\n')
}

const researchFile = (dir, idea) => path.join(dir, idea.folder || `${idea.id}-${idea.slug}`, 'research.json')

export function loadResearch(dir, idea) {
  const file = researchFile(dir, idea)
  if (!fs.existsSync(file)) return null
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')) } catch (e) { throw new InputError(`${file} is not valid JSON: ${e.message}`) }
}

// ---------- add ----------

export function addIdea(data, draft, date = today()) {
  if (!draft || typeof draft !== 'object') throw new InputError('the draft is not a JSON object')
  for (const k of ['title', 'description']) if (!String(draft[k] ?? '').trim()) throw new InputError(`the draft has no "${k}"`)
  const n = data.ideas.reduce((m, i) => Math.max(m, numOf(i.id) || 0), 0) + 1
  if (!data.code) data.code = projectCode(data.project)
  const id = idOf(n, data.code)
  const slug = slugify(draft.title)
  const qs = list(draft.questions).map((q, i) => {
    const o = typeof q === 'string' ? { q } : { ...q }
    return { id: o.id || `Q${i + 1}`, ...o, answer: o.answer ?? null }
  })
  const idea = {
    id, slug, folder: `${id}-${slug}`,
    title: String(draft.title).trim(),
    description: String(draft.description).trim(),
    raw: draft.raw ?? null,
    kind: KINDS.includes(draft.kind) ? draft.kind : 'extension',
    status: 'new',
    created: date, updated: date,
    tags: list(draft.tags),
    target: draft.target ?? null,
    swot: draft.swot ?? { strengths: [], weaknesses: [], opportunities: [], threats: [] },
    raid: draft.raid ?? { risks: [], assumptions: [], issues: [], dependencies: [] },
    questions: qs,
    comments: list(draft.comments),
    research: null,
  }
  for (const [k, v] of Object.entries(draft)) if (!(k in idea) && k !== 'id') idea[k] = v
  data.ideas.push(idea)
  return idea
}

// ---------- record: the lines the pages' Copy answer gives ----------
//   AGPL-IDEA-003: a comment            -> comments[]
//   AGPL-IDEA-003 Q2 B: a note          -> questions[Q2].answer = {choice: "B", option, text, date}
//   AGPL-IDEA-003 Q2: free text         -> questions[Q2].answer = {text, date}
//   AGPL-IDEA-003 decision park: a note -> decision = {call, text, date}   (from the research page)
//   AGPL-IDEA-003 RQ1: free text        -> research answers[] (from the research page)
// A line may start with IDEA-003 or just "3" for AGPL-IDEA-003. With --id, lines may leave the id out ("Q2 B: note").

export function parseAnswers(text, defaultId) {
  const out = [], bad = []
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    let line = raw.trim().replace(/^[-*•]\s+/, '')
    if (!line) continue
    let id = defaultId
    const head = line.match(/^((?:[A-Z]{4,5}-)?IDEA-?\d+|\d+)\b\s*/i)
    if (head) { id = head[1]; line = line.slice(head[0].length) }
    if (!id) { bad.push(raw); continue }
    let m
    if ((m = line.match(/^decision\s+([a-z-]+)\s*(?::\s*(.*))?$/i)) && CALLS.includes(m[1].toLowerCase())) {
      out.push({ id, type: 'decision', call: m[1].toLowerCase(), text: (m[2] || '').trim() })
    } else if ((m = line.match(/^(RQ\d+)\s*:\s*(.+)$/i))) {
      out.push({ id, type: 'rq', q: m[1].toUpperCase(), text: m[2].trim() })
    } else if ((m = line.match(/^(Q\d+)(?:\s+([A-Z]))?\s*(?::\s*(.*))?$/))) {
      if (!m[2] && !m[3]) { bad.push(raw); continue }
      out.push({ id, type: 'q', q: m[1], choice: m[2] || null, text: (m[3] || '').trim() })
    } else if ((m = line.match(/^:\s*(.+)$/))) {
      out.push({ id, type: 'comment', text: m[1].trim() })
    } else if (!head && defaultId && line) {
      out.push({ id, type: 'comment', text: line })
    } else bad.push(raw)
  }
  return { answers: out, bad }
}

export function applyAnswers(data, answers, date = today()) {
  const done = []
  for (const a of answers) {
    const idea = resolveId(data, a.id)
    if (a.type === 'comment') {
      idea.comments = list(idea.comments).concat({ date, text: a.text })
      done.push(`${idea.id}: comment added`)
    } else if (a.type === 'q') {
      const q = list(idea.questions).find((x) => x.id === a.q)
      if (!q) throw new InputError(`${idea.id} has no question ${a.q}`)
      const ans = { date }
      if (a.choice) {
        const i = a.choice.charCodeAt(0) - 65
        const opts = list(q.options)
        if (i < 0 || i >= opts.length) throw new InputError(`${idea.id} ${a.q} has no option ${a.choice}`)
        ans.choice = a.choice; ans.option = typeof opts[i] === 'string' ? opts[i] : opts[i].text
      }
      if (a.text) ans.text = a.text
      q.answer = ans
      done.push(`${idea.id} ${a.q}: ${ans.choice ? ans.choice + ' (' + ans.option + ')' : 'answered'}`)
    } else if (a.type === 'decision') {
      idea.decision = { call: a.call, text: a.text || null, date }
      if (a.call === 'park') idea.status = 'parked'
      if (a.call === 'drop') idea.status = 'dropped'
      done.push(`${idea.id}: decision ${a.call}${a.call === 'park' || a.call === 'drop' ? `, status ${idea.status}` : ''}`)
    } else if (a.type === 'rq') {
      idea.researchAnswers = list(idea.researchAnswers).filter((x) => x.q !== a.q).concat({ q: a.q, text: a.text, date })
      done.push(`${idea.id} ${a.q}: answered`)
    }
    if (idea.status === 'new') idea.status = 'discussed'
    idea.updated = date
  }
  return done
}

export function setStatus(data, ref, status, date = today()) {
  if (!STATUSES.includes(status)) throw new InputError(`status must be one of ${STATUSES.join(', ')}`)
  const idea = resolveId(data, ref)
  idea.status = status
  idea.updated = date
  return idea
}

// Copies the research's verdict and first summary line into the list, and marks the idea researched.
export function linkResearch(data, idea, r, date = today()) {
  if (!r) throw new InputError(`${idea.id} has no research.json yet`)
  idea.research = {
    date: r.date || date,
    path: `${idea.folder}/research.html`,
    summary: list(r.summary)[0] ?? null,
    verdict: r.verdict?.call ?? null,
    confidence: r.verdict?.confidence ?? null,
  }
  if (['new', 'discussed', 'researching'].includes(idea.status)) idea.status = 'researched'
  idea.updated = date
  return idea
}

// ---------- checks ----------

export function checkIdeas(data) {
  const w = []
  if (data.version !== 1) w.push(`ideas.json: "version" should be 1`)
  if (!CODE_RE.test(data.code || '')) w.push(`ideas.json: "code" should be the project code, 4 or 5 capital letters (AGPL)`)
  const seen = new Set()
  for (const i of data.ideas) {
    const at = i.id || '(no id)'
    if (!data.code || !(i.id || '').startsWith(data.code + '-') || !/^[A-Z]{4,5}-IDEA-\d{3,}$/.test(i.id || '')) w.push(`${at}: id must look like ${idOf(3, data.code || 'ABCD')}`)
    if (seen.has(i.id)) w.push(`${at}: the id is used twice`)
    seen.add(i.id)
    if (!String(i.title ?? '').trim()) w.push(`${at}: no title`)
    if (!String(i.description ?? '').trim()) w.push(`${at}: no description`)
    if (!STATUSES.includes(i.status)) w.push(`${at}: status "${i.status}" is not one of ${STATUSES.join(', ')}`)
    if (!KINDS.includes(i.kind)) w.push(`${at}: kind "${i.kind}" is not one of ${KINDS.join(', ')}`)
    if (!i.folder) w.push(`${at}: no folder`)
    const qids = new Set()
    for (const q of list(i.questions)) {
      if (!q.id || qids.has(q.id)) w.push(`${at}: question ids must be set and unique (${q.id})`)
      qids.add(q.id)
      if (!String(q.q ?? '').trim()) w.push(`${at} ${q.id}: no question text`)
    }
    for (const r of list(i.raid?.risks)) {
      const r2 = asItem(r)
      for (const k of ['likelihood', 'impact']) if (r2[k] && !LEVELS.includes(r2[k])) w.push(`${at}: risk "${short(r2.text)}" ${k} must be low, medium or high`)
    }
  }
  return w
}

const short = (t) => { const s = String(t ?? ''); return s.length > 50 ? s.slice(0, 47) + '...' : s }
const HANDLE = /(^|[\s(])(?:\/?u\/[A-Za-z0-9_-]{3,}|@[A-Za-z0-9_]{3,})\b/

export function checkResearch(r, idea) {
  const w = []
  const at = `${idea.id} research`
  if (r.id !== idea.id) w.push(`${at}: "id" is ${r.id}, not ${idea.id}`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) w.push(`${at}: "date" must be yyyy-mm-dd`)
  if (!KINDS.includes(r.mode)) w.push(`${at}: "mode" must be extension or new`)
  if (!CALLS.includes(r.verdict?.call)) w.push(`${at}: verdict.call must be one of ${CALLS.join(', ')}`)
  if (!LEVELS.includes(r.verdict?.confidence)) w.push(`${at}: verdict.confidence must be low, medium or high`)
  if (!list(r.summary).length) w.push(`${at}: no summary lines`)
  if (!r.current) w.push(`${at}: no "current" (the state today)`)
  if (!r.target) w.push(`${at}: no "target" (the state to reach)`)
  if (!list(r.value?.points).length) w.push(`${at}: no "value" points (who gains what, and why)`)
  if (r.size && !SIZES.includes(r.size.call)) w.push(`${at}: size.call must be one of ${SIZES.join(', ')}`)
  // Research answers "should we do it"; how to build it is /ag:plan's job.
  if (r.path != null) w.push(`${at}: has "path": build steps belong to /ag:plan; put what is missing in "gap" and drop the steps`)
  for (const k of ['current', 'target', 'gap', 'value'])
    for (const x of list(r[k]?.points)) if (x && typeof x === 'object' && ('effort' in x || 'steps' in x)) w.push(`${at}: ${k} point "${short(x.text)}" has effort or steps; those belong to /ag:plan`)

  const ids = new Set()
  for (const s of list(r.sources)) {
    if (!s.id) { w.push(`${at}: a source has no id`); continue }
    if (ids.has(s.id)) w.push(`${at}: source id ${s.id} is used twice`)
    ids.add(s.id)
    if (s.url != null && !isHttp(s.url)) w.push(`${at}: source ${s.id} url is not http(s): ${short(s.url)}`)
    if (s.url == null && !s.path) w.push(`${at}: source ${s.id} has neither url nor path`)
    if (s.url && !s.date) w.push(`${at}: source ${s.id} has no date (when it was read)`)
  }
  const cite = (where, srcs, need) => {
    const l = list(srcs)
    if (need && !l.length) w.push(`${at}: ${where} has no source`)
    for (const s of l) if (!ids.has(s)) w.push(`${at}: ${where} cites unknown source ${s}`)
  }

  for (const f of list(r.facts)) cite(`fact "${short(f.text)}"`, f.sources, true)
  for (const k of ['strengths', 'weaknesses', 'opportunities', 'threats'])
    for (const x of list(r.swot?.[k]).map(asItem)) cite(`SWOT ${k} "${short(x.text)}"`, x.sources, !x.judgement)
  for (const k of ['risks', 'assumptions', 'issues', 'dependencies'])
    for (const x of list(r.raid?.[k]).map(asItem)) {
      cite(`RAID ${k} "${short(x.text)}"`, x.sources, false)
      if (k === 'risks') for (const l of ['likelihood', 'impact']) if (!LEVELS.includes(x[l])) w.push(`${at}: risk "${short(x.text)}" needs ${l} low, medium or high`)
    }
  for (const p of list(r.current?.points).concat(list(r.target?.points))) cite(`point "${short(p.text)}"`, p.sources, false)
  for (const k of list(r.demand?.keywords)) {
    if (k.volume != null && typeof k.volume !== 'number') w.push(`${at}: keyword "${k.phrase}" volume must be a number or null`)
    cite(`keyword "${k.phrase}"`, k.sources, k.volume != null)
    if (k.trend != null && !(Array.isArray(k.trend) && k.trend.every((n) => typeof n === 'number'))) w.push(`${at}: keyword "${k.phrase}" trend must be a list of numbers`)
  }
  for (const c of list(r.competitors)) {
    if (c.url && !isHttp(c.url)) w.push(`${at}: competitor ${c.name} url is not http(s)`)
    cite(`competitor ${c.name}`, c.sources, true)
    if (c.traffic && c.traffic.value != null) cite(`competitor ${c.name} traffic`, c.traffic.sources, true)
  }
  for (const v of list(r.voices)) {
    if (!isHttp(v.url)) w.push(`${at}: voice "${short(v.title)}" needs an http(s) url`)
    if (!v.date) w.push(`${at}: voice "${short(v.title)}" has no date`)
    if (v.quote && words(v.quote) > 20) w.push(`${at}: quote in "${short(v.title)}" has ${words(v.quote)} words (20 at most)`)
    for (const t of [v.quote, v.point, v.title]) if (t && HANDLE.test(t)) w.push(`${at}: voice "${short(v.title)}" names a user or handle`)
  }
  return w
}

// ---------- shared page parts ----------

const CSS = `
:root{--bg:#f4f5f7;--card:#fff;--ink:#111827;--muted:#6b7280;--soft:#9ca3af;--line:#e5e7eb;--line2:#d1d5db;
--acc:#2563eb;--acc-bg:#eff6ff;--ok:#047857;--ok-bg:#ecfdf5;--chg:#b45309;--chg-bg:#fffbeb;--bad:#b91c1c;--bad-bg:#fef2f2;--pick:#6d28d9;--pick-bg:#f5f3ff;
--shadow:0 1px 2px rgba(16,24,40,.06),0 1px 3px rgba(16,24,40,.08);--r:14px;--mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--card:#161b22;--ink:#e6edf3;--muted:#9da7b3;--soft:#6e7681;--line:#262c36;--line2:#363d48;
--acc:#58a6ff;--acc-bg:#132339;--ok:#3fb950;--ok-bg:#12261a;--chg:#d29922;--chg-bg:#2a2112;--bad:#f85149;--bad-bg:#2d1416;--pick:#a78bfa;--pick-bg:#221b3a;--shadow:0 1px 2px rgba(0,0,0,.4)}}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:80px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
button,input,textarea{font:inherit;color:inherit}a{color:var(--acc)}code{font-family:var(--mono);font-size:.9em;background:var(--bg);border:1px solid var(--line);border-radius:5px;padding:0 4px}
.wrap{max-width:1180px;margin:0 auto;padding:0 24px}
.bar{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;gap:14px;min-height:60px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.bar .t{font-weight:700;white-space:nowrap}
.pills{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;flex:1 1 300px;padding:2px 0}.pills::-webkit-scrollbar{display:none}
.pill{flex:none;padding:5px 11px;border-radius:999px;border:1px solid var(--line2);background:var(--card);font-size:13px;font-weight:600;color:var(--muted);text-decoration:none;cursor:pointer}
.pill[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--card)}
.search{flex:0 1 240px;min-width:140px;border:1.5px solid var(--line2);border-radius:10px;padding:7px 12px;background:var(--card);font-size:15px}
.head{padding:30px 0 6px}.kicker{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h1{font-size:clamp(26px,3.2vw,38px);line-height:1.15;letter-spacing:-.02em;margin:6px 0 12px}
.lead{font-size:18px;max-width:80ch;margin:0 0 14px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 6px}
.chip{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;background:var(--card);border:1px solid var(--line);font-size:13.5px;color:var(--muted);white-space:nowrap}
.chip b{color:var(--ink)}
.howto{font-size:14px;color:var(--muted);margin:12px 0 0;max-width:90ch}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--shadow);margin:20px 0;overflow:hidden}
.card>.in{padding:20px 24px}
.card h2{font-size:21px;line-height:1.3;margin:0 0 4px;letter-spacing:-.01em}
.card h3{font-size:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:18px 0 8px}
.sec h2{display:flex;align-items:center;gap:10px}
.st{font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid var(--line2);color:var(--muted);background:var(--bg);white-space:nowrap}
.st.new{color:var(--acc);border-color:var(--acc);background:var(--acc-bg)}
.st.discussed,.st.researching{color:var(--pick);border-color:var(--pick);background:var(--pick-bg)}
.st.researched,.st.planned,.st.go{color:var(--ok);border-color:var(--ok);background:var(--ok-bg)}
.st.go-with-changes,.st.parked,.st.park,.st.medium{color:var(--chg);border-color:var(--chg);background:var(--chg-bg)}
.st.dropped,.st.drop,.st.high{color:var(--bad);border-color:var(--bad);background:var(--bad-bg)}
.st.low{color:var(--ok);border-color:var(--ok);background:var(--ok-bg)}
.swot{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.q4{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}
.q4 b{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
.q4.s b{color:var(--ok)}.q4.w b{color:var(--chg)}.q4.o b{color:var(--acc)}.q4.t b{color:var(--bad)}
.q4 ul,.raid ul{margin:0;padding-left:18px}.q4 li,.raid li{margin:3px 0}
.q4 .none,.none{color:var(--soft);font-style:italic}
.raid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,250px),1fr));gap:12px}
.raid>div{border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.raid b{display:block;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}
.sub{color:var(--muted);font-size:14px}
.cite{font-size:11.5px;font-weight:700;text-decoration:none;vertical-align:super;margin-left:2px}
table{width:100%;border-collapse:collapse;font-size:15px}
th{text-align:left;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:0 10px 8px}
td{padding:10px;border-top:1px solid var(--line);vertical-align:top}
.tw{overflow-x:auto}
.ans{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 24px 18px;border-top:1px solid var(--line);background:color-mix(in srgb,var(--bg) 45%,var(--card))}
.ans .lbl{font-size:14px;font-weight:600;color:var(--muted);margin-right:4px}
.choice{border:1.5px solid var(--line2);background:var(--card);border-radius:999px;padding:6px 14px;font-size:14.5px;font-weight:600;cursor:pointer;text-align:left}
.choice:hover{border-color:var(--muted)}.choice[aria-pressed=true]{background:var(--pick);border-color:var(--pick);color:#fff}
.choice .rec{font-size:11px;font-weight:700;color:var(--ok);margin-left:6px}.choice[aria-pressed=true] .rec{color:#fff}
.ans textarea,.ans input[type=text]{flex:1 1 100%;min-height:42px;resize:vertical;border:1.5px solid var(--line2);border-radius:10px;padding:9px 12px;font-size:15px;background:var(--card)}
.qrow{padding:14px 24px;border-top:1px solid var(--line)}
.qrow .qt{font-weight:600}.qrow .why{font-size:14px;color:var(--muted)}
.qrow .ans{border:0;background:none;padding:10px 0 0}
.answered{margin-top:6px;font-size:14.5px;padding:8px 12px;border-radius:10px;background:var(--ok-bg);color:var(--ink)}
.answered b{color:var(--ok)}
.dock{position:sticky;bottom:0;z-index:20;margin-top:26px;background:var(--card);border-top:1px solid var(--line);box-shadow:0 -6px 24px rgba(16,24,40,.08)}
.dock .wrap{display:flex;align-items:center;gap:14px;padding-top:10px;padding-bottom:10px}
.dock pre{flex:1;margin:0;font-family:var(--mono);font-size:13px;white-space:pre-wrap;max-height:88px;overflow:auto}
.dock pre.empty{color:var(--soft);font-family:inherit}
.copybtn{flex:none;border:0;border-radius:10px;background:var(--ink);color:var(--card);padding:11px 18px;font-weight:700;cursor:pointer}
.copybtn.done{background:var(--ok);color:#fff}
.toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);background:var(--ink);color:var(--card);padding:10px 16px;border-radius:10px;font-weight:600;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:120}.toast.on{opacity:1}
footer.end{padding:10px 0 28px;font-size:13px;color:var(--soft)}
@media (max-width:760px){.wrap{padding:0 14px}.card>.in{padding:16px}.ans{padding:12px 16px 16px}.qrow{padding:12px 16px}.swot{grid-template-columns:1fr}.dock .wrap{flex-wrap:wrap}.dock pre{flex-basis:100%}}
`

// The answer bar's script: collects lines from [data-line] controls, keeps them in localStorage,
// and copies them. Each page supplies compose(), which turns the state into lines.
const ANSWER_JS = `
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
let S={};try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
const one=(t)=>String(t||'').trim().replace(/\\s*\\n+\\s*/g,' / ');
function paint(){
  for(const b of $$('[data-pick]')){const k=b.dataset.pick;b.setAttribute('aria-pressed',String((S[k]||{}).v===b.dataset.v))}
  for(const t of $$('[data-note]')){if(document.activeElement!==t)t.value=(S[t.dataset.note]||{}).t||''}
  const text=compose();const pre=$('#out');pre.textContent=text||'Nothing answered yet. Pick or write on the page; your lines show here.';pre.classList.toggle('empty',!text);
}
document.addEventListener('click',(e)=>{const b=e.target.closest('[data-pick]');if(!b)return;const k=b.dataset.pick;S[k]=S[k]||{};S[k].v=S[k].v===b.dataset.v?null:b.dataset.v;save();paint()});
document.addEventListener('input',(e)=>{const t=e.target.closest('[data-note]');if(!t)return;const k=t.dataset.note;S[k]=S[k]||{};S[k].t=t.value;save();paint()});
const toast=(t)=>{const e=$('#toast');e.textContent=t;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),1800)};
$('#copy').addEventListener('click',async()=>{const text=compose();if(!text){toast('Nothing answered yet');return}
  let ok=false;try{await navigator.clipboard.writeText(text);ok=true}catch(e){const t=document.createElement('textarea');t.value=text;document.body.append(t);t.select();try{ok=document.execCommand('copy')}catch(e2){}t.remove()}
  const b=$('#copy');b.textContent=ok?'Copied ✓':'Select and copy';b.classList.toggle('done',ok);toast(ok?'Copied. Paste it in the chat.':'Copy blocked: select the text and copy it.');
  setTimeout(()=>{b.textContent='Copy answer';b.classList.remove('done')},2200)});
$('#clear').addEventListener('click',()=>{S={};save();paint();toast('Answers cleared')});
`

const page = ({ title, body, script, lang = 'en-GB' }) => `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="generator" content="ag ideas 1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
<div class="dock"><div class="wrap"><pre id="out" class="empty"></pre><button class="pill" id="clear" type="button">Clear</button><button class="copybtn" id="copy" type="button">Copy answer</button></div></div>
<div class="toast" id="toast" role="status"></div>
<script>
(()=>{
${script}
})();
</script>
</body>
</html>
`

const ul = (items, fmt = (x) => md(x.text)) => {
  const l = list(items).map(asItem)
  return l.length ? `<ul>${l.map((x) => `<li>${fmt(x)}</li>`).join('')}</ul>` : '<p class="none">None yet.</p>'
}

function swotBlock(swot, fmt) {
  const q = (cls, label, items) => `<div class="q4 ${cls}"><b>${label}</b>${ul(items, fmt)}</div>`
  return `<div class="swot">${q('s', 'Strengths', swot?.strengths)}${q('w', 'Weaknesses', swot?.weaknesses)}${q('o', 'Opportunities', swot?.opportunities)}${q('t', 'Threats', swot?.threats)}</div>`
}

function raidBlock(raid, fmt = (x) => md(x.text), { risks = true } = {}) {
  const risk = (x) => `${fmt(x)}${x.likelihood || x.impact ? ` <span class="sub">(likelihood ${esc(x.likelihood || '?')}, impact ${esc(x.impact || '?')})</span>` : ''}${x.mitigation ? `<br><span class="sub">Mitigation: ${md(x.mitigation)}</span>` : ''}`
  const asm = (x) => `${fmt(x)}${x.test ? `<br><span class="sub">How to test: ${md(x.test)}</span>` : ''}`
  return `<div class="raid">
${risks ? `<div><b>Risks</b>${ul(raid?.risks, risk)}</div>` : ''}
<div><b>Assumptions</b>${ul(raid?.assumptions, asm)}</div>
<div><b>Issues</b>${ul(raid?.issues, fmt)}</div>
<div><b>Dependencies</b>${ul(raid?.dependencies, fmt)}</div></div>`
}

// ---------- ideas.html ----------

export function renderIdeas(data, research = {}, generated = today()) {
  const ideas = [...data.ideas].sort((a, b) => numOf(b.id) - numOf(a.id))
  const counts = STATUSES.map((s) => [s, data.ideas.filter((i) => i.status === s).length]).filter(([, n]) => n)
  const cards = ideas.map((i) => ideaCard(i, research[i.id])).join('\n')
  const body = `
<div class="bar"><div class="wrap"><span class="t">Ideas · ${esc(data.project)}</span>
<div class="pills" role="group" aria-label="Show">${['all', ...STATUSES].map((s) => `<button class="pill" type="button" data-filter="${s}" aria-pressed="${s === 'all'}">${s === 'all' ? 'All' : STATUS_LABEL[s]}</button>`).join('')}</div>
<input class="search" id="q" type="search" placeholder="Search ideas" aria-label="Search ideas"></div></div>
<main class="wrap">
<div class="head"><div class="kicker">Ideas</div><h1>${esc(data.project)}</h1>
<div class="chips"><span class="chip"><b>${data.ideas.length}</b> ideas</span>${counts.map(([s, n]) => `<span class="chip"><b>${n}</b> ${STATUS_LABEL[s].toLowerCase()}</span>`).join('')}</div>
<p class="howto">Each idea has an id, a title, a description, a first look at its SWOT and RAID, and questions. Write a comment or answer a question on any idea, press <b>Copy answer</b> and paste the lines into the chat. To research an idea, run <code>/ag:idea-research ${esc(idOf(3, data.code))}</code>; its research gets a page of its own, linked from the idea. Add an idea with <code>/ag:idea &lt;your words&gt;</code>.</p></div>
${cards || '<div class="card"><div class="in"><p class="none">No ideas yet. Add one with <code>/ag:idea &lt;your words&gt;</code>.</p></div></div>'}
<footer class="end">Made ${esc(generated)} from ideas/ideas.json · ag ideas</footer>
</main>`
  const script = `const KEY=${JSON.stringify('ag-ideas:' + data.project)};
${ANSWER_JS}
function compose(){const out=[];
  for(const c of $$('article.idea')){const id=c.id;
    for(const q of $$('[data-q]',c)){const k=id+' '+q.dataset.q;const s=S[k]||{};const t=one(s.t);
      if(s.v||t)out.push(k+(s.v?' '+s.v:'')+(t?': '+t:''))}
    const t=one((S[id]||{}).t);if(t)out.push(id+': '+t)}
  return out.join('\\n')}
let filter='all';
function apply(){const q=$('#q').value.trim().toLowerCase();
  for(const c of $$('article.idea')){const okS=filter==='all'||c.dataset.status===filter;const okQ=!q||c.dataset.text.includes(q)||c.id.toLowerCase().includes(q);c.hidden=!(okS&&okQ)}}
for(const b of $$('[data-filter]'))b.addEventListener('click',()=>{filter=b.dataset.filter;for(const x of $$('[data-filter]'))x.setAttribute('aria-pressed',String(x===b));apply()});
$('#q').addEventListener('input',apply);
function focusHash(){const id=decodeURIComponent(location.hash.slice(1));if(!id)return;const c=document.getElementById(id);if(!c)return;
  for(const x of $$('article.idea.focus'))x.classList.remove('focus');c.hidden=false;c.classList.add('focus');for(const d of $$('details',c))d.open=true;
  setTimeout(()=>c.scrollIntoView({block:'start'}),30)}
window.addEventListener('hashchange',focusHash);
paint();focusHash();`
  return page({ title: `Ideas · ${data.project}`, body: body + IDEA_CSS, script })
}

const IDEA_CSS = `<style>
article.idea{scroll-margin-top:80px}
article.idea.focus{border-color:var(--acc);box-shadow:0 0 0 4px var(--acc-bg),var(--shadow)}
.ih{display:flex;align-items:flex-start;gap:14px}
.iid{flex:none;font-family:var(--mono);font-size:13px;font-weight:700;padding:5px 9px;border-radius:9px;background:var(--ink);color:var(--card);text-decoration:none;white-space:nowrap}
.ih h2{flex:1;margin:2px 0 0}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.desc{font-size:16.5px;margin:12px 0 0;max-width:85ch}
.target{margin:10px 0 0;padding:10px 14px;border-radius:10px;background:var(--acc-bg);font-size:15px}
.target b{color:var(--acc)}
.rs{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 0 0;padding:12px 14px;border:1px dashed var(--line2);border-radius:12px}
.rs a.go{font-weight:700;text-decoration:none;padding:7px 14px;border-radius:10px;background:var(--acc);color:#fff}
.rs .sum{flex:1 1 260px;font-size:14.5px}
details.more{margin-top:14px;border-top:1px solid var(--line);padding-top:10px}
details.more>summary{cursor:pointer;font-weight:600;color:var(--muted)}
.raw{font-size:14px;color:var(--muted);border-left:3px solid var(--line2);padding-left:10px;margin:10px 0 0}
.cm{font-size:14.5px;margin:6px 0;padding:8px 12px;border-radius:10px;background:var(--bg)}
.cm .d{color:var(--soft);font-size:12.5px;margin-right:6px}
@media (max-width:760px){.ih{flex-wrap:wrap}}
</style>`

function ideaCard(i, r) {
  const text = [i.id, i.title, i.description, i.raw, ...list(i.tags)].join(' ').toLowerCase()
  const verdict = r?.verdict?.call || i.research?.verdict
  const rsSummary = r ? list(r.summary)[0] : i.research?.summary
  const researchHref = `${encodeURI(i.folder)}/research.html`
  const research = r || i.research
    ? `<div class="rs"><a class="go" href="${researchHref}">Research page →</a>${verdict ? `<span class="st ${esc(verdict)}">${esc(CALL_LABEL[verdict] || verdict)}</span>` : ''}<span class="sum">${md(rsSummary || '')}${r?.date ? ` <span class="sub">(${esc(r.date)})</span>` : ''}</span></div>`
    : `<div class="rs"><span class="sum">Not researched yet. To research it: <code>/ag:idea-research ${esc(i.id)}</code></span></div>`
  const qs = list(i.questions).map((q) => {
    const opts = list(q.options).map((o) => (typeof o === 'string' ? o : o.text))
    const rec = typeof q.recommended === 'number' ? letter(q.recommended) : q.recommended
    const k = `${i.id} ${q.id}`
    const ans = q.answer ? `<div class="answered"><b>Answered${q.answer.date ? ' ' + esc(q.answer.date) : ''}:</b> ${q.answer.choice ? `${esc(q.answer.choice)}. ${md(q.answer.option || '')}` : ''}${q.answer.text ? (q.answer.choice ? ' — ' : '') + md(q.answer.text) : ''}</div>` : ''
    return `<div class="qrow" data-q="${esc(q.id)}"><div class="qt">${esc(q.id)}. ${md(q.q)}</div>${q.why ? `<div class="why">${md(q.why)}</div>` : ''}${ans}
<div class="ans">${opts.map((o, n) => `<button class="choice" type="button" data-pick="${esc(k)}" data-v="${letter(n)}">${letter(n)}. ${md(o)}${rec === letter(n) || rec === o ? '<span class="rec">Recommended</span>' : ''}</button>`).join('')}
<input type="text" data-note="${esc(k)}" placeholder="${q.answer ? 'Change the answer, or add to it' : opts.length ? 'A note (optional)' : 'Your answer'}"></div></div>`
  }).join('')
  const comments = list(i.comments).map((c) => `<div class="cm"><span class="d">${esc(c.date || '')}</span>${md(c.text)}</div>`).join('')
  const decision = i.decision ? `<span class="st ${esc(i.decision.call)}">Your call: ${esc(CALL_LABEL[i.decision.call] || i.decision.call)}</span>` : ''
  return `<article class="card idea" id="${esc(i.id)}" data-status="${esc(i.status)}" data-text="${esc(text)}"><div class="in">
<div class="ih"><a class="iid" href="#${esc(i.id)}">${esc(i.id)}</a><h2>${md(i.title)}</h2></div>
<div class="meta"><span class="st ${esc(i.status)}">${esc(STATUS_LABEL[i.status] || i.status)}</span><span class="chip">${esc(KIND_LABEL[i.kind] || i.kind)}</span><span class="chip">Added ${esc(i.created)}</span>${i.updated && i.updated !== i.created ? `<span class="chip">Updated ${esc(i.updated)}</span>` : ''}${list(i.tags).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${decision}</div>
<p class="desc">${md(i.description)}</p>
${i.target ? `<div class="target"><b>Target:</b> ${md(i.target)}</div>` : ''}
${research}
<details class="more"><summary>SWOT and RAID${r ? ' (first look; the research page has the full ones)' : ' (first look, before research)'}</summary>
<h3>SWOT</h3>${swotBlock(i.swot)}
<h3>RAID</h3>${raidBlock(i.raid)}
${i.raw ? `<h3>In your words</h3><p class="raw">${esc(i.raw)}</p>` : ''}
</details>
${comments ? `<h3>Comments</h3>${comments}` : ''}
</div>
${qs ? `<div class="qs">${qs}</div>` : ''}
<div class="ans"><span class="lbl">Comment on ${esc(i.id)}</span><textarea data-note="${esc(i.id)}" placeholder="Anything to add, change or ask about this idea"></textarea></div>
</article>`
}

// ---------- research.html ----------

export function renderResearch(r, idea, project, generated = today()) {
  const src = new Map(list(r.sources).map((s, n) => [s.id, n + 1]))
  const cites = (ids) => list(ids).map((s) => (src.has(s) ? `<a class="cite" href="#src-${esc(s)}" title="${esc(sourceTitle(r, s))}">[${src.get(s)}]</a>` : '')).join('')
  const fmt = (x) => `${md(x.text)}${cites(x.sources)}${x.judgement ? ' <span class="sub">(judgement)</span>' : ''}`
  const sections = []
  const NAV = { value: 'Value', now: 'Now', target: 'Target', gap: 'Gap', demand: 'Demand', voices: 'Voices', competitors: 'Competitors', swot: 'SWOT', raid: 'RAID', facts: 'Facts', next: 'Tests', sources: 'Sources', method: 'Method' }
  const sec = (id, title, html) => { if (html) sections.push({ id, title, html, nav: NAV[id] || title }) }

  const pts = (o) => o ? `${o.text ? `<p>${md(o.text)}</p>` : ''}${list(o.points).length ? `<ul>${list(o.points).map((p) => `<li>${md(p.text)}${cites(p.sources)}${list(p.where).length ? ` <span class="sub">${list(p.where).map((w) => `<code>${esc(w)}</code>`).join(' ')}</span>` : ''}</li>`).join('')}</ul>` : ''}` : ''
  const val = r.value ? `${pts(r.value)}${list(r.value.measures).length ? `<h3>How we would know it works</h3><ul>${list(r.value.measures).map((m) => `<li>${md(typeof m === 'string' ? m : m.text)}</li>`).join('')}</ul>` : ''}${r.size?.call ? `<p class="sub">Rough size, for the decision only: <span class="st">${esc(r.size.call)}</span> ${md(r.size.text || '')} How to build it, and the real estimate, come with <code>/ag:plan</code>.</p>` : ''}` : ''
  sec('value', 'How it brings value', val)
  sec('now', 'Where things stand now', pts(r.current))
  sec('target', 'The target', pts(r.target))
  sec('gap', 'What is missing', pts(r.gap))

  const kws = list(r.demand?.keywords)
  if (kws.length || r.demand?.text) {
    const max = Math.max(1, ...kws.map((k) => k.volume || 0))
    const rows = kws.map((k) => `<tr><td>${esc(k.phrase)}${cites(k.sources)}</td><td class="vol"><div class="vb"><span style="width:${(((k.volume || 0) / max) * 100).toFixed(1)}%"></span></div><b>${k.volume == null ? '—' : Number(k.volume).toLocaleString('en-GB')}</b></td><td>${k.cpc != null ? esc(k.cpc) : '—'}</td><td>${k.competition != null ? esc(k.competition) : '—'}</td><td>${spark(k.trend)}</td></tr>`).join('')
    sec('demand', 'Demand and search', `${r.demand?.text ? `<p>${md(r.demand.text)}</p>` : ''}${r.demand?.where ? `<p class="sub">${md(r.demand.where)}</p>` : ''}${kws.length ? `<div class="tw"><table><thead><tr><th>Phrase</th><th>Searches a month</th><th>CPC</th><th>Competition</th><th>Last 12 months</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}`)
  }
  if (list(r.voices).length) sec('voices', 'What people say', `<div class="voices">${list(r.voices).map((v) => `<div class="voice"><div class="vh">${v.kind ? `<span class="st ${esc(v.kind === 'pain' ? 'high' : v.kind === 'want' ? 'new' : v.kind === 'praise' ? 'low' : 'medium')}">${esc(v.kind)}</span>` : ''}<a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a></div><div class="sub">${esc(v.source || '')}${v.date ? ' · ' + esc(v.date) : ''}</div>${v.point ? `<div>${md(v.point)}</div>` : ''}${v.quote ? `<blockquote>“${esc(v.quote)}”</blockquote>` : ''}</div>`).join('')}</div>`)
  if (list(r.competitors).length) sec('competitors', 'Competitors and alternatives', `<div class="comps">${list(r.competitors).map((c) => `<div class="comp"><div class="vh"><b>${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)}</a>` : esc(c.name)}</b>${cites(c.sources)}</div>${c.what ? `<div>${md(c.what)}</div>` : ''}${c.pricing ? `<div class="sub">Pricing: ${md(c.pricing)}</div>` : ''}${c.traffic?.value != null ? `<div class="sub">Traffic: ${md(String(c.traffic.value))}${c.traffic.note ? ' ' + md(c.traffic.note) : ''}${cites(c.traffic.sources)}</div>` : ''}${list(c.strengths).length || list(c.weaknesses).length ? `<ul class="pc">${list(c.strengths).map((x) => `<li class="pro">${md(x)}</li>`).join('')}${list(c.weaknesses).map((x) => `<li class="con">${md(x)}</li>`).join('')}</ul>` : ''}</div>`).join('')}</div>`)
  if (r.swot) sec('swot', 'SWOT', swotBlock(r.swot, fmt))
  if (r.raid) {
    const risks = list(r.raid.risks).map(asItem)
    const riskTable = risks.length ? `<div class="tw"><table><thead><tr><th>Risk</th><th>Likelihood</th><th>Impact</th><th>Mitigation</th></tr></thead><tbody>${risks.map((x) => `<tr><td>${fmt(x)}</td><td><span class="st ${esc(x.likelihood)}">${esc(x.likelihood || '?')}</span></td><td><span class="st ${esc(x.impact)}">${esc(x.impact || '?')}</span></td><td>${md(x.mitigation || '')}</td></tr>`).join('')}</tbody></table></div>` : ''
    sec('raid', 'RAID', `${riskTable ? `<h3>Risks</h3>${riskTable}<h3>Assumptions, issues and dependencies</h3>` : ''}${raidBlock(r.raid, fmt, { risks: !riskTable })}`)
  }
  if (list(r.facts).length) sec('facts', 'Facts', `<ul>${list(r.facts).map((f) => `<li>${md(f.text)}${cites(f.sources)}</li>`).join('')}</ul>`)
  if (list(r.experiments).length) sec('next', 'Cheapest ways to test it', `<div class="tw"><table><thead><tr><th>Test</th><th>What tells us</th><th>Cost</th></tr></thead><tbody>${list(r.experiments).map((x) => `<tr><td>${md(x.text)}</td><td>${md(x.measure || '')}</td><td>${md(x.cost || '')}</td></tr>`).join('')}</tbody></table></div>`)
  if (list(r.sources).length) sec('sources', 'Sources', `<ol class="srcs">${list(r.sources).map((s) => `<li id="src-${esc(s.id)}">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>` : `<code>${esc(s.path)}</code>${s.title ? ' ' + esc(s.title) : ''}`}<span class="sub">${s.kind ? ' · ' + esc(s.kind) : ''}${s.date ? ' · ' + esc(s.date) : ''}</span></li>`).join('')}</ol>`)
  if (list(r.method).length) sec('method', 'Method', `<ul>${list(r.method).map((m) => `<li>${md(m)}</li>`).join('')}</ul>`)

  const v = r.verdict || {}
  const rqs = list(r.questions).map((q, n) => ({ id: q.id || `RQ${n + 1}`, ...q }))
  const answered = new Map(list(idea.researchAnswers).map((a) => [a.q, a]))
  const body = `
<div class="bar"><div class="wrap"><a class="pill" href="../ideas.html#${esc(idea.id)}">← All ideas</a><span class="t">${esc(idea.id)} · Research</span>
<nav class="pills"><a class="pill" href="#summary">Summary</a>${sections.map((s) => `<a class="pill" href="#${s.id}">${esc(s.nav)}</a>`).join('')}<a class="pill" href="#decide">Decide</a></nav></div></div>
<main class="wrap">
<div class="head" id="summary"><div class="kicker">${esc(idea.id)} · Research · ${esc(r.date || '')} · ${esc(KIND_LABEL[r.mode] || r.mode || '')}</div><h1>${md(idea.title)}</h1>
<p class="lead">${md(idea.description)}</p>
<div class="verdict ${esc(v.call)}"><div><span class="st ${esc(v.call)}">${esc(CALL_LABEL[v.call] || v.call || '?')}</span> <span class="sub">confidence ${esc(v.confidence || '?')}</span></div>${v.why ? `<p>${md(v.why)}</p>` : ''}</div>
${list(r.summary).length ? `<ul class="summary">${list(r.summary).map((l) => `<li>${md(l)}</li>`).join('')}</ul>` : ''}
<p class="howto">Every number and claim links to its source at the end ([1], [2] …). Make your call under <a href="#decide">Decide</a>, answer the open questions, then <b>Copy answer</b> and paste the lines into the chat.</p></div>
${sections.map((s) => `<section class="card sec" id="${s.id}"><div class="in"><h2>${esc(s.title)}</h2>${s.html}</div></section>`).join('\n')}
<section class="card sec" id="decide"><div class="in"><h2>Decide</h2><p class="sub">The research says <b>${esc(CALL_LABEL[v.call] || v.call || '?')}</b>. What is your call?${idea.decision ? ` Last recorded: <b>${esc(CALL_LABEL[idea.decision.call] || idea.decision.call)}</b> (${esc(idea.decision.date || '')}).` : ''}</p></div>
<div class="ans">${CALLS.map((c) => `<button class="choice" type="button" data-pick="decision" data-v="${c}">${esc(CALL_LABEL[c])}${c === v.call ? '<span class="rec">Research says</span>' : ''}</button>`).join('')}<textarea data-note="decision" placeholder="Why, or what to change"></textarea></div>
${rqs.map((q) => `<div class="qrow" data-rq="${esc(q.id)}"><div class="qt">${esc(q.id)}. ${md(q.q)}</div>${q.why ? `<div class="why">${md(q.why)}</div>` : ''}${answered.has(q.id) ? `<div class="answered"><b>Answered ${esc(answered.get(q.id).date || '')}:</b> ${md(answered.get(q.id).text)}</div>` : ''}<div class="ans"><input type="text" data-note="${esc(q.id)}" placeholder="Your answer"></div></div>`).join('')}
</section>
<footer class="end">Made ${esc(generated)} from ${esc(idea.folder)}/research.json · project ${esc(project)} · ag ideas</footer>
</main>${RESEARCH_CSS}`
  const script = `const KEY=${JSON.stringify('ag-idea-research:' + project + ':' + idea.id)};const ID=${JSON.stringify(idea.id)};
${ANSWER_JS}
function compose(){const out=[];const d=S.decision||{};const t=one(d.t);
  if(d.v)out.push(ID+' decision '+d.v+(t?': '+t:''));else if(t)out.push(ID+': '+t);
  for(const q of $$('[data-rq]')){const s=S[q.dataset.rq]||{};const a=one(s.t);if(a)out.push(ID+' '+q.dataset.rq+': '+a)}
  return out.join('\\n')}
paint();`
  return page({ title: `${idea.id} research · ${idea.title}`, body, script })
}

const sourceTitle = (r, id) => { const s = list(r.sources).find((x) => x.id === id); return s ? s.title || s.url || s.path || id : id }

function spark(t) {
  const n = list(t).filter((x) => typeof x === 'number')
  if (n.length < 2) return '<span class="sub">—</span>'
  const max = Math.max(...n), min = Math.min(...n), w = 120, h = 28
  const pts = n.map((v, i) => `${((i / (n.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(' ')
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Monthly searches, oldest to newest: ${n.join(', ')}"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts}"/></svg>`
}

const RESEARCH_CSS = `<style>
.verdict{margin:6px 0 14px;padding:14px 18px;border-radius:12px;border:1.5px solid var(--line2);background:var(--card);max-width:90ch}
.verdict.go{border-color:var(--ok)}.verdict.go-with-changes,.verdict.park{border-color:var(--chg)}.verdict.drop{border-color:var(--bad)}
.verdict p{margin:8px 0 0}
.summary{font-size:16.5px;max-width:90ch;padding-left:20px}.summary li{margin:4px 0}

.ph{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
td.vol{min-width:170px}.vb{display:inline-block;width:100px;height:9px;border-radius:5px;background:var(--bg);border:1px solid var(--line);margin-right:8px;vertical-align:middle;overflow:hidden}
.vb span{display:block;height:100%;background:var(--acc)}
.spark{color:var(--acc);display:block}
.voices,.comps{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px}
.voice,.comp{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--bg)}
.vh{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600}
blockquote{margin:8px 0 0;padding-left:10px;border-left:3px solid var(--line2);color:var(--muted);font-style:italic}
ul.pc{list-style:none;padding:0;margin:8px 0 0}ul.pc li{padding-left:20px;position:relative;margin:3px 0}
ul.pc li.pro::before{content:"+";position:absolute;left:4px;color:var(--ok);font-weight:800}
ul.pc li.con::before{content:"−";position:absolute;left:4px;color:var(--chg);font-weight:800}
.srcs{padding-left:24px;font-size:14.5px}.srcs li{margin:4px 0;scroll-margin-top:80px}.srcs li:target{background:var(--acc-bg);border-radius:6px}
</style>`

// ---------- render everything ----------

export function renderAll(dir, { strict = false, log = console.log } = {}) {
  const data = loadIdeas(dir)
  const warnings = checkIdeas(data)
  const research = {}
  let pages = 0
  for (const idea of data.ideas) {
    let r = null
    try { r = loadResearch(dir, idea) } catch (e) { warnings.push(e.message) }
    if (!r) {
      if (idea.research) warnings.push(`${idea.id}: the list says it was researched, but ${path.relative(dir, researchFile(dir, idea))} is missing`)
      continue
    }
    warnings.push(...checkResearch(r, idea))
    research[idea.id] = r
    fs.writeFileSync(path.join(dir, idea.folder, 'research.html'), renderResearch(r, idea, data.project))
    pages++
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ideas.html'), renderIdeas(data, research))
  for (const w of warnings) log(`warning: ${w}`)
  log(`${data.ideas.length} ideas, ${pages} research pages, ${warnings.length} warnings -> ${path.join(dir, 'ideas.html')}`)
  return { warnings, ok: !(strict && warnings.length) }
}

// ---------- open in the browser ----------

// Windows drops the #fragment when it opens a local file, so a page with a fragment is opened
// through a small redirect file in the temp folder.
export function openTarget(dir, idea, { research = false } = {}) {
  const file = path.resolve(research && idea ? path.join(dir, idea.folder, 'research.html') : path.join(dir, 'ideas.html'))
  if (!fs.existsSync(file)) throw new InputError(`${file} does not exist; run render first${research ? ' (and the research)' : ''}`)
  if (research || !idea) return file
  const url = pathToFileURL(file).href + '#' + encodeURIComponent(idea.id)
  const tmp = path.join(os.tmpdir(), 'ag-ideas')
  fs.mkdirSync(tmp, { recursive: true })
  const redirect = path.join(tmp, `open-${idea.id}.html`)
  fs.writeFileSync(redirect, `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc(url)}"><title>${esc(idea.id)}</title><script>location.replace(${JSON.stringify(url)})</script><a href="${esc(url)}">Open ${esc(idea.id)}</a>\n`)
  return redirect
}

function launch(file) {
  const opts = { detached: true, stdio: 'ignore' }
  if (process.platform === 'win32') spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${file}"`], { ...opts, windowsVerbatimArguments: true }).unref()
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], opts).unref()
}

// ---------- command line ----------

function args(argv) {
  const o = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      if (['strict', 'research', 'no-open', 'help'].includes(k)) o[k] = true
      else o[k] = argv[++i]
    } else o._.push(a)
  }
  return o
}

const readText = (f) => (f === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(f, 'utf8')).replace(/^﻿/, '')

// The project's ideas/ folder: --dir if given, else <git root or cwd>/ideas; refuses the home folder.
export function ideasDir(given, cwd = process.cwd(), home = os.homedir()) {
  if (given) return path.resolve(cwd, given)
  let root = cwd
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || cwd } catch { /* not a git repository */ }
  root = path.resolve(root)
  if (root.toLowerCase() === path.resolve(home).toLowerCase()) throw new InputError(`ideas belong to a project: run this from the project's folder, not ${root}, or give --dir`)
  return path.join(root, 'ideas')
}

export function main(argv = process.argv.slice(2), log = console.log) {
  const o = args(argv)
  const cmd = o._.shift()
  if (!cmd || o.help) { const src = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r/g, '').split('\n'); log(src.slice(1, src.findIndex((l, n) => n > 0 && !l.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return cmd || o.help ? 0 : 2 }
  try {
    const dir = ideasDir(o.dir)
    if (cmd === 'add') {
      if (!o.from) throw new InputError('add needs --from <draft.json>')
      let draft
      try { draft = JSON.parse(readText(o.from)) } catch (e) { throw new InputError(`${o.from} is not valid JSON: ${e.message}`) }
      const data = loadIdeas(dir, o.project)
      if (o.project) data.project = o.project
      if (o.code) {
        const c = String(o.code).toUpperCase()
        if (!CODE_RE.test(c)) throw new InputError(`--code must be 4 or 5 letters, not "${o.code}"`)
        if (data.code && data.code !== c && data.ideas.length) throw new InputError(`this list's code is ${data.code} and its ids and folders carry it; it stays`)
        data.code = c
      }
      const idea = addIdea(data, draft)
      const w = checkIdeas(data).filter((x) => x.startsWith(idea.id))
      if (w.length) throw new InputError(w.join('\n'))
      saveIdeas(dir, data)
      log(`${idea.id} ${idea.folder}`)
      return 0
    }
    if (cmd === 'render') return renderAll(dir, { strict: o.strict, log }).ok ? 0 : 1
    if (cmd === 'list') {
      const data = loadIdeas(dir)
      for (const i of data.ideas) log(`${i.id}  ${i.status.padEnd(11)}  ${i.title}`)
      if (!data.ideas.length) log('no ideas yet')
      return 0
    }
    if (cmd === 'resolve') {
      const data = loadIdeas(dir)
      const i = resolveId(data, o._[0] ?? o.id)
      log(JSON.stringify({ id: i.id, title: i.title, status: i.status, kind: i.kind, folder: path.join(dir, i.folder), research: researchFile(dir, i), researchExists: fs.existsSync(researchFile(dir, i)) }, null, 2))
      return 0
    }
    if (cmd === 'record') {
      if (!o.from) throw new InputError('record needs --from <answers.txt> (or - for stdin)')
      const data = loadIdeas(dir)
      const def = o.id ? resolveId(data, o.id).id : null
      const { answers, bad } = parseAnswers(readText(o.from), def)
      const done = applyAnswers(data, answers)
      saveIdeas(dir, data)
      for (const d of done) log(d)
      for (const b of bad) log(`not understood: ${b}`)
      return bad.length ? 1 : 0
    }
    if (cmd === 'status') {
      const data = loadIdeas(dir)
      const idea = setStatus(data, o._[0] ?? o.id, o._[1] ?? o.status)
      saveIdeas(dir, data)
      log(`${idea.id} ${idea.status}`)
      return 0
    }
    if (cmd === 'link') {
      const data = loadIdeas(dir)
      const idea = resolveId(data, o._[0] ?? o.id)
      linkResearch(data, idea, loadResearch(dir, idea))
      saveIdeas(dir, data)
      log(`${idea.id} ${idea.status}: ${idea.research.verdict ?? 'no verdict'} -> ${idea.research.path}`)
      return 0
    }
    if (cmd === 'open') {
      const data = loadIdeas(dir)
      const idea = o.id ? resolveId(data, o.id) : null
      const file = openTarget(dir, idea, { research: o.research })
      if (!o['no-open']) launch(file)
      log(file)
      return 0
    }
    throw new InputError(`unknown command "${cmd}" (add, render, open, record, resolve, list)`)
  } catch (e) {
    if (e instanceof InputError) { log(`error: ${e.message}`); return 2 }
    throw e
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main()
