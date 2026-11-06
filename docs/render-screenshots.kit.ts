// Copied by docs/render-screenshots.mjs, as hooks/shots.test.ts, into a temporary copy of the goal-progress
// mod, with __PROGRESS__ and __NOW__ filled in; prints the mod's own drawings as JSON.
import { mock, test } from 'claude-code/testing'

const PROGRESS = __PROGRESS__
const NOW = __NOW__
const COLS = 100

/** The demo project's progress file; paths arrive absolute, with \ on Windows. */
const isFile = (path: unknown) => String(path).replace(/\\/g, '/').endsWith('/demo/.claude/goal-progress.json')

async function start($: any, on: any) {
  mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: '/demo' }))
  on('command.register', () => ({ value: undefined }))
  on('session.root', () => ({ value: '/demo' }))
  on('fs.exists', ($: any, e: any) => ({ value: isFile(e.path) }))
  on('fs.read', ($: any, e: any) => ({ value: isFile(e.path) ? PROGRESS : '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: [''] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/demo' })
}

const out = (name: string, value: unknown) => console.log(`@@SHOT ${name} ${JSON.stringify(value)}`)

test('band', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({
    plugin: 'goal-progress', surface: 'terminal', component: 'AbovePrompt',
    viewport: { columns: COLS, rows: 40 },
    props: { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: COLS, scroll: { offset: 0, bodyRows: 6 }, view: {} },
  } as any)
  out('band', await ui.find({ type: 'Box' }))
  await ui.unmount()
})

test('pane', async ($, on) => {
  await start($, on)
  const ui = await $.ui.mount({
    plugin: 'goal-progress', surface: 'terminal', component: 'Pane', requestId: 'goal-tasks',
    viewport: { columns: COLS + 40, rows: 60 },
    props: { title: 'Goal tasks', isFocused: true, bodyColumns: COLS - 24, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
  } as any)
  out('pane', await ui.find({ type: 'Box' }))
  await ui.unmount()
})

test('command', async ($, on) => {
  await start($, on)
  out('command', await $.command.run({ command: 'goal-progress', args: '' }))
})
