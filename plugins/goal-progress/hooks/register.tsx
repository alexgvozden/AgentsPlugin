import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { GoalProgress, GoalStep, TaskStatus } from '../types'
import { FILE, ago, bar, counts, current, engineLabel, fit, isOpen, onFireworks, orderedSteps, parseProgress, runningLines, shortTokens, STATUS_LABEL } from './progress'

const progress = atom({ plugin: 'goal-progress', key: 'progress' } as const, null)
const isHidden = atom({ plugin: 'goal-progress', key: 'isHidden' } as const, false)
/** Bumped every TICK_MS, so times and "updated ... ago" move. */
const tick = atom({ plugin: 'goal-progress', key: 'tick' } as const, 0)
const opened = atom({ plugin: 'goal-progress', key: 'opened' } as const, {})

/** The docs' own example for a value from outside the session polls once a second. */
const POLL_MS = 1000
const TICK_MS = 30_000
/** "updated ... ago" turns yellow past this while the goal runs: the file may be behind. */
const STALE_MS = 15 * 60_000
/** The band's bar cells, and the room its Tasks button takes. */
const BAND_BAR = 12
const BUTTON_W = 12
/** Lines of the goal's log the pane shows, newest first. */
const LOG_LINES = 5
const PANE = 'goal-tasks'
const PANE_TITLE = 'Goal tasks'

let last = ''
let lastTick = 0
/** The terminal's columns, as the last drawing saw them; 0 before any. */
let termCols = 0

/**
 * Where the progress file may be: the project's own, then the main checkout's
 * when the session works inside one of its git worktrees (.claude/worktrees/<id>).
 */
const PLACES = [FILE, `../../${FILE.replace(/^\.claude\//, '')}`]

async function readFile($: EngineInterface): Promise<string> {
  for (const place of PLACES) {
    const text = (await $.fs.exists(place).catch(() => false)) ? await $.fs.read(place).catch(() => '') : ''
    if (text) return text
  }

  return ''
}

/**
 * Reads the progress file; redraws when its text changed, and every TICK_MS so
 * times and "updated ... ago" move. A half-written file (not valid JSON) keeps
 * the last good state and is read again at the next poll.
 */
async function refresh($: EngineInterface): Promise<void> {
  const text = await readFile($)
  const now = await $.clock.now()
  let changed = false
  if (now - lastTick >= TICK_MS) {
    lastTick = now
    await update($, tick, n => n + 1)
    changed = true
  }
  const p = text === last ? undefined : text ? parseProgress(text) : null
  if (p !== undefined && !(text && !p)) {
    last = text
    await update($, progress, () => p)
    changed = true
  }
  // Writing the atom should redraw the sites that read it; ask for the redraw
  // as well, so the band and an open pane never wait for the next input.
  if (changed) $.ui.invalidate('ui.render')
}

/** Reads the file again from scratch and redraws, whatever was read before. */
async function reload($: EngineInterface): Promise<void> {
  last = ''
  await refresh($)
  $.ui.invalidate('ui.render')
}

const KIND_COLOR: Record<string, string> = { deploy: 'magenta', tests: 'blue', build: 'cyan', review: 'white' }

const kindColor = (kind: string) => KIND_COLOR[kind] ?? 'gray'

const isStale = (p: GoalProgress, now: number) =>
  p.status === 'running' && !!p.updated && now - Date.parse(p.updated) >= STALE_MS

/** The status column: as wide as "not started". */
const LABEL_W = 11
/** The room a step title keeps at least when the pane asks for its width. */
const TITLE_MIN = 34
/** The transcript keeps at least this many columns beside the docked pane. */
const TRANSCRIPT_MIN = 40

const tokensText = (n: number | undefined) => (n === undefined ? '' : shortTokens(n))

/** The width of a task's tokens column: its widest step value; 0 when no step has tokens. */
const tokensW = (steps: GoalStep[]) => Math.max(0, ...steps.map(s => cells(tokensText(s.tokens))))

/**
 * The body columns the pane asks for: wide enough for the step tables with their
 * notes and tokens, never past the terminal less the transcript's share.
 */
function paneColumns(p: GoalProgress | null): number | undefined {
  if (!p || termCols <= 0) return undefined
  const want = Math.max(
    0,
    ...p.tasks.map(t => {
      const sidW = Math.min(10, Math.max(0, ...t.steps.map(s => cells(s.id))))
      const noteW = Math.max(0, ...t.steps.map(s => cells(s.status === 'shown' ? 'needs your Approve' : (s.note ?? ''))))
      const tokW = tokensW(t.steps)

      return 6 + 2 + LABEL_W + 1 + sidW + 1 + TITLE_MIN + (noteW ? noteW + 2 : 0) + (tokW ? tokW + 2 : 0)
    }),
  )
  const cap = Math.max(20, termCols - TRANSCRIPT_MIN)

  return want > 0 ? Math.min(want, cap) : undefined
}

const openPane = async ($: EngineInterface) => {
  await reload($)
  const columns = paneColumns(await read($, progress))

  return $.ui.open({ id: PANE, title: PANE_TITLE, closeOnEscape: true, ...(columns ? { columns } : {}) })
}

const cells = (text: string) => Array.from(text).length

type Look = { glyph: string; color?: string; dim?: boolean; bold?: boolean }

const LOOK: Record<TaskStatus, Look> = {
  done: { glyph: '✓', color: 'green' },
  deployed: { glyph: '✔', color: 'magenta' },
  shown: { glyph: '◆', color: 'yellow' },
  doing: { glyph: '●', color: 'cyan', bold: true },
  blocked: { glyph: '✕', color: 'red' },
  waiting: { glyph: '◷', color: 'yellow' },
  skipped: { glyph: '–', dim: true },
  todo: { glyph: '○', dim: true },
}

const MARK: Record<TaskStatus, string> = {
  done: '[x]',
  deployed: '[D]',
  shown: '[s]',
  doing: '[>]',
  waiting: '[w]',
  blocked: '[!]',
  skipped: '[-]',
  todo: '[ ]',
}


const tokensLine = (n: number | undefined) => (n === undefined ? '' : ` · ${shortTokens(n)} tokens`)

/** The text list `/goal-progress` answers with. */
function listText(p: GoalProgress): string {
  const { done, total } = counts(p)

  return [
    `${p.goal}: ${done}/${total} done, ${p.status}${p.note ? ` (${p.note})` : ''}`,
    ...(p.plan ? [`Plan: ${p.plan}`] : []),
    ...(p.running.length > 0
      ? ['Running now:', ...p.running.map(j => `  ${j.kind}: ${j.title}${engineLabel(j.engine)}${j.note ? `, ${j.note}` : ''}`)]
      : []),
    ...p.tasks.flatMap(t => [
      `${MARK[t.status]} ${t.id} ${t.title}${t.note ? ` (${t.note})` : ''}${tokensLine(t.tokens)}`,
      ...t.steps.map(s => `    ${MARK[s.status]} ${s.id} ${s.title}${engineLabel(s.engine)}${s.note ? ` (${s.note})` : ''}${tokensLine(s.tokens)}`),
    ]),
  ].join('\n')
}

type Seg = { text: string; color?: string; dim?: boolean }

/** An engine label's tone: dim blue on Fireworks, dim grey on Claude. */
const engineTone = (engine: string | undefined) => (onFireworks(engine) ? { color: 'blue', dimColor: true } : { dimColor: true })

const width = (segs: Seg[]) => segs.reduce((n, s) => n + Array.from(s.text).length + 2, 0)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goal-progress',
      description: 'List the goal tasks from .claude/goal-progress.json (args: open | hide | show)',
    })
    await refresh($)
    $.clock.every(POLL_MS, () => refresh($))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  // A row the conversation keeps (a tool result, a notice, an agent's report):
  // the goal writes the file through a tool, so read it as soon as the result is in.
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    return result
  }).catch(($, e, next) => next(e))

  // Someone opens this session from another app: draw what the file says now.
  on('session.attach', async ($, e, next) => {
    const result = await next(e)
    await reload($)

    return result
  })

  on('command.run', { command: 'goal-progress' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')

      return { text: `Goal progress band ${arg === 'hide' ? 'hidden' : 'shown'}.` }
    }
    if (arg === 'open') {
      await openPane($)

      return { text: 'Goal tasks pane opened.' }
    }
    await reload($)
    const p = await read($, progress)
    if (!p) return { text: `No goal progress yet: ${FILE} is missing or not valid JSON.` }

    return { text: listText(p) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    if (!p || e.props.hasSurvey || (await read($, isHidden))) return next(e)
    await read($, tick)

    const { Box, Button, Text } = $.ui.resolve(e)
    if (e.viewport) termCols = e.viewport.columns
    const { done, total } = counts(p)
    const pct = total === 0 ? 0 : Math.round((done / total) * 100)
    const clock = await $.clock.now()
    const stale = isStale(p, clock)
    const colour = p.status === 'blocked' ? 'red' : p.status === 'waiting' ? 'yellow' : p.status === 'done' ? 'green' : 'cyan'
    // One line: the bar and percentage, what runs right now, and the Tasks button.
    const jobs = runningLines(p, clock)
    const now = current(p)
    const job = jobs[0]
    const what = job
      ? `${job.kind} ${job.text}${job.time ? ` · ${job.time}` : ''}${jobs.length > 1 ? ` (+${jobs.length - 1} more)` : ''}`
      : p.status === 'done'
        ? 'All tasks done'
        : now
          ? `${now.id} ${now.title}`
          : p.status
    const head = `${bar(done, total, BAND_BAR)} ${pct}% `
    const warn = stale ? ` · updated ${ago(p.updated, clock)}` : ''
    const room = (termCols > 0 ? termCols : 100) - cells(head) - cells(warn) - BUTTON_W - 2

    return (
      <Box>
        <Text color={colour}>{head}</Text>
        <Text color={job ? kindColor(job.kind) : undefined}>{fit(what, Math.max(8, room))}</Text>
        {warn && <Text color="yellow">{warn}</Text>}
        <Text> </Text>
        <Button key="tasks" label="Tasks ▸" onPress={() => openPane($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    if (e.viewport) termCols = e.viewport.columns
    const W = Math.max(20, e.props.bodyColumns)
    const p = await read($, progress)
    if (!p) return <Text dimColor>{fit(`No goal progress yet: ${FILE} is missing.`, W)}</Text>
    await read($, tick)

    const now = current(p)
    const nowAt = now ? p.tasks.indexOf(now) : p.tasks.length
    const idW = Math.min(12, Math.max(0, ...p.tasks.map(t => Array.from(t.id).length)))
    const prefix = 2 + idW + 1
    const clock = await $.clock.now()
    const when = ago(p.updated, clock)
    const stale = isStale(p, clock)
    const footer = [p.plan ? `Plan: ${p.plan}` : undefined, when ? `updated ${when}${stale ? ', may be behind' : ''}` : undefined, 'esc close']
      .filter(Boolean)
      .join(' · ')

    const jobs = runningLines(p, clock)
    const kindW = Math.min(8, Math.max(0, ...jobs.map(j => Array.from(j.kind).length)))
    const jobInner = W - 4 - 2 - kindW - 1
    const running = jobs.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} marginTop={1} width={W}>
        <Text bold color="magenta">
          Running now ({jobs.length})
        </Text>
        {jobs.map((j, i) => {
          const time = j.time ?? ''
          const text = fit(j.text, Math.max(8, jobInner - (time ? time.length + 2 : 0)))
          const pad = Math.max(0, jobInner - Array.from(text).length - time.length)
          const lab = engineLabel(j.engine)
          const at = lab ? text.indexOf(lab) : -1

          return (
            <Box key={`job-${i}`}>
              <Text color={kindColor(j.kind)}>▸ {fit(j.kind, kindW).padEnd(kindW)} </Text>
              <Text>{at >= 0 ? text.slice(0, at) : text}</Text>
              {at >= 0 ? <Text {...engineTone(j.engine)}>{lab}</Text> : null}
              {at >= 0 ? <Text>{text.slice(at + lab.length)}</Text> : null}
              <Text dimColor>
                {' '.repeat(pad)}
                {time}
              </Text>
            </Box>
          )
        })}
      </Box>
    )

    const openMap = await read($, opened)
    const withSteps = p.tasks.filter(t => t.steps.length > 0)
    const allOpen = withSteps.length > 0 && withSteps.every(t => isOpen(t, now, openMap))
    const labelW = LABEL_W

    /** Inside a step card: W - 2 for the rail, 2 for the border, 2 for the padding. */
    const inner = W - 6
    const stepRow = (s: GoalStep, sidW: number, tokW: number, k: string) => {
      const look = LOOK[s.status]
      const note = s.status === 'shown' ? 'needs your Approve' : (s.note ?? '')
      const room = inner - 2 - labelW - 1 - sidW - 1 - (tokW ? tokW + 2 : 0)
      const keep = note && room - cells(note) - 2 >= 10 ? note : ''
      const lab = engineLabel(s.engine)
      const title = fit(s.title, room - cells(lab) - (keep ? cells(keep) + 2 : 0))
      const pad = Math.max(0, room - cells(title) - cells(lab) - (keep ? cells(keep) + 2 : 0))
      const tone = s.status === 'doing' ? { color: 'cyan', bold: true } : look.dim ? { dimColor: true } : {}
      const noteTone = s.status === 'shown' ? { color: 'yellow' } : s.status === 'doing' ? { color: 'cyan' } : s.status === 'blocked' ? { color: 'red' } : { dimColor: true }

      return (
        <Box key={k}>
          <Text color={look.color} dimColor={look.dim} bold={look.bold}>
            {look.glyph}{' '}
          </Text>
          <Text color={look.color ?? 'gray'} dimColor={look.dim}>
            {STATUS_LABEL[s.status].padEnd(labelW)}{' '}
          </Text>
          <Text {...tone}>
            {fit(s.id, sidW).padEnd(sidW)} {title}
          </Text>
          {lab ? <Text {...engineTone(s.engine)}>{lab}</Text> : null}
          {keep ? (
            <Text {...noteTone}>
              {' '.repeat(pad)}
              {'  '}
              {keep}
            </Text>
          ) : tokW ? (
            <Text>{' '.repeat(pad)}</Text>
          ) : null}
          {tokW ? (
            <Text dimColor>
              {'  '}
              {tokensText(s.tokens).padStart(tokW)}
            </Text>
          ) : null}
        </Box>
      )
    }

    const rows = p.tasks.flatMap((t, i) => {
      const look = LOOK[t.status]
      const isNow = t === now
      const hasSteps = t.steps.length > 0
      const open = hasSteps && isOpen(t, now, openMap)
      const sc = hasSteps ? counts({ tasks: t.steps }) : undefined
      let right: Seg[] = [
        ...(t.note ? [{ text: t.note, dim: true }] : []),
        ...(t.status === 'shown' ? [{ text: 'needs your Approve', color: 'yellow' }] : []),
        ...(sc ? [isNow ? { text: `${bar(sc.done, sc.total, 8)} ${sc.done}/${sc.total}`, color: 'cyan' } : { text: `${sc.done}/${sc.total}`, dim: true }] : []),
        ...(hasSteps ? [{ text: open ? '▾' : '▸', color: 'cyan' }] : []),
        ...(t.tokens !== undefined ? [{ text: shortTokens(t.tokens), dim: true }] : []),
      ]
      while (right.length > 0 && W - prefix - width(right) < 12) right = right.slice(1)
      const title = fit(t.title, W - prefix - width(right))
      const pad = Math.max(0, W - prefix - cells(title) - width(right))
      const tone = isNow ? { color: 'cyan', bold: true } : look.dim ? { dimColor: true } : {}
      const parts = [
        <Text color={look.color} dimColor={look.dim} bold={look.bold}>
          {look.glyph}{' '}
        </Text>,
        <Text {...tone}>
          {fit(t.id, idW).padEnd(idW)} {title}
        </Text>,
        <Text>{' '.repeat(pad)}</Text>,
        ...right.map(s => (
          <Text color={s.color} dimColor={s.dim}>
            {'  '}
            {s.text}
          </Text>
        )),
      ]
      const out = [
        hasSteps ? (
          <Box key={`task-${i}`}>
            <Button key={`task-${t.id}`} label={`${open ? 'Close' : 'Open'} ${t.id}`} plain onPress={() => update($, opened, m => ({ ...m, [t.id]: !open }))}>
              {parts}
            </Button>
          </Box>
        ) : (
          <Box key={`task-${i}`}>{parts}</Box>
        ),
      ]
      if (open) {
        const sidW = Math.min(10, Math.max(0, ...t.steps.map(s => cells(s.id))))
        const tokW = tokensW(t.steps)
        const lines = orderedSteps(t).map((s, j) => stepRow(s, sidW, tokW, `step-${i}-${j}`))
        out.push(
          <Box key={`card-${i}`}>
            <Text dimColor>│ </Text>
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={W - 2}>
              {lines}
            </Box>
          </Box>,
        )
      }
      if (i < p.tasks.length - 1) {
        out.push(
          i + 1 <= nowAt ? (
            <Text key={`link-${i}`} color="green">
              │
            </Text>
          ) : (
            <Text key={`link-${i}`} dimColor>
              │
            </Text>
          ),
        )
      }

      return out
    })

    const latest = p.log.slice(-LOG_LINES).reverse()
    const news = latest.length > 0 && (
      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} marginTop={1} width={W}>
        <Text bold color="blue">
          Latest
        </Text>
        {latest.map((l, i) => {
          const when = ago(l.at, clock)

          return (
            <Box key={`log-${i}`}>
              <Text color="blue">• </Text>
              <Box width={W - 6} flexDirection="column">
                <Text>
                  {l.text}
                  {when ? <Text dimColor> · {when}</Text> : null}
                </Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )

    const controls = withSteps.length > 0 && (
      <Box marginTop={1}>
        <Button
          key="open-all"
          label={allOpen ? 'close all' : 'open all'}
          plain
          hotkey="a"
          onPress={() => update($, opened, () => Object.fromEntries(withSteps.map(t => [t.id, !allOpen])))}
        />
        <Text dimColor>{fit('  ·  click a task to open it · arrows scroll', Math.max(0, W - 14))}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>{fit(p.goal, W)}</Text>
        {running}
        {news}
        <Box flexDirection="column" marginTop={1}>
          {rows}
        </Box>
        {controls}
        <Box marginTop={1}>
          <Text dimColor={!stale} color={stale ? 'yellow' : undefined}>
            {fit(footer, W)}
          </Text>
        </Box>
      </Box>
    )
  })
}
