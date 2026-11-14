// Builds the sample review pages in docs/review-samples/ from the one template.
// Run: node docs/review-samples/build-samples.mjs
// Each page = plugins/ag/templates/review/review.html + a spec (JSON) put into its data block.
// The images stay as files next to the pages (images/), so the samples are small.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const template = readFileSync(join(here, '..', '..', 'plugins', 'ag', 'templates', 'review', 'review.html'), 'utf8')
const when = '14 Nov 2026'

// Put a spec into the template. "</" is written as "<\/" so no string can close the script tag.
export function render(spec) {
  const json = JSON.stringify(spec).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\u0021--')
  const out = template.replace('/*REVIEW_DATA*/', () => json)
  if (out === template) throw new Error('no /*REVIEW_DATA*/ in the template')
  return out
}

const img = (f) => 'images/' + f

const samples = {
  // 1. Desktop only: one wide screenshot, one very tall one, a link to the running app.
  'desktop.html': {
    id: 'sample-desktop',
    title: 'Fix 12: clear error on the Orders page',
    project: 'Northwind Ops', when,
    summary: 'The import error on the Orders page now says what went wrong and what to do, in plain words, instead of the raw error code. The settings page got the same card style.',
    notes: ['Desktop only', 'Chrome 1440×900', 'Demo data'],
    app: 'src/app.html#dash',
    items: [
      { title: 'Orders page with the new error message', tags: ['Fix 12'],
        look: ['The red box at the top: is the wording clear to someone who is not technical?', 'The "import again" link: is it easy to find?'],
        shots: [{ src: img('orders-1440.png'), device: 'desktop', label: '1440×900', path: 'docs/review/fix12-orders-1440.png' }] },
      { title: 'Warehouse settings, full length', tags: ['Fix 12', 'Tall page'],
        look: ['Seven sections in the same card style', 'Spacing between the sections'],
        shots: [{ src: img('settings-1440-full.png'), device: 'desktop', label: '1440, full page', path: 'docs/review/fix12-settings-1440-full.png' }],
        note: 'A tall screenshot shows its top part first. "Show the full length" opens it in place; clicking it opens the viewer at full width.' },
      { title: 'Try it in the running app', answer: 'none',
        links: [{ url: 'src/app.html#dash', label: 'Orders page' }, { url: 'src/app.html#settings', label: 'Warehouse settings' }] },
    ],
    questions: [
      { q: 'Should "import again" open the shop\'s order page, so the address can be fixed there first?', options: ['Yes', 'No'], recommended: 'Yes', why: 'Most of these errors are fixed in the shop, not here.' },
      { q: 'Anything else on these two pages?' },
    ],
  },

  // 2. Desktop and phone: each item has both widths side by side; the filter shows one kind.
  'responsive.html': {
    id: 'sample-responsive',
    title: 'Orders page on desktop and phone',
    project: 'Northwind Ops', when,
    summary: 'The Orders page and its empty state now work on a phone: the table turns into rows, the four numbers go 2 by 2, and the side panel moves under the list.',
    notes: ['Desktop 1440', 'Phone 390', 'Demo data'],
    app: 'src/app.html#dash',
    items: [
      { title: 'Orders page', tags: ['Step 3.2'],
        look: ['On the phone: can you read each order without the table columns?', 'The error box on a small screen'],
        shots: [
          { src: img('orders-1440.png'), device: 'desktop', label: '1440×900', path: 'docs/review/orders-1440.png' },
          { src: img('orders-390.png'), device: 'phone', label: '390×844', path: 'docs/review/orders-390.png' },
          { src: img('orders-390-full.png'), device: 'phone', label: '390, full page', path: 'docs/review/orders-390-full.png' },
        ] },
      { title: 'No orders yet (empty state)', tags: ['Step 3.3'],
        look: ['The "Connect a shop" button: is it the obvious next step?'],
        shots: [
          { src: img('empty-1440.png'), device: 'desktop', label: '1440×900', path: 'docs/review/empty-1440.png' },
          { src: img('empty-390.png'), device: 'phone', label: '390×844', path: 'docs/review/empty-390.png' },
        ] },
    ],
    questions: [
      { q: 'On the phone, should the four numbers stay 2 by 2 or become one row you swipe?', options: ['2 by 2', 'One row'], recommended: '2 by 2' },
    ],
  },

  // 3. Before and after, plus a wording (copy) table.
  'compare.html': {
    id: 'sample-compare',
    title: 'Import error: before and after',
    project: 'Northwind Ops', when,
    summary: 'The same screen before and after Fix 12. Switch between side by side and the slider to see what changed.',
    notes: ['Desktop only', 'Before and after'],
    items: [
      { title: 'Orders page, before and after', tags: ['Fix 12'],
        look: ['Only the red box changed; the rest of the page is the same'],
        compare: { before: { src: img('orders-before-1440.png'), label: 'today' }, after: { src: img('orders-1440.png'), label: 'Fix 12' }, mode: 'slider' } },
      { title: 'The new wording', tags: ['Copy'],
        look: ['Plain words, no codes; each message says what to do next'],
        copy: [
          { where: 'Error box, title', before: "ImportError: field 'shipping_address' is null", after: 'One order could not be imported' },
          { where: 'Error box, text', before: '(order_id=10481, src=shopify, code=E_ADDR_NULL)', after: 'Order #10481 from Kestrel Labs has no delivery address. Add the address in the shop, then import again.' },
          { where: 'Status in the table', before: 'ERR', after: 'Import error' },
        ] },
    ],
  },

  // 4. Pick one of several directions.
  'choice.html': {
    id: 'sample-choice',
    title: 'Dashboard welcome: three directions',
    project: 'Northwind Ops', when,
    summary: 'Three directions for the welcome block at the top of the dashboard. Pick one; the others are dropped. Click a picture to see it large.',
    notes: ['Design', 'Desktop 1440', 'Images from the running mockup'],
    items: [
      { title: 'Which direction?', tags: ['Design'],
        look: ['How it feels at 9 in the morning with 40 orders to ship', 'Whether the one button is the obvious next step'],
        options: [
          { key: 'A', title: 'Calm teal', src: img('dirA-1440.png'), recommended: true, text: 'Light, quiet, close to the app today.', pros: ['Fits the rest of the app', 'Easy to read in daylight'], cons: ['Least new'] },
          { key: 'B', title: 'Night navy', src: img('dirB-1440.png'), text: 'Dark, for a warehouse screen on all day.', pros: ['Easy on the eyes on a wall screen'], cons: ['The whole app would need a dark mode'] },
          { key: 'C', title: 'Warm orange', src: img('dirC-1440.png'), text: 'A strong block that pulls the eye to the button.', pros: ['The button stands out most'], cons: ['Loud for a screen seen all day'] },
        ] },
    ],
    questions: [
      { q: 'Should the welcome block hide once all orders of the day are shipped?', options: ['Yes', 'No'], recommended: 'Yes' },
      { q: 'Anything to keep from the directions you did not pick?' },
    ],
  },

  // 5. The gallery: links to 1-4. Built from the same template.
  'index.html': {
    id: 'review-samples',
    title: 'Review pages: samples',
    project: 'AgentsPlugin', when,
    summary: 'One template for every review page: items stacked full width, no scroll boxes, a real image viewer, desktop and phone side by side, before and after, pick-one choices, wording tables, and answers you click and copy into the chat. Open each sample and try it. This page is itself built from the template.',
    notes: ['Samples use a made-up app', 'plugins/ag/templates/review/review.html'],
    items: [
      { title: 'Desktop only', tags: ['Sample 1'], answer: 'none', look: ['Wide and very tall screenshots, no scroll bars inside the card', 'Click a screenshot: the viewer opens full screen; Fit, Width and 100%; drag to move; ← → between images'], links: [{ url: 'desktop.html', label: 'desktop.html' }] },
      { title: 'Desktop and phone', tags: ['Sample 2'], answer: 'none', look: ['Phone screenshots in a narrow phone frame beside the desktop one', 'The All / Desktop / Phone filter at the top'], links: [{ url: 'responsive.html', label: 'responsive.html' }] },
      { title: 'Before and after, and wording', tags: ['Sample 3'], answer: 'none', look: ['Slider and side by side', 'The Was / Now table for copy'], links: [{ url: 'compare.html', label: 'compare.html' }] },
      { title: 'Pick one direction', tags: ['Sample 4'], answer: 'none', look: ['Option cards with pros, cons and a Recommended badge', 'Clicking a card picks it; the answer bar collects it for Copy answer'], links: [{ url: 'choice.html', label: 'choice.html' }] },
    ],
  },
}

for (const [file, spec] of Object.entries(samples)) {
  writeFileSync(join(here, file), render({ ...spec, generated: when }))
  console.log('wrote', file)
}
