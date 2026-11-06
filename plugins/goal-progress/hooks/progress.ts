import type { GoalProgress, GoalStep, GoalTask, LogLine, RunningJob, TaskStatus } from '../types'

export const FILE = '.claude/goal-progress.json'

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'deployed', 'shown', 'waiting', 'blocked', 'skipped']

type Raw = Record<string, unknown>

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null

const statusOf = (v: unknown): TaskStatus => (STATUSES.includes(v as TaskStatus) ? (v as TaskStatus) : 'todo')

const noteOf = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

/** Which model runs a job or step ("opus-high", "sonnet", "fw:glm-5p3-flash"), trimmed; anything else is dropped. */
const engineOf = (v: unknown): string | undefined => noteOf(v)?.trim()

/** The engine as a label beside a title, " [sonnet]"; empty when there is none. */
export const engineLabel = (engine: string | undefined): string => (engine ? ` [${engine}]` : '')

/** True for an engine on Fireworks ("fw:..."), false for one on Claude. */
export const onFireworks = (engine: string | undefined): boolean => !!engine?.startsWith('fw:')

/** A token count: a finite number, zero or more; anything else is dropped. */
const tokensOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined)

/** The sum of the steps' tokens, when any step has a count. */
const stepTokens = (steps: GoalStep[]): number | undefined =>
  steps.some(s => s.tokens !== undefined) ? steps.reduce((n, s) => n + (s.tokens ?? 0), 0) : undefined

/** A token count, short: "850", "9.5k", "12k", "240k", "1.2M"; one decimal below 10, none from 10 up. */
export function shortTokens(n: number): string {
  const short = (v: number) => (v.toFixed(1) !== '10.0' && v < 10 ? v.toFixed(1) : String(Math.round(v)))
  if (Math.round(n) < 1000) return String(Math.round(n))
  const k = short(n / 1e3)
  if (Number(k) < 1000) return `${k}k`

  return `${short(n / 1e6)}M`
}

function parseSteps(v: unknown): GoalStep[] {
  if (!Array.isArray(v)) return []

  return v.filter(isObject).map((s, i) => ({
    id: String(s.id ?? i + 1),
    title: String(s.title ?? ''),
    status: statusOf(s.status),
    note: noteOf(s.note),
    tokens: tokensOf(s.tokens),
    engine: engineOf(s.engine),
  }))
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
  const tasks: GoalTask[] = o.tasks
    .filter(isObject)
    .map((t, i) => {
      const steps = parseSteps(t.steps)

      return {
        id: String(t.id ?? i + 1),
        title: String(t.title ?? ''),
        status: statusOf(t.status),
        note: noteOf(t.note),
        tokens: tokensOf(t.tokens) ?? stepTokens(steps),
        steps,
      }
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

/** How many tasks have each status. */
export function tally(p: GoalProgress): Record<TaskStatus, number> {
  const n: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0, deployed: 0, shown: 0, waiting: 0, blocked: 0, skipped: 0 }
  for (const t of p.tasks) n[t.status] += 1

  return n
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
  for (const s of task.steps.filter(s => s.status === 'waiting' || s.status === 'blocked')) {
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

/** What the pane writes in a step's status column. */
export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'not started',
  doing: 'in progress',
  done: 'done',
  deployed: 'deployed',
  shown: 'shown',
  waiting: 'waiting',
  blocked: 'blocked',
  skipped: 'skipped',
}

const RANK: Record<TaskStatus, number> = { deployed: 0, done: 1, shown: 2, doing: 3, blocked: 4, waiting: 4, todo: 5, skipped: 6 }

/**
 * A task's steps for the pane, all of them, in the order work moves through:
 * deployed, done, shown, in progress, blocked or waiting, not started, skipped; file order within each.
 */
export function orderedSteps(task: GoalTask): GoalStep[] {
  return task.steps
    .map((s, i) => ({ s, i }))
    .sort((a, b) => RANK[a.s.status] - RANK[b.s.status] || a.i - b.i)
    .map(({ s }) => s)
}

/** Whether a task is open in the pane: the person's choice, else only the current task. */
export function isOpen(task: GoalTask, current: GoalTask | undefined, opened: Record<string, boolean>): boolean {
  return opened[task.id] ?? task === current
}

/** Cuts text to `width` cells, ending in "…" when cut. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  const cells = Array.from(text)
  if (cells.length <= width) return text

  return width === 1 ? '…' : `${cells.slice(0, width - 1).join('').trimEnd()}…`
}

/** A bar of `width` cells, e.g. "██████░░░░". */
export function bar(done: number, total: number, width = 20): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The task being worked on: the first "doing", else the first "blocked", else the first "todo". */
export function current(p: GoalProgress): GoalTask | undefined {
  return (
    p.tasks.find(t => t.status === 'doing') ??
    p.tasks.find(t => t.status === 'blocked') ??
    p.tasks.find(t => t.status === 'todo')
  )
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
