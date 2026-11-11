// Prints the goal's tasks as the pane sees them (epics > stories > subtasks, from the plan
// with the progress file on top) and what is off in the file; --write rewrites the file
// minimal, after a timestamped copy (goal-progress.json.<yyyymmdd-hhmmss>.bak); keys it does
// not know and `updated` stay as they were.
//
//   node --experimental-strip-types --no-warnings plugins/ag/scripts/refresh-tasks.ts
//     [--root <dir>] [--plan <path>] [--write] [--json]

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { GoalProgress, GoalStep } from '../types/index.d.ts'

type Progress = typeof import('../hooks/progress.ts')

const here = dirname(fileURLToPath(import.meta.url))
const lib = (await import(pathToFileURL(join(here, '..', 'hooks', 'progress.ts')).href)) as Progress

function args(argv: string[]) {
  const out: { root: string; plan?: string; write: boolean; json: boolean } = { root: process.cwd(), write: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--root') out.root = resolve(argv[++i] ?? '.')
    else if (a === '--plan') out.plan = argv[++i]
    else if (a === '--write') out.write = true
    else if (a === '--json') out.json = true
    else {
      console.error(`refresh-tasks: unknown argument ${a}`)
      process.exit(1)
    }
  }

  return out
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf8') : undefined)

/** The plan's text, undefined when nothing is there; a path that is not a readable file exits with a message. */
function readPlan(path: string): string | undefined {
  try {
    if (!existsSync(path)) return undefined
    if (!statSync(path).isFile()) throw new Error('it is not a file')

    return readFileSync(path, 'utf8')
  } catch (e) {
    console.error(`refresh-tasks: cannot read the plan at ${path}: ${e instanceof Error ? e.message : String(e)} (give one with --plan <path>)`)
    process.exit(1)
  }
}

/** Local time as yyyymmdd-hhmmss, for the backup's name. */
function stamp(d = new Date()): string {
  const two = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
}

const opt = args(process.argv.slice(2))
const file = join(opt.root, '.claude', 'goal-progress.json')
const text = read(file)
const parsed = text ? lib.parseProgress(text) : null
if (text && !parsed) {
  console.error(`refresh-tasks: ${file} is not a progress file (bad JSON or no tasks)`)
  process.exit(1)
}
// an empty --plan or "plan": "" falls through to the next choice
const planPath = resolve(opt.root, opt.plan?.trim() || parsed?.plan?.trim() || 'PLAN.md')
const planText = readPlan(planPath)
if (!parsed && !planText) {
  console.error(`refresh-tasks: nothing to read: no ${file} and no plan at ${planPath} (give one with --plan <path>)`)
  process.exit(1)
}
const p: GoalProgress = parsed ?? { goal: 'Goal', status: 'running', tasks: [], running: [], log: [] }
const marks = planText ? lib.parsePlanMarks(planText) : []
const raw = text && parsed ? (JSON.parse(text) as Record<string, unknown>) : {}
const { progress, tree, findings } = lib.refreshProgress(p, marks, Date.now(), raw)

if (opt.json) {
  console.log(JSON.stringify({ tree, findings }, null, 2))
} else {
  const lines: string[] = []
  const walk = (s: GoalStep, depth: number) => {
    const head = `${'  '.repeat(depth)}${lib.STATUS_LABEL[s.status].padEnd(12)}${s.id}${s.title ? ` ${s.title}` : ''}`
    lines.push(s.note ? `${head} — ${s.note}` : head)
    for (const c of s.steps ?? []) walk(c, depth + 1)
  }
  for (const t of tree) walk(t, 0)
  console.log(`${p.goal}  (plan: ${planText ? planPath : 'none'})`)
  console.log(lines.join('\n'))
  console.log(findings.length > 0 ? `\nFindings:\n${findings.map(f => `- ${f}`).join('\n')}` : '\nFindings: none')
}

if (opt.write) {
  if (!parsed) {
    console.error(`refresh-tasks: no progress file at ${file} to rewrite; nothing written`)
    process.exit(1)
  }
  let bak = `${file}.${stamp()}.bak`
  for (let i = 2; existsSync(bak); i++) bak = `${file}.${stamp()}-${i}.bak`
  copyFileSync(file, bak)
  writeFileSync(file, `${JSON.stringify(progress, null, 2)}\n`)
  console.error(`refresh-tasks: wrote ${file} (the old one in ${bak})`)
}
