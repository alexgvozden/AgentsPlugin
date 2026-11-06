import { expect, test } from 'claude-code/testing'

import { bar, counts, current, isOpen, keepLastGood, orderedSteps, parseProgress, runningLines, shortTokens, statusLine, stepSummary } from './progress'

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
