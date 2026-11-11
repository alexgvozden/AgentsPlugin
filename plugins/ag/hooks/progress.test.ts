import { expect, test } from 'claude-code/testing'

import type { Agent, PlanMark } from './progress'
import { agentJobs, bar, counts, current, currentStory, fit, isOpen, keepLastGood, keepLastMarks, layoutRow, mergeAgents, mergePlan, needsYouItems, orderedSteps, padCells, parsePlanMarks, parseProgress, refreshProgress, runningLines, shortTokens, statusLine, statusWord, stepSummary, storyTally, textWidth } from './progress'

const FILE_TEXT = JSON.stringify({
  goal: 'A1 track 1',
  plan: '.planning/golive/A1-cv-reviews.md',
  status: 'running',
  note: 'e2e on iPhone 15',
  tasks: [
    { id: 'A1.1', title: 'Rules schema', status: 'done' },
    { id: 'A1.2', title: 'MarkedDocument', status: 'done' },
    { id: 'A1.3', title: 'Offer review v2', status: 'doing' },
    { id: 'A1.4', title: 'CV review v2', status: 'todo' },
    { id: 'X', title: 'Dropped', status: 'skipped' },
  ],
})

test('parses the file and counts done tasks, leaving skipped ones out of the total', () => {
  const p = parseProgress(FILE_TEXT)
  expect(p).not.toBeNull()
  expect(counts(p!)).toEqual({ done: 2, total: 4 })
  expect(current(p!)?.id).toBe('A1.3')
})

test('draws the bar and the status line', () => {
  expect(bar(2, 4, 10)).toBe('█████░░░░░')
  expect(bar(0, 0, 4)).toBe('░░░░')
  expect(statusLine(parseProgress(FILE_TEXT)!)).toBe('Goal █████░░░░░ 2/4 · A1.3 Offer review v2 · running')
})

test('rejects text that is not a progress file', () => {
  expect(parseProgress('not json')).toBeNull()
  expect(parseProgress('{"goal":"x"}')).toBeNull()
})

test('keeps the waiting status for a gate', () => {
  const p = parseProgress('{"goal":"g","status":"waiting","note":"review the mockups","tasks":[{"id":"G1·A1.0","title":"Mockups","status":"done"}]}')
  expect(p?.status).toBe('waiting')
  expect(statusLine(p!)).toBe('Goal ██████████ 1/1 · waiting: review the mockups')
})

test('at a gate, the bar names the last shown task, not the next todo', () => {
  const p = parseProgress(JSON.stringify({
    goal: 'g',
    status: 'waiting',
    note: 'sign off Phase 2',
    tasks: [
      { id: 'P1', title: 'Phase 1', status: 'done' },
      { id: 'P2', title: 'Phase 2', status: 'shown' },
      { id: 'P2.9', title: 'Phase 2 polish', status: 'shown' },
      { id: 'P3', title: 'Phase 3', status: 'todo' },
    ],
  }))!
  expect(p.status).toBe('waiting')
  expect(current(p)?.id).toBe('P2.9')
  expect(statusLine(p)).toBe('Goal ████████░░ 3/4 · P2.9 Phase 2 polish · waiting: sign off Phase 2')
})

test('unknown task statuses count as todo', () => {
  const p = parseProgress('{"goal":"g","tasks":[{"id":"1","title":"a","status":"weird"}]}')
  expect(p?.tasks[0]?.status).toBe('todo')
  expect(p?.status).toBe('running')
})

const S3_TEXT = JSON.stringify({
  goal: 'Integrate',
  tasks: [
    { id: 'S1', title: 'Online again', status: 'shown', note: '0.7.4 · Oct 18' },
    { id: 'S2', title: 'People', status: 'shown' },
    {
      id: 'S3',
      title: 'Ads, measurement and Google',
      status: 'doing',
      steps: [
        { id: 'E9.15', title: 'Exchange rate from defaults', status: 'done', note: '0.9.0' },
        { id: 'E9.16', title: 'Google sign-in for Ads', status: 'doing' },
        { id: 'I3.3', title: 'Results page', status: 'waiting', note: 'lands after I3.1' },
        { id: 'I3.2', title: 'Your site', status: 'todo' },
        { id: 'E2.10', title: 'Goals', status: 'todo' },
        { id: 'I3.1', title: 'Measurement', status: 'todo' },
        { id: 'E9.13', title: 'Ads limits', status: 'todo' },
        { id: 'close', title: 'S3 close', status: 'todo' },
      ],
    },
    { id: 'S4', title: 'Content', status: 'todo', steps: 'not a list' },
  ],
})

test('parses steps, notes and the shown status, which counts as done', () => {
  const p = parseProgress(S3_TEXT)!
  expect(counts(p)).toEqual({ done: 2, total: 4 })
  expect(p.tasks[0]?.note).toBe('0.7.4 · Oct 18')
  expect(p.tasks[2]?.steps.length).toBe(8)
  expect(p.tasks[3]?.steps).toEqual([])
  expect(current(p)?.id).toBe('S3')
})

test('sums up the steps of the current task', () => {
  const s = stepSummary(current(parseProgress(S3_TEXT)!)!)
  expect([s.done, s.total]).toEqual([1, 8])
  expect(s.lines).toEqual([
    { label: 'done', text: 'E9.15 Exchange rate from defaults (0.9.0)' },
    { label: 'now', text: 'E9.16 Google sign-in for Ads' },
    { label: 'waiting', text: 'I3.3 Results page, lands after I3.1' },
    { label: 'next', text: 'I3.2 Your site', rest: ', then E2.10, I3.1, E9.13, close' },
  ])
})

test('reads what is running now, with how long each has run', () => {
  const p = parseProgress(
    JSON.stringify({
      goal: 'g',
      tasks: [{ id: 'S3', title: 'Ads', status: 'doing' }],
      running: [
        { kind: 'deploy', title: 'Release 0.9.4', since: '2026-10-19T09:00:00Z' },
        { kind: 'tests', title: 'Integration suite', note: 'for 0.9.3', since: '2026-10-19T07:55:00Z' },
        { title: 'E2.10, E9.13 part 1' },
        { kind: 'build' },
      ],
    }),
  )!
  expect(p.running.length).toBe(3)
  expect(runningLines(p, Date.parse('2026-10-19T09:04:10Z'))).toEqual([
    { kind: 'deploy', text: 'Release 0.9.4', time: '4m' },
    { kind: 'tests', text: 'Integration suite, for 0.9.3', time: '1h 09m' },
    { kind: 'other', text: 'E2.10, E9.13 part 1', time: undefined },
  ])
  expect(statusLine(p)).toBe('Goal ░░░░░░░░░░ 0/1 · S3 Ads · running · 3 running')
  expect(parseProgress('{"goal":"g","tasks":[]}')?.running).toEqual([])
})

test('reads an engine on running jobs and steps and shows it beside the title', () => {
  const p = parseProgress(
    JSON.stringify({
      goal: 'g',
      tasks: [{ id: 'S3', title: 'Ads', status: 'doing', steps: [
        { id: 'a', title: 'A', status: 'done', engine: '  opus-high ' },
        { id: 'b', title: 'B', status: 'doing', engine: 'fw:glm-5p3-flash' },
        { id: 'c', title: 'C', status: 'todo', engine: '   ' },
        { id: 'd', title: 'D', status: 'todo', engine: 7 },
      ] }],
      running: [
        { kind: 'build', title: 'S3 Wire search API', engine: 'fw:glm-5p3-flash', since: '2026-10-19T09:00:00Z' },
        { kind: 'review', title: 'Batch 2', engine: ' sonnet ', note: 'phase 1' },
        { kind: 'deploy', title: 'Release 0.9.4', engine: '' },
      ],
    }),
  )!
  expect(p.tasks[0].steps.map(s => s.engine)).toEqual(['opus-high', 'fw:glm-5p3-flash', undefined, undefined])
  expect(p.running.map(j => j.engine)).toEqual(['fw:glm-5p3-flash', 'sonnet', undefined])
  expect(runningLines(p, Date.parse('2026-10-19T09:04:10Z'))).toEqual([
    { kind: 'build', text: 'S3 Wire search API [fw:glm-5p3-flash]', time: '4m', engine: 'fw:glm-5p3-flash' },
    { kind: 'review', text: 'Batch 2 [sonnet], phase 1', time: undefined, engine: 'sonnet' },
    { kind: 'deploy', text: 'Release 0.9.4', time: undefined },
  ])
  expect(Object.keys(runningLines(p, 0)[2])).not.toContain('engine')
  expect(stepSummary(p.tasks[0]).lines).toEqual([
    { label: 'done', text: 'a A [opus-high]' },
    { label: 'now', text: 'b B [fw:glm-5p3-flash]' },
    { label: 'next', text: 'c C', rest: ', then d' },
  ])
})

test('keeps all the steps in plan and file order, whatever their status', () => {
  const p = parseProgress(JSON.stringify({
    goal: 'g',
    tasks: [{ id: 'S3', title: 'Ads', status: 'doing', steps: [
      { id: 'a', title: 'A', status: 'done' },
      { id: 'g', title: 'G', status: 'deployed' },
      { id: 'b', title: 'B', status: 'todo' },
      { id: 'c', title: 'C', status: 'doing' },
      { id: 'd', title: 'D', status: 'shown' },
      { id: 'e', title: 'E', status: 'waiting' },
      { id: 'f', title: 'F', status: 'doing' },
    ] }, { id: 'S4', title: 'Next', status: 'todo' }],
  }))!
  expect(orderedSteps(p.tasks[0]!).map(s => s.id)).toEqual(['a', 'g', 'b', 'c', 'd', 'e', 'f'])
  expect(counts({ tasks: p.tasks[0]!.steps })).toEqual({ done: 3, total: 7 })
  expect(isOpen(p.tasks[0]!, current(p), {})).toBe(true)
  expect(isOpen(p.tasks[1]!, current(p), {})).toBe(false)
  expect(isOpen(p.tasks[0]!, current(p), { S3: false })).toBe(false)
})

test('keeps the last good text when a read comes back empty or not a progress file', () => {
  const NEWER = JSON.stringify({ goal: 'newer', tasks: [{ id: 'B', title: 'B', status: 'todo' }] })
  expect(keepLastGood(FILE_TEXT, '')).toBe(FILE_TEXT) // first good read wins
  expect(keepLastGood('', FILE_TEXT)).toBe(FILE_TEXT) // empty read keeps it
  expect(keepLastGood('{"goal":"g","tasks":[', FILE_TEXT)).toBe(FILE_TEXT) // half-written keeps it
  expect(keepLastGood(NEWER, FILE_TEXT)).toBe(NEWER) // a newer good read replaces it
  expect(keepLastGood('', '')).toBe('') // nothing good ever read stays missing
  expect(keepLastGood('{"goal":"x"}', '')).toBe('') // nor does a file without tasks
})

test('reads the log as strings or { text, at }, dropping empty lines', () => {
  const p = parseProgress(JSON.stringify({
    goal: 'g', tasks: [],
    log: ['Release 0.9.6 is deploying', { text: 'S3 review running', at: '2026-10-19T09:30:00Z' }, '  ', { at: 'x' }],
  }))!
  expect(p.log).toEqual([{ text: 'Release 0.9.6 is deploying' }, { text: 'S3 review running', at: '2026-10-19T09:30:00Z' }])
})

test('reads tokens, sums a task from its steps, drops bad values, and writes them short', () => {
  const p = parseProgress(JSON.stringify({
    goal: 'g',
    tasks: [
      { id: 'S1', title: 'Own', status: 'done', tokens: 1_200_000, steps: [{ id: 'a', title: 'A', status: 'done', tokens: 5 }] },
      { id: 'S2', title: 'Sum', status: 'doing', steps: [
        { id: 'a', title: 'A', status: 'done', tokens: 9_500 },
        { id: 'b', title: 'B', status: 'done', tokens: 2_500 },
        { id: 'c', title: 'C', status: 'todo', tokens: -3 },
        { id: 'd', title: 'D', status: 'todo', tokens: '400' },
      ] },
      { id: 'S3', title: 'None', status: 'todo', tokens: 'lots', steps: [{ id: 'a', title: 'A', status: 'todo' }] },
    ],
  }))!
  expect(p.tasks.map(t => t.tokens)).toEqual([1_200_000, 12_000, undefined])
  expect(p.tasks[1]!.steps.map(s => s.tokens)).toEqual([9_500, 2_500, undefined, undefined])
  expect([850, 9_500, 12_000, 240_000, 1_200_000].map(shortTokens)).toEqual(['850', '9.5k', '12k', '240k', '1.2M'])
})

const TABLE_PLAN = [
  '| ID | Step | Engine | After | Status |',
  '|---|---|---|---|---|',
  '| **P1** | **Phase 1: Design directions** | | | done 2026-11-07 |',
  '| 1.1 | Design directions | Opus high | | done 2026-11-07 |',
  '| 1.2 | Data coverage | Opus medium | 1.1 | doing |',
  '| **P2** | **Phase 2: Screens** | | | todo |',
  '| 2.1 | All screens | Opus high | P1 | todo |',
].join('\n')

test('reads the marks of a tracker table: a bold id is a phase, the last column is the status', () => {
  expect(parsePlanMarks(TABLE_PLAN)).toEqual([
    { id: 'P1', title: 'Design directions', status: 'done' },
    { id: '1.1', title: 'Design directions', status: 'done', phase: 'P1', parent: 'P1' },
    { id: '1.2', title: 'Data coverage', status: 'doing', phase: 'P1', parent: 'P1' },
    { id: 'P2', title: 'Screens', status: 'todo' },
    { id: '2.1', title: 'All screens', status: 'todo', phase: 'P2', parent: 'P2' },
  ])
})

const LINE_PLAN = [
  '## Phase 4: the progress band follows the work by itself',
  'Status: todo',
  '',
  '### S14. The band reads the plan and the session\'s subagents',
  'Status: done 2026-11-07',
  '',
  '### S15. The launcher registers its own job',
  'Status: blocked: no API for it',
  '',
  '## How this plan is run',
  '1. A step sets its own mark in its own commit.',
].join('\n')

test('reads the marks of Status: lines under phase and step headings', () => {
  expect(parsePlanMarks(LINE_PLAN)).toEqual([
    { id: 'P4', title: 'the progress band follows the work by itself', status: 'todo' },
    { id: 'S14', title: "The band reads the plan and the session's subagents", status: 'done', phase: 'P4', parent: 'P4' },
    { id: 'S15', title: 'The launcher registers its own job', status: 'blocked', phase: 'P4', parent: 'P4', note: 'no API for it' },
  ])
})

test("the plan's marks win, its new steps are added, and a phase with started steps reads doing", () => {
  const file = parseProgress(JSON.stringify({
    goal: 'g',
    plan: 'PLAN.md',
    tasks: [
      { id: 'P1', title: 'Phase 1 (file)', status: 'doing', steps: [
        { id: '1.1', title: 'Design (file)', status: 'doing', note: 'in flight', engine: 'opus-high', tokens: 500 },
        { id: '1.2', title: 'Coverage', status: 'todo' },
      ] },
      { id: 'P2', title: 'Phase 2 (file)', status: 'todo', steps: [{ id: '2.1', title: 'Screens', status: 'todo' }] },
      { id: 'P3', title: 'Phase 3 (file)', status: 'todo', steps: [{ id: '3.1', title: 'Live data', status: 'todo' }] },
    ],
    running: [{ kind: 'build', title: 'Wire search' }],
    log: ['Release 0.9.6 is deploying'],
  }))!
  const merged = mergePlan(file, [
    { id: 'P1', title: 'Phase 1: Design directions', status: 'done' },
    { id: '1.1', title: 'Design directions', status: 'done', phase: 'P1' },
    { id: '1.3', title: 'Validation kit', status: 'doing', phase: 'P1' },
    { id: 'P2', title: 'Phase 2: Screens', status: 'todo' },
    { id: '2.2', title: 'Design system', status: 'doing', phase: 'P2' },
    { id: '3.1', title: 'Live data', status: 'done', phase: 'P3' },
  ])
  // P2's plan `todo` is no mark of its own, so its started step (2.2) makes it read doing
  expect(merged.tasks.map(t => [t.id, t.status])).toEqual([['P1', 'done'], ['P2', 'doing'], ['P3', 'doing']])
  expect(merged.tasks[0]!.title).toBe('Phase 1: Design directions') // the plan's title wins
  expect(merged.tasks[2]!.title).toBe('Phase 3 (file)') // else the file's
  // plan order first, then the file's own steps
  expect(merged.tasks[0]!.steps.map(s => [s.id, s.status])).toEqual([['1.1', 'done'], ['1.3', 'doing'], ['1.2', 'todo']])
  expect(merged.tasks[0]!.steps[0]).toEqual({ id: '1.1', title: 'Design directions', status: 'done', note: 'in flight', engine: 'opus-high', tokens: 500 })
  expect(merged.tasks[0]!.steps[1]!.title).toBe('Validation kit')
  expect(merged.tasks[1]!.steps.map(s => s.id)).toEqual(['2.2', '2.1']) // the plan's step, then the file's own
  expect(merged.running).toEqual(file.running)
  expect(merged.log).toEqual(file.log)
  expect(file.tasks[0]!.status).toBe('doing') // the file's own progress is not changed
  expect(mergePlan(file, []).tasks).toEqual(file.tasks) // no marks: nothing moves
})

test("a plan todo on a phase does not hide the steps that started", () => {
  const file = (status: string) => parseProgress(JSON.stringify({
    goal: 'g',
    tasks: [{ id: 'P4', title: 'Phase 4 (file)', status, steps: [{ id: 'S14', title: 'The band', status: 'todo' }] }],
  }))!
  const marks: PlanMark[] = [
    { id: 'P4', title: 'Phase 4: the band', status: 'todo' },
    { id: 'S14', title: 'The band', status: 'done', phase: 'P4' },
  ]
  expect(mergePlan(file('doing'), marks).tasks[0]!.status).toBe('doing') // the file's own doing is not lost
  expect(mergePlan(file('todo'), marks).tasks[0]!.status).toBe('doing') // and a done step makes it doing anyway
  expect(mergePlan(file('todo'), [{ id: 'P4', title: 'Phase 4: the band', status: 'todo' }]).tasks[0]!.status).toBe('todo') // nothing started: todo stands
})

test("a plan todo on a step does not downgrade the file's doing, waiting or blocked", () => {
  const file = parseProgress(JSON.stringify({
    goal: 'g',
    tasks: [{ id: 'P4', title: 'Phase 4', status: 'doing', steps: [
      { id: 'S16', title: 'The next step', status: 'doing', note: 'in flight' },
      { id: 'S17', title: 'Waiting on the key', status: 'waiting' },
      { id: 'S18', title: 'Blocked one', status: 'blocked' },
    ] }],
  }))!
  const merged = mergePlan(file, [
    { id: 'S16', title: 'The next step', status: 'todo', phase: 'P4' },
    { id: 'S17', title: 'Waiting on the key', status: 'todo', phase: 'P4' },
    { id: 'S18', title: 'Blocked one', status: 'todo', phase: 'P4' },
  ])
  expect(merged.tasks[0]!.steps.map(s => [s.id, s.status])).toEqual([['S16', 'doing'], ['S17', 'waiting'], ['S18', 'blocked']])
  expect(merged.tasks[0]!.steps[0]!.note).toBe('in flight')
})

test("a waiting subagent joins the running lines, an idle one does not", () => {
  const p = parseProgress(JSON.stringify({ goal: 'g', tasks: [], running: [] }))!
  const agents = [
    { id: 'a1', description: 'Waiting on its job', type: 'builder', status: 'waiting' },
    { id: 'a2', description: 'Idle one', type: 'builder', status: 'idle' },
  ] as unknown as Agent[]
  expect(agentJobs(agents)).toEqual([{ kind: 'agent', title: 'Waiting on its job' }])
  expect(mergeAgents(p, agents).running.map(j => j.title)).toEqual(['Waiting on its job'])
})

test('an empty or half-written plan keeps the last good marks', () => {
  const good = parsePlanMarks(LINE_PLAN)
  expect(good.length).toBe(3)
  expect(keepLastMarks(LINE_PLAN, [])).toEqual(good)
  expect(keepLastMarks('', good)).toEqual(good) // an empty read keeps them
  expect(keepLastMarks('# Notes\n\nno marks in here at all\n', good)).toEqual(good)
  expect(keepLastMarks('| ID | Step | Engine | After | Status |\n|---|---|---|---|---|\n', good)).toEqual(good) // header only
  expect(keepLastMarks('', [])).toEqual([])
  expect(keepLastMarks('### S16. The next step\nStatus: todo', good)).toEqual([{ id: 'S16', title: 'The next step', status: 'todo' }])
})

test("the session's pending and running subagents join the running lines", () => {
  const p = parseProgress(JSON.stringify({
    goal: 'g',
    tasks: [{ id: 'S14', title: 'The band', status: 'doing' }],
    running: [{ kind: 'tests', title: 'Suite', since: '2026-11-07T09:00:00Z' }],
  }))!
  const agents = [
    { id: 'a1', description: 'S14 progress plan reader', type: 'builder', status: 'running', model: 'fw:deepseek-v4p1-flash' },
    { id: 'a2', description: 'S15 launcher', type: 'builder', status: 'pending' },
    { id: 'a3', description: 'Done one', type: 'builder', status: 'completed' },
    { id: 'a4', description: '  ', type: 'reviewer', status: 'running' },
    { id: 'a5', type: 'builder', status: 'RUNNING' },
    { id: 'a6', description: 'No status' },
    'not an agent',
  ] as unknown as Agent[]
  expect(agentJobs(agents)).toEqual([
    { kind: 'agent', title: 'S14 progress plan reader', engine: 'fw:deepseek-v4p1-flash' },
    { kind: 'agent', title: 'S15 launcher' },
    { kind: 'agent', title: 'reviewer' },
    { kind: 'agent', title: 'builder' },
  ])
  const merged = mergeAgents(p, agents)
  expect(merged.running.length).toBe(5)
  expect(runningLines(merged, Date.parse('2026-11-07T09:04:10Z')).map(j => j.text)).toEqual([
    'Suite',
    'S14 progress plan reader [fw:deepseek-v4p1-flash]',
    'S15 launcher',
    'reviewer',
    'builder',
  ])
  expect(merged.running[0]).toEqual(p.running[0]) // the file's own jobs come first
  expect(mergeAgents(p, [])).toBe(p) // nothing live: the progress is left as it is
})

test('status words: synonyms, markup, reasons that ask for you, unknown words', () => {
  expect(['running', 'In progress', 'WIP', '**doing**'].map(w => statusWord(w))).toEqual(['doing', 'doing', 'doing', 'doing'])
  expect(['built 2026-11-09', 'merged', 'Approved', 'complete'].map(w => statusWord(w))).toEqual(['done', 'done', 'done', 'done'])
  expect(['released', 'live', 'shipped'].map(w => statusWord(w))).toEqual(['deployed', 'deployed', 'deployed'])
  expect(['needs you', 'waiting for you', 'your turn'].map(w => statusWord(w))).toEqual(['needs-you', 'needs-you', 'needs-you'])
  expect(statusWord('waiting', 'on the vendor')).toBe('waiting')
  expect(statusWord('waiting', 'your API key')).toBe('needs-you')
  expect(statusWord('blocked', 'needs sign-off')).toBe('needs-you')
  expect(['on hold', 'failed', 'cancelled', 'not started'].map(w => statusWord(w))).toEqual(['waiting', 'blocked', 'skipped', 'todo'])
  expect(statusWord('whatever')).toBeUndefined()
  const p = parseProgress('{"goal":"g","tasks":[{"id":"1","title":"a","status":"running"},{"id":"2","title":"b","status":"waiting","note":"your Stripe key"}]}')!
  expect(p.tasks.map(t => t.status)).toEqual(['doing', 'needs-you'])
  expect(counts(p)).toEqual({ done: 0, total: 2 }) // needs-you is not finished
})

// marketing shape: letter ids with a colon, epics at ###, stories at ####
const UX_PLAN = [
  '## 4. Steps',
  '### UXR: Research',
  'Status: done Nov 9, 2026',
  '#### UXR1: Interviews',
  'Status: done',
  '### UXB: The DLS, built',
  'Status: doing',
  '#### UXB1: tokens and type',
  'Status: done Nov 11, 2026',
  '#### UXB2: the components',
  '- Owner: builder',
  '- **Status:** in progress, sweep fixes',
  '## What exists',
  'Status: nonsense that must not attach',
].join('\n')

test('reads letter-id headings with a colon, nested by heading depth', () => {
  expect(parsePlanMarks(UX_PLAN).map(m => [m.id, m.status, m.title, m.parent])).toEqual([
    ['UXR', 'done', 'Research', undefined],
    ['UXR1', 'done', 'Interviews', 'UXR'],
    ['UXB', 'doing', 'The DLS, built', undefined],
    ['UXB1', 'done', 'tokens and type', 'UXB'],
    ['UXB2', 'doing', 'the components', 'UXB'],
  ])
})

// findajob shape: Phase headings, stories without a dot, bullet status lines, a fix story
const PHASE_PLAN = [
  '## Phase 3: Preferences',
  'Status: doing',
  '### 3.2 Email settings page',
  '- **Status:** done 11 November 2026',
  '### fix 1 The free CV link',
  '**Status**: todo',
  '## Phase 4: Events',
  'Status: todo',
  '### 4.1 Events for the digest',
  'Status: waiting for you: the SendGrid key',
  '### Commands for the checks',
  'Run them all.',
].join('\n')

test('reads Phase headings, ids without a dot, and Status as a bullet', () => {
  expect(parsePlanMarks(PHASE_PLAN).map(m => [m.id, m.status, m.title, m.parent])).toEqual([
    ['P3', 'doing', 'Preferences', undefined],
    ['3.2', 'done', 'Email settings page', 'P3'],
    ['fix 1', 'todo', 'The free CV link', 'P3'],
    ['P4', 'todo', 'Events', undefined],
    ['4.1', 'needs-you', 'Events for the digest', 'P4'],
  ])
})

// NewsIntel shape: tracker table, parts in a status cell, an id-shaped part row, doc headings without status
const NEWS_PLAN = [
  '| ID | Engine | Step | After | Status |',
  '|---|---|---|---|---|',
  '| **P6** | | **Phase 6: Second layer** | | doing |',
  '| 6.1 | opus | Leadership feed | | done 2026-11-09 |',
  '| 6.1a | opus | Feed backfill | 6.1 | built 2026-11-10, site_gaps waits on the crawl |',
  '| 6.4 | opus | Press-release leadership moves | | todo, 6.4a done 2026-11-11 |',
  '',
  '### 5.1 Repository layout',
  'The code lives in src/.',
].join('\n')

test('reads a tracker table: title column by name, parts from a status cell, part ids under their story', () => {
  const marks = parsePlanMarks(NEWS_PLAN)
  expect(marks.map(m => [m.id, m.status, m.title ?? '', m.parent])).toEqual([
    ['P6', 'doing', 'Second layer', undefined],
    ['6.1', 'done', 'Leadership feed', 'P6'],
    ['6.1a', 'done', 'Feed backfill', '6.1'],
    ['6.4', 'todo', 'Press-release leadership moves', 'P6'],
    ['6.4a', 'done', '', '6.4'],
  ])
  expect(marks[2]!.statusText).toBeUndefined() // built is a known word for done
  expect(parsePlanMarks('### T5 Thing\nStatus: frobnicated')[0]).toEqual({ id: 'T5', title: 'Thing', statusText: 'frobnicated' })
  expect(marks[2]!.note).toBe('site_gaps waits on the crawl')
})

test("a flat file lands on the plan: stories, parts, epic pointers, and the epic's own status", () => {
  const plan = parsePlanMarks([
    '## Phase 3: Preferences', 'Status: doing',
    '### 3.2 Settings page', 'Status: doing',
    '### 3.3 Unsubscribe', 'Status: todo',
    '## Phase 4: Events', 'Status: todo',
    '### 4.1 Events', 'Status: done',
    '## Phase 7: Launch', 'Status: todo',
  ].join('\n'))
  const file = parseProgress(JSON.stringify({ goal: 'g', tasks: [
    { id: '1.1', title: 'Old one', status: 'done' },
    { id: '3.2a', title: 'Form', status: 'done' },
    { id: '3.2b', title: 'Save', status: 'running' },
    { id: '3.3-ui', title: 'Unsubscribe UI', status: 'todo' },
    { id: 'P4-review', title: 'Review', status: 'done' },
    { id: 'P4-e2e', title: 'E2E', status: 'running', note: 'iPhone 15' },
    { id: 'phase7', title: 'Launch', status: 'waiting' },
  ] }))!
  const m = mergePlan(file, plan)
  type Node = { id: string; status: string; steps?: Node[] }
  const tree = (s: Node): unknown => [s.id, s.status, ...((s.steps ?? []).length ? [s.steps!.map(tree)] : [])]
  expect(m.tasks.map(t => tree(t as Node))).toEqual([
    ['P3', 'doing', [['3.2', 'doing', [['3.2a', 'done'], ['3.2b', 'doing']]], ['3.3', 'todo', [['3.3-ui', 'todo']]]]],
    ['P4', 'doing', [['4.1', 'done'], ['P4-review', 'done'], ['P4-e2e', 'doing']]],
    ['P7', 'waiting'],
    ['1.1', 'done'],
  ])
  expect(m.tasks[1]!.steps[2]!.note).toBe('iPhone 15')
  expect(m.tasks[0]!.title).toBe('Preferences') // titles from the plan
  expect(counts({ tasks: m.tasks[0]!.steps })).toEqual({ done: 0, total: 2 }) // an epic counts its stories
  expect(currentStory(m)?.id).toBe('3.2')
  expect(storyTally(m).doing).toBe(2)
})

test('titles: the plan wins, else the file, never empty when one has it', () => {
  const file = parseProgress(JSON.stringify({ goal: 'g', tasks: [{ id: 'P6', title: '', status: 'running', steps: [
    { id: '6.1', title: '', status: 'done', engine: 'opus' },
    { id: '6.9', title: 'File-only step', status: 'todo' },
  ] }] }))!
  const m = mergePlan(file, parsePlanMarks(NEWS_PLAN))
  expect(m.tasks[0]!.title).toBe('Second layer')
  expect(m.tasks[0]!.steps.map(s => [s.id, s.title])).toEqual([['6.1', 'Leadership feed'], ['6.4', 'Press-release leadership moves'], ['6.9', 'File-only step']])
  expect(m.tasks[0]!.steps[0]!.engine).toBe('opus')
})

test('needs-you and to-approve items at any level are listed for the person', () => {
  const p = parseProgress(JSON.stringify({ goal: 'g', tasks: [
    { id: 'P1', title: 'One', status: 'shown' },
    { id: 'P2', title: 'Two', status: 'doing', steps: [
      { id: '2.1', title: 'Key', status: 'needs you' },
      { id: '2.2', title: 'Build', status: 'doing', steps: [{ id: '2.2a', title: 'Copy', status: 'waiting', note: 'your sign-off' }] },
    ] },
  ] }))!
  expect(needsYouItems(p).map(s => [s.id, s.status])).toEqual([['P1', 'shown'], ['2.1', 'needs-you'], ['2.2a', 'needs-you']])
  expect(current(p)?.id).toBe('P2')
  expect(currentStory(p)?.id).toBe('2.2') // doing comes before needs-you
})

test('layoutRow fills exactly the width: note first, then engine, then title', () => {
  const total = (r: ReturnType<typeof layoutRow>) => textWidth(Object.values(r).join(''))
  const base = { lead: '● in progress ', id: '6.4', idW: 6, title: 'Press-release leadership moves', engine: 'fw:glm-5p3-flash', note: 'waits on the crawl of every site', tokens: '12k', tokW: 4 }
  const cases = [
    base,
    { ...base, title: '' },
    { ...base, engine: 'a-very-long-engine-name-that-goes-on-and-on' },
    { ...base, note: 'n'.repeat(200) },
    { ...base, id: 'a-very-long-story-id', idW: 12 },
    { ...base, tokens: undefined, tokW: 0, engine: undefined, note: undefined },
  ]
  for (const r of cases) for (const w of [120, 80, 50, 40, 30, 20, 10, 3, 0]) expect(total(layoutRow(r, w))).toBe(w)
  const wide = layoutRow(base, 120)
  expect([wide.title, wide.engine, wide.note.trim()]).toEqual([base.title, ' [fw:glm-5p3-flash]', base.note])
  const mid = layoutRow(base, 64)
  expect(mid.note).toBe('') // the note goes first
  expect(mid.title).toBe(base.title)
  const narrow = layoutRow(base, 44)
  expect(Array.from(narrow.title).length).toBeGreaterThanOrEqual(10) // the title keeps 10 cells
  expect(layoutRow({ ...base, title: '' }, 80).title).toBe('') // an empty title stays empty, the engine is not in its place
})

test('refreshProgress writes a minimal file and reports what is off', () => {
  const plan = parsePlanMarks(`${PHASE_PLAN}\n### 4.2 Digest\n`)
  const now = Date.parse('2026-11-11T12:00:00Z')
  const file = parseProgress(JSON.stringify({
    goal: 'g', plan: 'PLAN.md', status: 'running',
    tasks: [
      { id: '3.2', title: 'Email settings page', status: 'done', tokens: 900 },
      { id: 'fix 1', title: 'The free CV link', status: 'running', engine: 'sonnet' },
      { id: 'zz-9', title: 'Stray', status: 'weird' },
    ],
    running: [
      { kind: 'build', title: 'old', since: '2026-11-11T07:00:00Z' },
      { kind: 'tests', title: 'fresh', since: '2026-11-11T11:30:00Z' },
    ],
    log: Array.from({ length: 14 }, (_, i) => `line ${i}`),
  }))!
  const { progress, tree, findings } = refreshProgress(file, plan, now)
  expect(progress.updated).toBeUndefined() // the file had none; a refresh does not make one up
  expect((progress.running as { title: string }[]).map(j => j.title)).toEqual(['fresh'])
  expect((progress.log as unknown[]).length).toBe(10)
  expect(progress.tasks).toEqual([
    { id: 'P3', steps: [{ id: '3.2', tokens: 900 }, { id: 'fix 1', status: 'doing', engine: 'sonnet' }] },
    { id: 'zz-9', title: 'Stray', status: 'todo' },
  ])
  expect(tree.map(t => t.id)).toEqual(['P3', 'P4', 'zz-9'])
  const text = findings.join('\n')
  expect(text).toContain('zz-9') // not in the plan
  expect(text).toContain('weird') // an unknown word
  expect(text).toContain('4.2') // a plan story with no status mark
  expect(text).toContain('old') // a stale job dropped
  expect(text).toContain('4.1') // reads needs-you
})

test('finding 1: a plan mark with an unknown word leaves the status to the file; ✅ reads done', () => {
  const plan = parsePlanMarks('| ID | Step | Status |\n|---|---|---|\n| **P6** | **Phase 6: Pages** | |\n| 6.2 | Breach pages | ✅ 2026-11-11 |\n| 6.3 | Index | frobnicated |\n| 6.4 | Feeds | 🔄 |')
  expect(plan.find(m => m.id === '6.2')?.status).toBe('done')
  expect(plan.find(m => m.id === '6.4')?.status).toBe('doing')
  expect(plan.find(m => m.id === '6.3')?.status).toBeUndefined()
  expect(plan.find(m => m.id === '6.3')?.statusText).toBe('frobnicated')
  const file = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [{ id: 'P6', steps: [{ id: '6.3', status: 'done' }] }] }))!
  const p6 = mergePlan(file, plan).tasks[0]!
  expect(p6.steps.map(s => [s.id, s.status])).toEqual([['6.2', 'done'], ['6.3', 'done'], ['6.4', 'doing']])
  expect(refreshProgress(file, plan, 0).findings.join('\n')).toContain('"frobnicated" on 6.3 not known')
})

test('finding 2: unmarked rows keep their titles and places, and parts nest under them', () => {
  const plan = parsePlanMarks('| ID | Step | Engine | Status |\n|---|---|---|---|\n| **P7** | **Phase 7: Person pages** | | |\n| 7.1 | Profiles | opus | done |\n| 6.4 | Press | | |\n| 6.4a | x | | done |')
  const tree = mergePlan({ goal: 'g', status: 'running', tasks: [], running: [], log: [] }, plan).tasks
  expect(tree.map(t => t.id)).toEqual(['P7'])
  expect(tree[0]!.title).toContain('Person pages')
  const p7 = tree[0]!
  expect(p7.steps.map(s => [s.id, s.title])).toEqual([['7.1', 'Profiles'], ['6.4', 'Press']])
  expect(p7.steps[1]!.steps?.map(s => s.id)).toEqual(['6.4a'])
})

test("finding 3: an epic's tokens add the steps the plan moved under it", () => {
  const plan = parsePlanMarks('## Phase 4: Funnel\nStatus: doing\n\n### 4.1 Events\nStatus: done\n')
  const file = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [{ id: 'P4', steps: [{ id: 'P4-review', tokens: 50 }] }, { id: '4.1', tokens: 100 }] }))!
  expect(mergePlan(file, plan).tasks[0]!.tokens).toBe(150)
  const own = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [{ id: 'P4', tokens: 999, steps: [{ id: 'P4-review', tokens: 50 }] }] }))!
  expect(mergePlan(own, plan).tasks[0]!.tokens).toBe(999)
})

test('finding 5: refreshProgress keeps keys it does not know and the old updated', () => {
  const raw = { goal: 'g', status: 'running', updated: '2026-11-10T08:00:00Z', phaseBase: 5, waiting: [{ id: 'x' }], tasks: [{ id: '1', title: 'One', status: 'done' }] }
  const { progress } = refreshProgress(parseProgress(JSON.stringify(raw))!, [], Date.parse('2026-11-11T12:00:00Z'), raw)
  const out = progress as unknown as Record<string, unknown>
  expect(out.updated).toBe('2026-11-10T08:00:00Z')
  expect(out.phaseBase).toBe(5)
  expect(out.waiting).toEqual([{ id: 'x' }])
})

test("finding 6: a second table's rows do not nest under the first table's last phase", () => {
  const plan = parsePlanMarks('| ID | Step | Status |\n|---|---|---|\n| **P1** | **Phase 1** | done |\n| 1.1 | A | done |\n\nSome text.\n\n| ID | Step | Status |\n|---|---|---|\n| fix 1 | B | done |')
  const fix = plan.find(m => m.id === 'fix 1')!
  expect(fix.parent).toBeUndefined()
  expect(fix.phase).toBeUndefined()
})

test('finding 8: an id twice in the file is merged and reported, not dropped', () => {
  const file = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [
    { id: '1.1', title: 'Events', status: 'todo', note: 'first', steps: [{ id: '1.1a', status: 'done' }] },
    { id: '1.1', status: 'done', note: 'second', steps: [{ id: '1.1b', status: 'doing' }] },
  ] }))!
  const plan = parsePlanMarks('## Phase 1: Base\nStatus: doing\n\n### 1.1 Events\n')
  const { tree, findings } = refreshProgress(file, plan, 0)
  const s = tree[0]!.steps[0]!
  expect([s.id, s.status, s.note]).toEqual(['1.1', 'done', 'first; second'])
  expect(s.steps?.map(c => c.id)).toEqual(['1.1a', '1.1b'])
  expect(findings.join('\n')).toContain('1.1 is in the file twice, merged')
})

test('finding 9: wide text is measured in cells, and rows with it fill exactly the width', () => {
  expect(textWidth('abc')).toBe(3)
  expect(textWidth('日本語')).toBe(6)
  expect(textWidth('ＡＢ')).toBe(4)
  expect(textWidth('✅ ok')).toBe(5)
  expect(textWidth('👍🏽')).toBe(2)
  expect(textWidth('👨‍👩‍👧')).toBe(2)
  expect(textWidth('é')).toBe(1)
  expect(textWidth('✔️')).toBe(2)
  expect(textWidth('🇬🇧')).toBe(2)
  expect(padCells('日本', 6)).toBe('日本  ')
  expect(padCells('日', 4, true)).toBe('  日')
  const cut = fit('日本語のタイトル', 7)
  expect(textWidth(cut)).toBeLessThanOrEqual(7)
  expect(cut.endsWith('…')).toBe(true)
  const r = { lead: '✅ done ', id: '六.四', idW: 6, title: '漢字のタイトル 🚀 とても長い', engine: 'fw:模型', note: '注意 👨‍👩‍👧 ノート', tokens: '1.2k', tokW: 4 }
  for (const w of [120, 60, 40, 30, 21, 12]) expect(textWidth(Object.values(layoutRow(r, w)).join(''))).toBe(w)
})

test('finding 11: approval phrases read as shown; weak words do not read prose as a status', () => {
  for (const w of ['to approve', 'in review', 'awaiting approval', 'for approval 2026-11-11']) expect(statusWord(w)).toBe('shown')
  expect(statusWord('open questions remain')).toBeUndefined()
  expect(statusWord('for you to see the pages')).toBeUndefined()
  expect(statusWord('open')).toBe('todo')
  expect(statusWord('open, 2026-11-11')).toBe('todo')
  expect(statusWord('for you: approve the copy')).toBe('needs-you')
})

test('finding 12a: a comma before a year stays in the date, not a part of the cell', () => {
  const plan = parsePlanMarks('| ID | Step | Status |\n|---|---|---|\n| 6.2 | Pages | done Nov 11, 2026 |')
  const m = plan.find(m => m.id === '6.2')!
  expect(m.status).toBe('done')
  expect(m.note).toBeUndefined()
  expect(plan.length).toBe(1)
})

test('finding 12c: a status that differs only in case is read without a note of it', () => {
  const file = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [{ id: '1', status: 'Done' }] }))!
  expect(file.tasks[0]!.status).toBe('done')
  expect(file.tasks[0]!.statusText).toBeUndefined()
})

test('fix ids match with or without a space: fix3 is fix 3', () => {
  const plan = parsePlanMarks('## Phase 4: Funnel\nStatus: doing\n\n### fix 3 The jobs email\n')
  const file = parseProgress(JSON.stringify({ goal: 'g', status: 'running', tasks: [{ id: 'fix3', status: 'running' }] }))!
  const { tree, findings } = refreshProgress(file, plan, 0)
  expect(tree.map(t => t.id)).toEqual(['P4'])
  expect(tree[0]!.steps.map(s => s.status)).toEqual(['doing'])
  expect(findings.join('\n')).not.toContain('not in the plan')
})
