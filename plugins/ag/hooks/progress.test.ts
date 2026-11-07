import { expect, test } from 'claude-code/testing'

import type { Agent, PlanMark } from './progress'
import { agentJobs, bar, counts, current, isOpen, keepLastGood, keepLastMarks, mergeAgents, mergePlan, orderedSteps, parsePlanMarks, parseProgress, runningLines, shortTokens, statusLine, stepSummary } from './progress'

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

test('orders all the steps: deployed, done, shown, in progress, waiting, not started, file order within each', () => {
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
  expect(orderedSteps(p.tasks[0]!).map(s => s.id)).toEqual(['g', 'a', 'd', 'c', 'f', 'e', 'b'])
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
    { id: 'P1', title: 'Phase 1: Design directions', status: 'done' },
    { id: '1.1', title: 'Design directions', status: 'done', phase: 'P1' },
    { id: '1.2', title: 'Data coverage', status: 'doing', phase: 'P1' },
    { id: 'P2', title: 'Phase 2: Screens', status: 'todo' },
    { id: '2.1', title: 'All screens', status: 'todo', phase: 'P2' },
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
    { id: 'S14', title: "The band reads the plan and the session's subagents", status: 'done', phase: 'P4' },
    { id: 'S15', title: 'The launcher registers its own job', status: 'blocked', phase: 'P4' },
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
  expect(merged.tasks[0]!.title).toBe('Phase 1 (file)') // the file keeps the titles it has
  expect(merged.tasks[0]!.steps.map(s => [s.id, s.status])).toEqual([['1.1', 'done'], ['1.2', 'todo'], ['1.3', 'doing']])
  expect(merged.tasks[0]!.steps[0]).toEqual({ id: '1.1', title: 'Design (file)', status: 'done', note: 'in flight', engine: 'opus-high', tokens: 500 })
  expect(merged.tasks[0]!.steps[2]!.title).toBe('Validation kit') // an added step keeps the plan's title
  expect(merged.tasks[1]!.steps.map(s => s.id)).toEqual(['2.1', '2.2']) // P2 keeps its own step, the plan's was added
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
