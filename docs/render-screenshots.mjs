// Draws docs/images/*.svg from docs/examples/goal-progress.json with the goal-progress
// mod's own hooks: a temporary copy of the mod runs docs/render-screenshots.kit.ts
// under `claude plugin test`, which mounts the band and the pane and runs /goal-progress;
// this script lays the element trees they return out on a terminal grid.
// Rerun from the repo root: node docs/render-screenshots.mjs
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DOCS, '..')
const EXAMPLE = join(DOCS, 'examples', 'goal-progress.json')
/** 40 seconds after the example's "updated", so times read as they would mid-run. */
const NOW = Date.parse(JSON.parse(readFileSync(EXAMPLE, 'utf8')).updated) + 40_000

function shots() {
  const tmp = mkdtempSync(join(tmpdir(), 'gp-shots-'))
  try {
    const mod = join(tmp, 'goal-progress')
    cpSync(join(ROOT, 'plugins', 'goal-progress'), mod, { recursive: true })
    for (const f of readdirSync(join(mod, 'hooks'))) if (f.endsWith('.test.ts')) rmSync(join(mod, 'hooks', f))
    const test = readFileSync(join(DOCS, 'render-screenshots.kit.ts'), 'utf8')
      .replace('= __PROGRESS__', () => `= ${JSON.stringify(readFileSync(EXAMPLE, 'utf8'))}`)
      .replace('= __NOW__', () => `= ${NOW}`)
    writeFileSync(join(mod, 'hooks', 'shots.test.ts'), test)
    // The test prints its drawings with console.log, which reaches stderr.
    const run = spawnSync('claude', ['plugin', 'test', mod], { encoding: 'utf8', shell: process.platform === 'win32' })
    if (run.status !== 0) throw new Error(`claude plugin test failed:
${run.stdout}${run.stderr}`)
    const out = `${run.stdout}
${run.stderr}`
    const found = {}
    for (const line of out.split(/\r?\n/)) {
      const m = /^@@SHOT (\w+) (.*)$/.exec(line)
      if (m) found[m[1]] = JSON.parse(m[2])
    }
    for (const name of ['band', 'pane', 'command']) if (!found[name]) throw new Error(`no ${name} drawing in the test output`)
    return found
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const found = shots()
if (process.argv[2] === '--json') {
  console.log(JSON.stringify(found, null, 2))
  process.exit(0)
}

// A small terminal layout of the element trees: Box (row or column, width,
// paddingX, marginTop, round border), Text (nested styles), Button (its
// children, or "[ label ]"; a plain one draws its label alone).
const cell = (ch, s) => ({ ch, ...s })
const widthOf = lines => Math.max(0, ...lines.map(l => l.length))
const padTo = (line, w, s = {}) => (line.length >= w ? line.slice(0, w) : [...line, ...Array.from({ length: w - line.length }, () => cell(' ', s))])
const styleOf = (props = {}, base = {}) => ({
  color: props.color ?? base.color,
  dim: props.dimColor ?? base.dim,
  bold: props.bold ?? base.bold,
})

function inline(node, s) {
  if (typeof node === 'string' || typeof node === 'number') return Array.from(String(node)).map(ch => cell(ch, s))
  if (!node) return []
  const own = styleOf(node.props, s)
  if (node.type === 'Button' && !(node.children ?? []).length) {
    const label = node.props?.label ?? ''
    return inline(node.props?.plain ? label : `[ ${label} ]`, own)
  }
  return (node.children ?? []).flatMap(c => inline(c, own))
}

function layout(node, s = {}) {
  if (typeof node === 'string' || typeof node === 'number') return String(node) ? [inline(node, s)] : []
  if (!node) return []
  if (node.type === 'Text' || node.type === 'Button') return [inline(node, s)]
  const p = node.props ?? {}
  const kids = (node.children ?? []).map(c => layout(c, s)).filter(l => l.length)
  let body
  if (p.flexDirection === 'column') body = kids.flat()
  else {
    const h = Math.max(0, ...kids.map(k => k.length))
    body = Array.from({ length: h }, (_, r) => kids.flatMap(k => padTo(k[r] ?? [], widthOf(k))))
  }
  const px = p.paddingX ?? 0
  const border = p.borderStyle === 'round'
  const inner = p.width !== undefined ? p.width - 2 * px - (border ? 2 : 0) : widthOf(body)
  body = body.map(l => [...padTo([], px), ...padTo(l, inner), ...padTo([], px)])
  if (border) {
    const b = { color: p.borderColor }
    const w = inner + 2 * px
    const edge = (l, m, r) => [cell(l, b), ...Array.from({ length: w }, () => cell(m, b)), cell(r, b)]
    body = [edge('╭', '─', '╮'), ...body.map(l => [cell('│', b), ...l, cell('│', b)]), edge('╰', '─', '╯')]
  }
  const top = Array.from({ length: p.marginTop ?? 0 }, () => [])
  return [...top, ...body]
}

const COLORS = { cyan: '#56b6c2', magenta: '#c678dd', blue: '#61afef', green: '#98c379', yellow: '#e5c07b', red: '#e06c75', gray: '#7f848e', white: '#dcdfe4' }
const FG = '#dcdfe4'
const BG = '#1e2127'
const CW = 8.4
const LH = 18
const esc = ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch] ?? ch

function svg(lines, title) {
  const cols = Math.max(40, widthOf(lines))
  const padX = 16
  const top = 34
  const W = Math.ceil(cols * CW + 2 * padX)
  const H = top + lines.length * LH + 14
  // Block and box-drawing characters are drawn as shapes filling their cell, as
  // terminals do, so bars and borders join up whatever font the viewer has.
  const shape = (ch, x, y, fill, op) => {
    const [mx, my, r, b] = [x + CW / 2, y + LH / 2, x + CW, y + LH]
    const line = d => `<path d="${d}" stroke="${fill}" stroke-width="1.2" fill="none" opacity="${op}"/>`
    switch (ch) {
      case '█': return `<rect x="${x}" y="${y + 2}" width="${CW}" height="${LH - 4}" fill="${fill}" opacity="${op}"/>`
      case '░': return `<rect x="${x}" y="${y + 2}" width="${CW}" height="${LH - 4}" fill="${fill}" opacity="${op * 0.25}"/>`
      case '─': return line(`M${x} ${my}H${r}`)
      case '│': return line(`M${mx} ${y}V${b}`)
      case '╭': return line(`M${r} ${my}Q${mx} ${my} ${mx} ${b}`)
      case '╮': return line(`M${x} ${my}Q${mx} ${my} ${mx} ${b}`)
      case '╰': return line(`M${mx} ${y}Q${mx} ${my} ${r} ${my}`)
      case '╯': return line(`M${mx} ${y}Q${mx} ${my} ${x} ${my}`)
      default: return ''
    }
  }
  const rows = lines.map((line, r) => {
    const y = top + r * LH
    const shapes = []
    const runs = []
    line.forEach((c, i) => {
      if (c.ch === ' ') return
      const fill = COLORS[c.color] ?? FG
      const op = c.dim ? 0.55 : 1
      const drawn = shape(c.ch, +(padX + i * CW).toFixed(1), y, fill, op)
      if (drawn) return void shapes.push(drawn)
      const key = `${c.color}|${c.dim}|${c.bold}`
      const last = runs[runs.length - 1]
      if (last && last.key === key) last.cells.push([i, c.ch])
      else runs.push({ key, fill, op, bold: c.bold, cells: [[i, c.ch]] })
    })
    const texts = runs.map(run => {
      const attrs = `${run.op < 1 ? ` opacity="${run.op}"` : ''}${run.bold ? ' font-weight="bold"' : ''}`
      const xs = run.cells.map(([i]) => (padX + i * CW).toFixed(1)).join(' ')
      return `<text x="${xs}" y="${y + 13}" fill="${run.fill}"${attrs}>${run.cells.map(([, ch]) => esc(ch)).join('')}</text>`
    })
    return [...shapes, ...texts].join('')
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Consolas, 'DejaVu Sans Mono', Menlo, monospace" font-size="14" xml:space="preserve">`,
    `<rect width="${W}" height="${H}" rx="8" fill="${BG}"/>`,
    `<circle cx="18" cy="14" r="5" fill="#e06c75"/><circle cx="34" cy="14" r="5" fill="#e5c07b"/><circle cx="50" cy="14" r="5" fill="#98c379"/>`,
    `<text x="${W / 2}" y="18" fill="#7f848e" text-anchor="middle" font-size="12">${title.split('').map(esc).join('')}</text>`,
    ...rows,
    `</svg>`,
    '',
  ].join('\n')
}

const text = t => t.split('\n').map(l => inline(l, {}))
const IMAGES = join(DOCS, 'images')
mkdirSync(IMAGES, { recursive: true })
const write = (name, lines, title) => {
  writeFileSync(join(IMAGES, name), svg(lines, title))
  console.log(`docs/images/${name}`)
}
write('goal-progress-band.svg', layout(found.band), 'goal-progress band, above the prompt (demo)')
write('goal-tasks-pane.svg', layout(found.pane), 'Goal tasks pane (demo)')
write('goal-progress-command.svg', text(`goal-progress: ${found.command.text}`), '/goal-progress (demo)')
