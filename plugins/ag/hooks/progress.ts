import type { GoalProgress, GoalStep, GoalTask, LogLine, RunningJob, TaskStatus } from '../types'

export const FILE = '.claude/goal-progress.json'

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null

/** The words and phrases each status is written as, in a file, a table cell or a `Status:` line. */
const WORDS: [TaskStatus, string[]][] = [
  ['doing', ['doing', 'running', 'in progress', 'in-progress', 'started', 'building', 'wip', 'active']],
  ['done', ['done', 'complete', 'completed', 'finished', 'built', 'merged', 'landed', 'closed', 'approved']],
  ['deployed', ['deployed', 'released', 'live', 'shipped']],
  ['shown', ['shown', 'to approve', 'in review', 'awaiting approval', 'for approval']],
  ['needs-you', ['needs you', 'needs-you', 'waiting for you', 'waits for you', 'your turn', 'yours', 'for you']],
  ['waiting', ['waiting', 'waits', 'on hold', 'paused', 'pending']],
  ['blocked', ['blocked', 'failed']],
  ['skipped', ['skipped', 'dropped', 'deleted', 'cancelled', 'canceled', 'n/a']],
  ['todo', ['todo', 'to do', 'not started', 'planned', 'open', 'next']],
]

/** Longest phrase first, so "waiting for you" wins over "waiting". */
const PHRASES = WORDS.flatMap(([status, ws]) => ws.map(w => ({ status, w }))).sort((a, b) => b.w.length - a.w.length)

/**
 * Words common in prose ("open questions remain", "next we add", "for you to see"): they read
 * as a status only when nothing but punctuation, a date or the end follows them.
 */
const WEAK = ['open', 'next', 'yours', 'for you']

/** A symbol a mark may lead with, alone or before its word: ✅ is done, ⏳ or 🔄 in progress. */
const SYMBOLS: [RegExp, TaskStatus][] = [
  [/^(?:✅|✔|☑|✓)/u, 'done'],
  [/^(?:⏳|⌛|🔄)/u, 'doing'],
]

/** A waiting or blocked reason that is about the person: their sign-off, their approval, their key. */
const ABOUT_YOU = /\b(you|your|sign[- ]?off|approve|approval)\b/i

/** Text without markdown markup: bold, code, emphasis at word edges, and a leading bullet or symbol. */
const unmark = (v: string) =>
  v
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_]+|[*_]+(?=\s|$)/g, '$1')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim()

/** The status a text starts with and the text after it; no status when no phrase matches. */
function readStatus(text: string, reason = ''): { status?: TaskStatus; rest: string } {
  const sym = SYMBOLS.find(([re]) => re.test(text.replace(/^[\s*_`>-]+/, '')))
  const t = unmark(text)
  const low = t.toLowerCase()
  const hit = PHRASES.find(p => {
    if (!low.startsWith(p.w) || /[\p{L}\p{N}]/u.test(low.charAt(p.w.length))) return false
    if (!WEAK.includes(p.w)) return true
    const after = t.slice(p.w.length).trim()

    return after === '' || /^[,;:.()—–-]/.test(after) || LEAD_DATE.test(after)
  })
  if (!hit) return sym ? { status: sym[1], rest: t } : { rest: t }
  const rest = t.slice(hit.w.length)
  const about = (hit.status === 'waiting' || hit.status === 'blocked') && ABOUT_YOU.test(`${rest} ${reason}`)

  return { status: about ? 'needs-you' : hit.status, rest }
}

/**
 * The status a text is written as: the first known phrase at its start, case-insensitive,
 * after markup and a leading "- " ("done 2026-11-07", "**running**", "waits for you").
 * A `waiting` or `blocked` whose reason (the rest of the text, or `reason`) is about the
 * person ("you", "your", "sign-off", "approve", "approval") is `needs-you`. Undefined
 * when no phrase matches: the caller reads it as `todo` and reports it.
 */
export function statusWord(text: string, reason = ''): TaskStatus | undefined {
  return readStatus(text, reason).status
}

const noteOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** Which model runs a job or step ("opus-high", "sonnet", "fw:glm-5p3-flash"), trimmed; anything else is dropped. */
const engineOf = (v: unknown): string | undefined => noteOf(v)?.trim()

/** The engine as a label beside a title, " [sonnet]"; empty when there is none. */
export const engineLabel = (engine: string | undefined): string => (engine ? ` [${engine}]` : '')

/** True for an engine on Fireworks ("fw:..."), false for one on Claude. */
export const onFireworks = (engine: string | undefined): boolean => !!engine?.startsWith('fw:')

/** A token count: a finite number, zero or more; anything else is dropped. */
const tokensOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

/** The sum of the children's tokens, when any child has a count. */
const sumTokens = (steps: { tokens?: number }[]): number | undefined =>
  steps.some(s => s.tokens !== undefined) ? steps.reduce((n, s) => n + (s.tokens ?? 0), 0) : undefined

/** A token count, short: "850", "9.5k", "12k", "240k", "1.2M"; one decimal below 10, none from 10 up. */
export function shortTokens(n: number): string {
  const short = (v: number) => (v.toFixed(1) !== '10.0' && v < 10 ? v.toFixed(1) : String(Math.round(v)))
  if (Math.round(n) < 1000) return String(Math.round(n))
  const k = short(n / 1e3)
  if (Number(k) < 1000) return `${k}k`

  return `${short(n / 1e6)}M`
}

/** An object without its undefined keys, so parsed and merged entries compare equal. */
function clean<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}

/** A file entry's status, read with `statusWord`; `statusText` keeps the word as written when it is not canonical. */
function fileStatus(v: unknown, note: string | undefined): { status: TaskStatus; statusText?: string } {
  if (typeof v !== 'string' || !v.trim()) return { status: 'todo' }
  const status = statusWord(v, note ?? '') ?? 'todo'

  return v.trim().toLowerCase() === status ? { status } : { status, statusText: v.trim() }
}

function parseSteps(v: unknown): GoalStep[] {
  if (!Array.isArray(v)) return []

  return v.filter(isObject).map(parseEntry)
}

/** One entry of `tasks` or of a `steps` list, at any level, with its own `steps` when it has any. */
function parseEntry(s: Raw, i: number): GoalStep {
  const steps = parseSteps(s.steps)
  const note = noteOf(s.note)

  return clean({
    id: String(s.id ?? i + 1),
    title: String(s.title ?? ''),
    ...fileStatus(s.status, note),
    note,
    tokens: tokensOf(s.tokens) ?? sumTokens(steps),
    engine: engineOf(s.engine),
    steps: steps.length > 0 ? steps : undefined,
  })
}

/** The `running` list; a job with no title is dropped, one with no kind reads as "other". */
function parseRunning(v: unknown): RunningJob[] {
  if (!Array.isArray(v)) return []

  return v
    .filter(isObject)
    .filter(j => noteOf(j.title))
    .map(j => ({
      kind: noteOf(j.kind)?.trim() ?? 'other',
      title: String(j.title).trim(),
      since: noteOf(j.since),
      note: noteOf(j.note),
      engine: engineOf(j.engine),
    }))
}

/** The `log` list: each line a string or `{ text, at }`; empty ones are dropped. */
function parseLog(v: unknown): LogLine[] {
  if (!Array.isArray(v)) return []

  return v.flatMap(l => {
    if (typeof l === 'string') return l.trim() ? [{ text: l.trim() }] : []
    if (!isObject(l) || !noteOf(l.text)) return []

    return [{ text: String(l.text).trim(), at: noteOf(l.at) }]
  })
}

/** Parses the progress file; null when it is missing fields or not JSON. */
export function parseProgress(text: string): GoalProgress | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.tasks)) return null
  const tasks: GoalTask[] = o.tasks.filter(isObject).map((t, i) => {
    const e = parseEntry(t, i)

    return { ...e, steps: e.steps ?? [] }
  })
  const status = o.status === 'blocked' || o.status === 'done' || o.status === 'waiting' ? o.status : 'running'

  return {
    goal: typeof o.goal === 'string' ? o.goal : 'Goal',
    plan: typeof o.plan === 'string' ? o.plan : undefined,
    status,
    note: typeof o.note === 'string' ? o.note : undefined,
    updated: typeof o.updated === 'string' ? o.updated : undefined,
    tasks,
    running: parseRunning(o.running),
    log: parseLog(o.log),
  }
}

/**
 * The progress file's text to show after a read: the read's own text when it is
 * a progress file, else the last good text, so a read that comes back empty or
 * half-written (the file being rewritten, or a working directory that moved)
 * keeps what was shown. Empty when nothing good was ever read.
 */
export function keepLastGood(text: string, last: string): string {
  if (text && parseProgress(text)) return text

  return last && parseProgress(last) ? last : ''
}

/**
 * A mark a plan gives an id: its status, its title when the plan names one, its direct
 * `parent` (the nearest shallower marked heading, the table's phase row, or the story an
 * id-shape part belongs to) and its `phase` (the epic it sits in). `note`: the mark's text
 * after the status word and its date. `statusText`: the mark as written when its word is
 * unknown; it has no `status` then, so the file's status shows. `unmarked`: an id heading
 * or table row with no status at all; it gives the tree its title and place, no status.
 */
export type PlanMark = {
  id: string
  status?: TaskStatus
  title?: string
  phase?: string
  parent?: string
  note?: string
  statusText?: string
  unmarked?: boolean
}

/** A date at the start of a mark's rest: "2026-11-07", "11 November 2026", "Nov 11, 2026". */
const LEAD_DATE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/

/** The note a mark's rest gives: without the leading punctuation and date; undefined when nothing is left. */
function markNote(rest: string): string | undefined {
  const trim = (v: string) => v.replace(/^[\s,:;.—–-]+/, '').trim()
  const note = trim(trim(rest).replace(LEAD_DATE, ''))

  return note || undefined
}

/** A mark's status and note from its text; an unknown word gives no status and is kept in `statusText`. */
function markOf(text: string): Pick<PlanMark, 'status' | 'note' | 'statusText'> {
  const { status, rest } = readStatus(text)
  if (!status) return { statusText: unmark(text).slice(0, 40) || text.trim().slice(0, 40) }

  return clean({ status, note: markNote(rest) })
}

/** Plan text without its markup: no bold, code or emphasis markers. */
const plain = (v: string) =>
  v
    .replace(/\*\*|__|`/g, '')
    .replace(/(^|\s)[*_]+|[*_]+(?=\s|$)/g, '$1')
    .trim()

/** A table row's cells, trimmed, without the outer bars. */
const rowCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

/** "Phase 6: Second layer" -> "Second layer". */
const noPhase = (title: string) => title.replace(/^Phase\s+[\w.]+\s*[:.—–-]\s*/i, '').trim()

/** An id heading's text: `<id><sep><title>`, with an optional prefix word kept in the id. */
const ID_HEAD = /^(?:(fix|step|task|story|epic)\s+)?([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)(?:\s*[.:]\s*|\s+[-—–]\s*|\s+|$)(.*)$/i

/** A token that can be an id: it has a digit (`1.1`, `T5`, `UXB1`) or is all capitals, two or more (`UXB`). */
const isIdToken = (v: string) => /\d/.test(v) || /^[A-Z]{2,}$/.test(v)

/** The id and title a heading gives, or undefined when it is not an id heading. */
function headingId(text: string): { id: string; title: string } | undefined {
  const t = plain(text)
  const ph = /^Phase\s+(\w[\w.]*)\s*(?:[.:—–-]\s*)?(.*)$/i.exec(t)
  if (ph && /\d/.test(ph[1])) return { id: `P${ph[1]}`, title: plain(ph[2]) }
  const h = ID_HEAD.exec(t)
  if (!h || !isIdToken(h[2])) return undefined

  return { id: h[1] ? `${h[1]} ${h[2]}` : h[2], title: plain(h[3]) }
}

/** A `Status:` line: `Status: x`, `**Status:** x`, `**Status**: x`, `- **Status:** x`, `* Status: x`. */
const STATUS_LINE = /^(?:[-*+]\s+)?(?:\*\*|__)?Status(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/i

/** Whether `id` is the row's id plus a part suffix (`6.4a`, `6.4-ui`). */
const isPartId = (row: string, id: string) =>
  id.length > row.length && id.slice(0, row.length).toLowerCase() === row.toLowerCase() && /^(?:[a-z]|-[a-z][\w-]*)$/.test(id.slice(row.length))

/**
 * The part marks in the rest of a table status cell, after its first comma: `6.4a done
 * 2026-11-11`, or a list sharing one status, `6.4a, 6.4b and 6.4c done 2026-11-11`. A piece
 * that is not a part id (with a known status, or bare and followed by one) stays in the note.
 */
function cellParts(row: string, pieces: string[]): { parts: { id: string; text: string }[]; notes: string[] } {
  const parts: { id: string; text: string }[] = []
  const notes: string[] = []
  let waiting: string[] = [] // bare part ids waiting for the status that follows them
  for (const piece of pieces) {
    const words = plain(piece).split(/\s+and\s+/)
    const read = words.map(w => {
      const m = /^(\S+)(?:\s+(.+))?$/.exec(w.trim())
      if (!m || !isPartId(row, m[1])) return undefined
      if (!m[2]) return { id: m[1] }
      return statusWord(m[2]) ? { id: m[1], text: m[2] } : undefined
    })
    if (read.some(r => r === undefined)) {
      notes.push(...waiting, plain(piece))
      waiting = []
      continue
    }
    for (const r of read) {
      if (!r) continue
      if (r.text === undefined) waiting.push(r.id)
      else {
        for (const id of [...waiting, r.id]) parts.push({ id, text: r.text })
        waiting = []
      }
    }
  }
  notes.push(...waiting)

  return { parts, notes: notes.filter(Boolean) }
}

/**
 * The marks a plan gives its epics, stories and subtasks, in plan order, by id: tracker
 * tables (`| ID | Step | ... | Status |`, a bold id row is an epic) and `Status:` lines
 * under id headings (`## Phase 4: ...`, `### UXB: ...`, `#### 4.1 ...`, `### fix 1 ...`),
 * nested by heading depth. A part id (`6.4a`, `3.3-ui`) under a story of the same epic
 * is that story's subtask. Fenced code is skipped.
 */
export function parsePlanMarks(text: string): PlanMark[] {
  const out: PlanMark[] = []
  const lines = text.split(/\r?\n/)
  let fenced = false
  // tables
  let cols: { id: number; title: number; status: number } | undefined
  let epic: string | undefined
  // headings: the id heading waiting for its Status line, and the marked headings still open
  let head: { id: string; title: string; level: number; parent?: string; phase?: string } | undefined
  let stack: { id: string; level: number }[] = []
  const add = (m: PlanMark) => out.push(clean(m))
  // an id heading under a marked one that got no Status line: kept as unmarked, to be reported
  const flush = () => {
    if (head?.parent) add({ id: head.id, title: head.title || undefined, phase: head.phase, parent: head.parent, unmarked: true })
    head = undefined
  }
  for (const line of lines) {
    const t = line.trim()
    if (/^(```|~~~)/.test(t)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (t.startsWith('|')) {
      const cells = rowCells(t)
      if (!cols) {
        const low = cells.map(c => plain(c).toLowerCase())
        const id = low.indexOf('id')
        const status = low.indexOf('status')
        const named = low.findIndex(c => ['step', 'title', 'task', 'story', 'name'].includes(c))
        if (id >= 0 && status >= 0) cols = { id, title: named >= 0 ? named : id + 1, status }
        continue
      }
      if (cells.every(c => /^:?-*:?$/.test(c))) continue
      const idCell = cells[cols.id] ?? ''
      const id = plain(idCell)
      if (!/[A-Za-z0-9]/.test(id)) continue
      const isEpic = /^\*\*.+\*\*$/.test(idCell)
      const title = isEpic ? noPhase(plain(cells[cols.title] ?? '')) : plain(cells[cols.title] ?? '')
      const cell = (cells[cols.status] ?? '').trim()
      const place = isEpic ? {} : { phase: epic, parent: epic }
      if (isEpic) epic = id
      if (!plain(cell)) {
        add({ id, title: title || undefined, ...place, unmarked: true })
        continue
      }
      // a comma before a year belongs to a date ("done Nov 11, 2026"), not between parts
      const [first = '', ...more] = cell.split(/\s*,(?!\s*\d{4}\b)\s*/)
      const own = markOf(first)
      const found = cellParts(id, more)
      const notes = [...(own.note ? [own.note] : []), ...found.notes]
      const parts: PlanMark[] = found.parts.map(x => ({ id: x.id, ...markOf(x.text), phase: isEpic ? id : epic, parent: id }))
      add({ id, title: title || undefined, ...place, ...own, note: notes.join(', ') || undefined })
      for (const p of parts) add(p)
      continue
    }
    cols = undefined
    epic = undefined
    const h =/^(#{1,6})\s+(.*)$/.exec(t)
    if (h) {
      flush()
      const level = h[1].length
      stack = stack.filter(s => s.level < level)
      const found = level >= 2 && level <= 5 ? headingId(h[2]) : undefined
      if (found) head = { ...found, level, parent: stack[stack.length - 1]?.id, phase: stack[0]?.id }
      continue
    }
    const s = STATUS_LINE.exec(t)
    if (!s || !head) continue
    add({ id: head.id, title: head.title || undefined, ...markOf(s[1]), phase: head.phase, parent: head.parent })
    stack.push({ id: head.id, level: head.level })
    head = undefined
  }
  flush()

  return nestParts(out)
}

/** A mark whose id is a story's id plus a part suffix (`3.2a`, `3.3-ui`), in the same epic, moves under that story. */
function nestParts(marks: PlanMark[]): PlanMark[] {
  const byId = new Map(marks.map(m => [m.id.toLowerCase(), m]))

  return marks.map(m => {
    const shape = /^(.*\d)(?:[a-z]|-[a-z][\w-]*)$/.exec(m.id)
    const story = shape ? byId.get(shape[1].toLowerCase()) : undefined
    if (!story || story === m || m.parent === story.id) return m
    const epicOf = (x: PlanMark) => x.phase ?? (x.parent ? undefined : x.id)
    if (epicOf(story) !== epicOf(m) || story.parent === undefined) return m

    return { ...m, parent: story.id, phase: story.phase ?? m.phase }
  })
}

/**
 * The marks to show after a read of the plan: the read's own when it has any, else
 * the last good ones, so an empty or half-written plan (read while it is rewritten)
 * keeps what was shown.
 */
export function keepLastMarks(text: string, last: PlanMark[]): PlanMark[] {
  const marks = parsePlanMarks(text)

  return marks.length > 0 ? marks : last
}

/** The statuses a plan `todo` does not downgrade: work the file has in flight. */
const IN_FLIGHT: TaskStatus[] = ['doing', 'waiting', 'blocked', 'needs-you', 'shown']

/** An id to match on: lower case, single spaces, `phase4` / `phase-4` / `Phase 4` spelled `p4`, `fix3` / `fix-3` spelled `fix 3`. */
const norm = (id: string) =>
  id
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^phase[-\s]?(?=\d)/, 'p')
    .replace(/^(fix|step|task|story|epic)[-\s]?(?=\d)/, '$1 ')

/** A part id: a story id plus one lowercase letter (`3.2a`) or a `-word` (`3.3-ui`); group 1 is the story id. */
const PART = /^(.*\d)(?:[a-z]|-[a-z][\w-]*)$/

/** A file-only id that points into an epic: `p4-review`, `p4 e2e`, `4-plan` (normalised); group 1 is the epic number. */
const POINTER = [/^p(\d+[a-z]?)[-\s](.+)$/, /^(\d+[a-z]?)-([a-z].*)$/]

/** A node of the merged tree: the plan's mark and the file's entry for one id. */
type Node = {
  id: string
  mark?: PlanMark
  file?: GoalStep
  /** True for a node the plan has (marked, or named as a parent). */
  plan: boolean
  kids: Node[]
  /** File-only children, after the plan's. */
  extra: Node[]
  /** A title for a file-only node without one: the suffix of its pointer id. */
  fallback?: string
  top?: boolean
  out?: GoalStep
}

/** A file title without a leading copy of its id ("1.1 Events" -> "Events"). */
function stripId(title: string, id: string): string {
  const t = title.trim()
  if (!t.toLowerCase().startsWith(id.toLowerCase())) return t
  const after = t.slice(id.length)
  if (after && !/^(\s*[.:—–-]\s*|\s+)/.test(after)) return t

  return after.replace(/^\s*[.:—–-]?\s*/, '') || t
}

const started = (s: TaskStatus) => s !== 'todo' && s !== 'skipped'

/** The plan's marks and the file's entries as one tree, plan order first, with what could not be placed. */
function buildTree(p: GoalProgress, marks: PlanMark[], titles: Record<string, string>) {
  const byId = new Map<string, Node>()
  const roots: Node[] = []
  const loose: Node[] = []
  const unmatched: string[] = []
  const placed: { id: string; under: string }[] = []
  const nodeOf = (id: string): Node => {
    const found = byId.get(norm(id))
    if (found) return found
    const made: Node = { id, plan: true, kids: [], extra: [] }
    byId.set(norm(id), made)
    roots.push(made)

    return made
  }
  const dups: string[] = []
  for (const m of marks) {
    const known = byId.get(norm(m.id))
    if (known) {
      // a real mark wins over an earlier unmarked one; the first real mark stays
      if (!known.mark || (known.mark.unmarked && !m.unmarked)) known.mark = { ...m, title: m.title ?? known.mark?.title }
      continue
    }
    const n: Node = { id: m.id, mark: m, plan: true, kids: [], extra: [] }
    byId.set(norm(m.id), n)
    const parent = m.parent ?? m.phase
    if (parent) nodeOf(parent).kids.push(n)
    else roots.push(n)
  }
  const visit = (e: GoalStep, fileParent: Node | undefined) => {
    let n = byId.get(norm(e.id))
    if (n?.file) {
      n.file = mergeEntries(n.file, e)
      dups.push(e.id)
    } else if (n) {
      n.file = e
    } else {
      const key = norm(e.id)
      let host: Node | undefined
      let fallback: string | undefined
      const part = PART.exec(key)
      if (part) host = byId.get(part[1])
      for (const re of POINTER) {
        const ptr = re.exec(key)
        if (!ptr) continue
        fallback = ptr[2]
        host = host ?? byId.get(`p${ptr[1]}`)
        break
      }
      if (host) placed.push({ id: e.id, under: host.id })
      host = host ?? fileParent
      n = { id: e.id, file: e, plan: false, kids: [], extra: [], fallback }
      byId.set(key, n)
      if (host) host.extra.push(n)
      else {
        loose.push(n)
        unmatched.push(e.id)
      }
    }
    for (const c of e.steps ?? []) visit(c, n)
  }
  for (const t of p.tasks) visit(t, undefined)
  const all = [...roots, ...loose]
  for (const n of all) n.top = true

  const render = (n: Node): GoalStep => {
    const kids = [...n.kids, ...n.extra].map(render)
    const ms = n.mark?.status
    const fs = n.file?.status
    const ownMark = ms !== undefined && ms !== 'todo'
    let status: TaskStatus =
      ownMark ? (ms as TaskStatus) : ms === 'todo' && fs && (n.top || IN_FLIGHT.includes(fs)) ? fs : ms === 'todo' ? 'todo' : fs ?? 'todo'
    if (status === 'todo' && !ownMark && kids.length > 0) {
      if (!kids.some(k => k.status === 'doing') && kids.some(k => k.status === 'needs-you')) status = 'needs-you'
      else if (kids.some(k => started(k.status))) status = 'doing'
    }
    const fileTitle = n.file?.title ? stripId(n.file.title, n.file.id) : ''
    const out = clean({
      id: n.mark?.id ?? n.id,
      title: n.mark?.title || titles[n.id] || fileTitle || n.fallback || '',
      status,
      note: n.file?.note ?? n.mark?.note,
      tokens: (n.file && ownTokens(n.file)) ?? sumTokens(kids),
      engine: n.file?.engine,
      steps: kids.length > 0 || n.top ? kids : undefined,
    }) as GoalStep
    n.out = out

    return out
  }
  const tasks = all.map(n => render(n) as GoalTask)

  return { all, tasks, unmatched, placed, dups }
}

/** How far along a status is, to keep the further one when an id is in the file twice. */
const RANK: TaskStatus[] = ['todo', 'skipped', 'waiting', 'blocked', 'needs-you', 'doing', 'shown', 'done', 'deployed']

/**
 * Two file entries with one id, as one: the further status (with its `statusText`), both
 * notes, both lists of steps, the first title and engine, the larger own token count.
 */
function mergeEntries(a: GoalStep, b: GoalStep): GoalStep {
  const win = RANK.indexOf(b.status) > RANK.indexOf(a.status) ? b : a
  const notes = [a.note, b.note].filter((v, i, all): v is string => !!v && all.indexOf(v) === i)
  const steps = [...(a.steps ?? []), ...(b.steps ?? [])]
  const own = [a, b].map(ownTokens).filter((t): t is number => t !== undefined)

  return clean({
    id: a.id,
    title: a.title || b.title,
    status: win.status,
    statusText: win.statusText,
    note: notes.join('; ') || undefined,
    tokens: own.length > 0 ? Math.max(...own) : sumTokens(steps),
    engine: a.engine ?? b.engine,
    steps: steps.length > 0 ? steps : undefined,
  })
}

/**
 * The file's progress on the plan's skeleton. The plan gives epics, stories and subtasks
 * in its order; the file's entries are matched to them by id at any level (case aside,
 * `phase4` = `P4`). A file-only id goes under the epic or story it points at (`P4-review`,
 * `4-plan` -> under P4; `3.3-ui` -> under 3.3), else under its parent in the file, else at
 * the end. The plan's statuses win; a plan `todo` does not downgrade the file's work in
 * flight (doing, waiting, blocked, needs-you, shown), nor an epic's own file status. A node
 * with no non-todo mark of its own reads needs-you when a child needs you and none is in
 * progress, else doing when a child started. Titles: the plan's, else the file's. Notes,
 * tokens and engines come from the file; a node without tokens sums its children's.
 */
export function mergePlan(p: GoalProgress, marks: PlanMark[], titles: Record<string, string> = {}): GoalProgress {
  return { ...p, tasks: buildTree(p, marks, titles).tasks }
}

/** A subagent of this session, as `$.agent.list()` reports it. */
export type Agent = { id?: string; description?: string; type?: string; status?: string; name?: string; model?: string }

/** The agent statuses that count as running: `waiting` is a subagent waiting on its own job. */
const LIVE = ['pending', 'running', 'waiting']

/**
 * The session's subagents that are pending, running or waiting, as running jobs: the
 * description (or the type) as the title, the model as the engine where given.
 */
export function agentJobs(agents: Agent[]): RunningJob[] {
  return agents
    .filter(a => isObject(a) && LIVE.includes(String((a as Raw).status ?? '').toLowerCase()))
    .map(a => ({
      kind: 'agent',
      title: noteOf(a.description) ?? noteOf(a.type) ?? noteOf(a.name) ?? 'agent',
      engine: engineOf(a.model),
    }))
}

/** The progress with the session's live subagents beside the file's own running jobs. */
export function mergeAgents(p: GoalProgress, agents: Agent[]): GoalProgress {
  const jobs = agentJobs(agents)

  return jobs.length > 0 ? { ...p, running: [...p.running, ...jobs] } : p
}

/** How long since `iso`, short: "40s", "12m", "1h 05m"; undefined when it is not a time. */
export function elapsed(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`

  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/**
 * One line per running job, e.g. "deploy  Release 0.9.4 [sonnet] · 4m" split into its parts;
 * `text` carries the engine label, `engine` is there too so a renderer can colour it.
 */
export function runningLines(p: GoalProgress, now: number): { kind: string; text: string; time?: string; engine?: string }[] {
  return p.running.map(j => {
    const title = `${j.title}${engineLabel(j.engine)}`

    return {
      kind: j.kind,
      text: j.note ? `${title}, ${j.note}` : title,
      time: elapsed(j.since, now),
      ...(j.engine ? { engine: j.engine } : {}),
    }
  })
}

/** The finished statuses: built (`done`), released (`deployed`), or shown and waiting for the sign-off. */
export const isFinished = (s: TaskStatus): boolean => s === 'done' || s === 'deployed' || s === 'shown'

/** Done counts `deployed` and `shown` too; skipped ones leave the total. */
export function counts(p: { tasks: { status: TaskStatus }[] }): { done: number; total: number } {
  const total = p.tasks.filter(t => t.status !== 'skipped').length
  const done = p.tasks.filter(t => isFinished(t.status)).length

  return { done, total }
}

const zero = (): Record<TaskStatus, number> => ({ todo: 0, doing: 0, done: 0, deployed: 0, shown: 0, 'needs-you': 0, waiting: 0, blocked: 0, skipped: 0 })

/** How many tasks (epics) have each status. */
export function tally(p: GoalProgress): Record<TaskStatus, number> {
  const n = zero()
  for (const t of p.tasks) n[t.status] += 1

  return n
}

/** How many stories have each status, counting an epic with no stories as one. */
export function storyTally(p: GoalProgress): Record<TaskStatus, number> {
  const n = zero()
  for (const t of p.tasks) {
    if (t.steps.length === 0) n[t.status] += 1
    for (const s of t.steps) n[s.status] += 1
  }

  return n
}

/** Every item at any level that waits on the person: needs-you, and shown (to approve); plan order. */
export function needsYouItems(p: GoalProgress): GoalStep[] {
  const out: GoalStep[] = []
  const walk = (s: GoalStep) => {
    if (s.status === 'needs-you' || s.status === 'shown') out.push(s)
    for (const c of s.steps ?? []) walk(c)
  }
  for (const t of p.tasks) walk(t)

  return out
}

export type SummaryLine = {
  label: 'done' | 'now' | 'waiting' | 'next'
  text: string
  /** Drawn dim after `text` (the "then ..." of the next line). */
  rest?: string
}

const named = (s: GoalStep): string => `${s.id} ${s.title}`.trim() + engineLabel(s.engine)

/** The card under the current task: its steps done out of total and up to four kinds of line. */
export function stepSummary(task: GoalTask): { done: number; total: number; lines: SummaryLine[] } {
  const { done, total } = counts({ tasks: task.steps })
  const lines: SummaryLine[] = []
  const finished = task.steps.filter(s => isFinished(s.status))
  const last = finished[finished.length - 1]
  if (last) lines.push({ label: 'done', text: last.note ? `${named(last)} (${last.note})` : named(last) })
  for (const s of task.steps.filter(s => s.status === 'doing')) lines.push({ label: 'now', text: named(s) })
  for (const s of task.steps.filter(s => s.status === 'needs-you' || s.status === 'waiting' || s.status === 'blocked')) {
    lines.push({ label: 'waiting', text: s.note ? `${named(s)}, ${s.note}` : named(s) })
  }
  const [first, ...others] = task.steps.filter(s => s.status === 'todo')
  if (first) {
    lines.push({
      label: 'next',
      text: named(first),
      ...(others.length ? { rest: `, then ${others.map(s => s.id).join(', ')}` } : {}),
    })
  }

  return { done, total, lines }
}

/** What the pane writes in a status column. */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'not started',
  doing: 'in progress',
  done: 'done',
  deployed: 'deployed',
  shown: 'to approve',
  'needs-you': 'needs you',
  waiting: 'waiting',
  blocked: 'blocked',
  skipped: 'skipped',
}

/** A task's steps for the pane, all of them, in plan (then file) order. */
export function orderedSteps(task: GoalTask): GoalStep[] {
  return task.steps
}

/** Whether a task is open in the pane: the person's choice, else only the current task. */
export function isOpen(task: GoalTask, current: GoalTask | undefined, opened: Record<string, boolean>): boolean {
  return opened[task.id] ?? task === current
}

/** Code points that take no cell: combining marks, zero-width spaces and joiners, variation selectors, skin tones, tags, controls. */
const ZERO_W = /^(?:\p{Mn}|\p{Me}|\p{Cc}|[​-‏⁠﻿︀-️\u{1F3FB}-\u{1F3FF}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}])$/u

/** Code points that take two cells: East Asian wide and fullwidth, and emoji shown as emoji. */
const WIDE =
  /^(?:\p{Emoji_Presentation}|[ᄀ-ᅟ⌚⌛〈〉⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏ꥠ-꥿가-힣豈-﫿︐-︙︰-﹯＀-｠￠-￦\u{1B000}-\u{1B2FF}\u{20000}-\u{3FFFD}])$/u

/** Each code point of `text` with the cells it takes: 0, 1 or 2. */
function widths(text: string): [string, number][] {
  const cps = Array.from(text)
  let flag = 0 // regional indicators in a row: each pair is one flag, two cells

  return cps.map((c, i) => {
    const ri = /^\p{Regional_Indicator}$/u.test(c)
    flag = ri ? flag + 1 : 0
    if (cps[i - 1] === '‍' || ZERO_W.test(c)) return [c, 0] // after a joiner, one glyph with the emoji before it
    if (ri) return [c, flag % 2 === 1 ? 2 : 0]
    if (WIDE.test(c)) return [c, 2]
    if (cps[i + 1] === '️' && /^\p{Extended_Pictographic}$/u.test(c)) return [c, 2] // "✔️": text emoji shown as emoji

    return [c, 1]
  })
}

/** How many terminal cells a text takes: wide (CJK, fullwidth, emoji) 2, combining and joiners 0, else 1. */
export const textWidth = (text: string): number => widths(text).reduce((n, [, w]) => n + w, 0)

const cells = textWidth

/** `text` padded with spaces to `width` cells, on the right (or on the left with `start`). */
export function padCells(text: string, width: number, start = false): string {
  const pad = ' '.repeat(Math.max(0, width - textWidth(text)))

  return start ? pad + text : text + pad
}

/** Cuts text to at most `width` cells, ending in "…" when cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (textWidth(text) <= width) return text
  if (width === 1) return '…'
  let out = ''
  let used = 0
  for (const [c, w] of widths(text)) {
    if (used + w > width - 1) break
    out += c
    used += w
  }

  return `${out.trimEnd()}…`
}

/** A bar of `width` cells, e.g. "██████░░░░". */
export function bar(done: number, total: number, width = 20): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The first item of `list` whose status comes first in `order`. */
function firstBy<T extends { status: TaskStatus }>(list: T[], order: TaskStatus[]): T | undefined {
  for (const s of order) {
    const hit = list.find(t => t.status === s)
    if (hit) return hit
  }

  return undefined
}

/**
 * The epic the bar names: the first "doing", else the first "needs-you", "waiting" or
 * "blocked", else — when the goal itself is "waiting", at a gate — the last "shown" epic
 * (the one the person is being asked to sign off), else the first "todo".
 */
export function current(p: GoalProgress): GoalTask | undefined {
  const shown = p.status === 'waiting' ? [...p.tasks].reverse().find(t => t.status === 'shown') : undefined

  return firstBy(p.tasks, ['doing', 'needs-you', 'waiting', 'blocked']) ?? shown ?? p.tasks.find(t => t.status === 'todo')
}

/** The story the current epic is on: its first doing, else needs-you, shown, waiting, blocked, else first todo. */
export function currentStory(p: GoalProgress): GoalStep | undefined {
  const epic = current(p)

  return epic ? firstBy(epic.steps, ['doing', 'needs-you', 'shown', 'waiting', 'blocked', 'todo']) : undefined
}

export function ago(iso: string | undefined, now: number): string | undefined {
  if (!iso) return undefined
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return undefined
  const s = Math.max(0, Math.round((now - at) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`

  return `${Math.round(s / 3600)}h ago`
}

/** One line for the status line, e.g. "Goal ██████░░░░ 3/8 · A1.4 CV review v2 · running". */
export function statusLine(p: GoalProgress): string {
  const { done, total } = counts(p)
  const now = current(p)
  const task = p.status === 'done' ? 'all tasks done' : now ? `${now.id} ${now.title}`.trim() : ''

  const state = (p.status === 'waiting' || p.status === 'blocked') && p.note ? `${p.status}: ${p.note}` : p.status

  const jobs = p.running.length > 0 ? `${p.running.length} running` : ''

  return [`Goal ${bar(done, total, 10)} ${done}/${total}`, task, state, jobs].filter(Boolean).join(' · ')
}

/** One row of a pane card before layout: `lead` is the glyph and status column, drawn as given. */
export type RowInput = {
  lead: string
  id: string
  /** The id column's width for this card; the id is cut to it. */
  idW: number
  title: string
  engine?: string
  note?: string
  tokens?: string
  /** The tokens column's width for this card; 0 when no row has tokens. */
  tokW: number
}

/** A row's segments, drawn in this order; their cells add up to exactly the width. */
export type RowSegments = { lead: string; id: string; title: string; engine: string; pad: string; note: string; tokens: string }

const padTo = (text: string, width: number) => padCells(text, width)

/**
 * Lays out a row in exactly `width` cells: lead, id column, title, engine label, padding,
 * note, tokens. When it does not fit, the note goes first (cut, then dropped), then the
 * engine label is shortened, then the title is cut (it keeps 10 cells when it can, and the
 * engine is dropped before it goes below that). A width too small for the lead, id and
 * tokens puts the whole row, cut, in `lead`.
 */
export function layoutRow(r: RowInput, width: number): RowSegments {
  const w = Math.max(0, width)
  const idCol = r.idW > 0 ? `${padTo(fit(r.id, r.idW), r.idW)} ` : ''
  const tokCol = r.tokW > 0 ? `  ${padCells(fit(r.tokens ?? '', r.tokW), r.tokW, true)}` : ''
  const room = w - cells(r.lead) - cells(idCol) - cells(tokCol)
  const empty = { id: '', title: '', engine: '', pad: '', note: '', tokens: '' }
  if (room < 1) {
    return { ...empty, lead: padTo(fit(`${r.lead}${idCol}${r.title}`, w), w) }
  }
  const title = r.title
  const engineFull = engineLabel(r.engine)
  let note = ''
  if (r.note) {
    const space = room - cells(engineFull) - cells(title) - 2
    if (space >= 8) note = `  ${fit(r.note, space)}`
  }
  const rest = room - cells(note)
  const titleMin = Math.min(cells(title), 10)
  const ENGINE_MIN = 6 // " [ab…]"
  let engine = engineFull
  if (cells(title) + cells(engine) > rest && engine) {
    const cut = (n: number) => ` [${fit(r.engine ?? '', n - 3)}]`
    const avail = rest - cells(title)
    if (avail >= ENGINE_MIN) engine = cut(avail)
    else if (rest - ENGINE_MIN >= titleMin) engine = cut(ENGINE_MIN)
    else engine = ''
  }
  const shown = fit(title, rest - cells(engine))
  const pad = ' '.repeat(Math.max(0, rest - cells(shown) - cells(engine)))

  return { lead: r.lead, id: idCol, title: shown, engine, pad, note, tokens: tokCol }
}

/** A running job without a `since` older than this is dropped by a refresh. */
const STALE_MS = 3 * 3600 * 1000

/** What `refreshProgress` gives: the file to write, the merged tree and what it found. */
export type Refresh = { progress: Raw; tree: GoalTask[]; findings: string[] }

/**
 * The progress file rebuilt on the plan: `tree` is the merged tree; `progress` is the file
 * to write: `raw` (the file as read, so keys this code does not know stay) with goal, plan,
 * status, note, `updated` as the file had it (a refresh is no news from the goal), the last
 * 10 log lines, the running jobs less those over 3 hours old, and minimal `tasks`: nested by the plan's ids,
 * only entries that add what the plan lacks (a note, own tokens, an engine, a status the
 * plan leaves to the file, a title the plan has not, file-only items), statuses written as
 * canonical words. `findings` lists file ids not in the plan, status words read as another,
 * plan items with no mark, epics whose stories are all finished but which still read
 * todo/doing, stale jobs dropped, and what needs the person.
 */
export function refreshProgress(p: GoalProgress, marks: PlanMark[], now: number, raw: Raw = {}): Refresh {
  const { all, tasks, unmatched, placed, dups } = buildTree(p, marks, {})
  const findings: string[] = []

  const minimal = (n: Node): Raw | undefined => {
    const kids = [...n.kids, ...n.extra].map(minimal).filter((k): k is Raw => k !== undefined)
    const steps = kids.length > 0 ? { steps: kids } : {}
    const out = n.out as GoalStep
    const f = n.file
    if (!n.plan && f) {
      return clean({ id: f.id, title: out.title || undefined, status: f.status, note: f.note, tokens: ownTokens(f), engine: f.engine, ...steps })
    }
    const add: Raw = {}
    if (f) {
      const ms = n.mark?.status
      if (f.status !== 'todo' && (!ms || (ms === 'todo' && (n.top || IN_FLIGHT.includes(f.status))))) add.status = f.status
      if (!n.mark?.title && f.title) add.title = stripId(f.title, f.id)
      if (f.note) add.note = f.note
      const t = ownTokens(f)
      if (t !== undefined) add.tokens = t
      if (f.engine) add.engine = f.engine
    }
    if (Object.keys(add).length === 0 && kids.length === 0) return undefined

    return { id: out.id, ...add, ...steps }
  }
  const written = all.map(minimal).filter((t): t is Raw => t !== undefined)

  const words = (s: GoalStep) => {
    if (s.statusText) findings.push(`status "${s.statusText}" on ${s.id} read as ${s.status}`)
    for (const c of s.steps ?? []) words(c)
  }
  for (const t of p.tasks) words(t)
  for (const m of marks) {
    if (m.statusText) findings.push(`plan status "${m.statusText}" on ${m.id} not known, the file's status shows`)
  }
  for (const id of dups) findings.push(`${id} is in the file twice, merged (the further status, both notes and steps)`)
  if (marks.length > 0 && unmatched.length > 0) findings.push(`not in the plan (kept at the end): ${unmatched.join(', ')}`)
  for (const x of placed) findings.push(`${x.id} is not in the plan, placed under ${x.under}`)
  const nomark = marks.filter(m => m.unmarked).map(m => m.id)
  if (nomark.length > 0) findings.push(`no status mark in the plan: ${nomark.join(', ')}`)
  for (const t of tasks) {
    const live = t.steps.filter(s => s.status !== 'skipped')
    if (live.length > 0 && live.every(s => isFinished(s.status)) && (t.status === 'todo' || t.status === 'doing')) {
      findings.push(`${t.id}: all its stories are finished but it reads ${STATUS_LABEL[t.status]}`)
    }
  }
  const running = p.running.filter(j => {
    const at = j.since ? Date.parse(j.since) : Number.NaN
    const stale = !Number.isNaN(at) && now - at > STALE_MS
    if (stale) findings.push(`stale job dropped: ${j.kind} ${j.title} (since ${j.since})`)

    return !stale
  })
  for (const s of needsYouItems({ ...p, tasks })) {
    findings.push(`${STATUS_LABEL[s.status]}: ${`${s.id} ${s.title}`.trim()}${s.note ? ` — ${s.note}` : ''}`)
  }

  const progress: Raw = {
    ...raw,
    ...clean({
      goal: p.goal,
      plan: p.plan,
      status: p.status,
      note: p.note,
      updated: p.updated,
      running: running.map(j => clean({ ...j })),
      log: p.log.slice(-10).map(l => clean({ ...l })),
      tasks: written,
    }),
  }

  return { progress, tree: tasks, findings }
}

/** An entry's own tokens: none when they are only the sum of its children's. */
function ownTokens(e: GoalStep): number | undefined {
  if (e.tokens === undefined) return undefined
  if (e.steps && e.steps.length > 0 && e.tokens === sumTokens(e.steps)) return undefined

  return e.tokens
}
