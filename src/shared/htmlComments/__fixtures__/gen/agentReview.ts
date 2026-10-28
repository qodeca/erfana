// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The three agent-review pages (X-001): realistic pages annotated through the
 * real writer (createThread, addReply, setStatus, planInsert), with three
 * blocks then damaged on purpose. The seeded random source and the fixed clock
 * are shared across the pages, so the pages must be built in this order. Run
 * through genFixtures.ts (`npm run fixtures:html-comments`), never on its own.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  analyzeCommentDocument,
  applySplice,
  buildAnchor,
  buildDraftAnchor,
  createThread,
  addReply,
  setStatus,
  prepareSnapshot,
  planInsert,
  type CommentAuthor,
  type CommentData,
  type RuntimeAnchor
} from '../../index'
import { seededRandom } from '../commentTestData'
import { SPDX_HEADER } from './compat'

const MARTA: CommentAuthor = { name: 'Marta Nowak', email: 'marta@northwind.example', role: 'human' }
const TOM: CommentAuthor = { name: 'Tom Reyes', role: 'human' }
const random = seededRandom(2026)
let minute = 0
const now = () => new Date(Date.UTC(2026, 9, 24, 9, minute++, 0))

/** One comment to add to a page: which element, what it says, and what happens to it. */
interface ReviewPick {
  /** CSS-ish locator: tag plus a predicate on the element. */
  readonly tag: string
  readonly match?: (attrs: Record<string, string>, text: string) => boolean
  readonly text: string
  readonly by?: CommentAuthor
  readonly replies?: ReadonlyArray<{ by: CommentAuthor; text: string }>
  readonly resolve?: CommentAuthor
  readonly runtime?: { path: string; tag: string; outerHtml: string; exact: string }
  readonly damage?: (block: string) => string
}

function attrsOf(node: { attrs: Array<{ name: string; value: string }> }): Record<string, string> {
  return Object.fromEntries(node.attrs.map((a) => [a.name, a.value]))
}

/** Add every pick to `html`, in order, each through planInsert (own-lines where allowed). */
function annotate(html: string, picks: readonly ReviewPick[]): string {
  let text = html
  for (const pick of picks) {
    const doc = analyzeCommentDocument(text)
    const el = doc.index.elements.find(
      (e) =>
        e.tag === pick.tag &&
        (!pick.match || pick.match(attrsOf(e.node), doc.index.visibleText.slice(e.textStart, e.textEnd)))
    )
    if (!el) throw new Error(`agent-review: no element for ${pick.tag} / ${pick.text}`)
    let runtime: RuntimeAnchor | undefined
    if (pick.runtime) {
      const prepared = prepareSnapshot(pick.runtime.outerHtml)
      runtime = {
        path: pick.runtime.path,
        tag: pick.runtime.tag,
        quote: { exact: pick.runtime.exact, prefix: '', suffix: '' },
        snapshot: prepared.snapshot,
        ...(prepared.truncated ? { truncated: true as const } : {}),
        snapshotSource: 'page'
      }
    }
    const anchor = runtime ? buildDraftAnchor(doc.index, el, runtime) : buildAnchor(doc.index, el)
    let data: CommentData = createThread({
      anchor,
      view: { w: 1440, h: 900, dpr: 2, x: 0, y: 0 },
      text: pick.text,
      context: { author: pick.by ?? MARTA, now: now(), random }
    })
    for (const reply of pick.replies ?? []) {
      data = addReply(data, reply.text, { author: reply.by, now: now(), random })
    }
    if (pick.resolve) data = setStatus(data, 'resolved', { author: pick.resolve, now: now(), random })
    const plan = planInsert(doc, { targetStart: el.start, data, ws: 'collapse' })
    if (!plan.ok) throw new Error(`agent-review: ${pick.text}: ${plan.reason}`)
    const insert = pick.damage ? pick.damage(plan.plan.insert) : plan.plan.insert
    text = applySplice(text, { ...plan.plan, insert })
  }
  return text
}

const LANDING = `${SPDX_HEADER}<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Northwind Coffee - fresh coffee, delivered</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; color: #2b2118; }
    header, footer { padding: 16px 32px; background: #f5efe6; }
    nav a { margin-right: 16px; color: inherit; }
    .hero { padding: 64px 32px; background: #3b2a1e; color: #fff; }
    .btn { display: inline-block; padding: 10px 18px; border-radius: 4px; text-decoration: none; }
    .btn-primary { background: #c8742c; color: #fff; }
    .features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; padding: 48px 32px; }
    .card { border: 1px solid #e3d7c7; padding: 16px; }
    blockquote { margin: 0 32px 48px; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="#shop">Shop</a>
      <a href="#subscriptions">Subscriptions</a>
      <a href="#blog">Blog</a>
    </nav>
  </header>
  <section class="hero">
    <h1>Fresh coffee, delivered</h1>
    <p>Small-batch beans roasted every Monday and at your door by <em>Thursday</em>.</p>
    <a class="btn btn-primary" href="#subscribe">Start your subscription</a>
  </section>
  <section class="features">
    <article class="card">
      <h2>Roasted to order</h2>
      <p>We roast only what we sell that week.</p>
    </article>
    <article class="card">
      <h2>Grinder rental</h2>
      <p>Borrow a burr grinder for 5 EUR a month.</p>
    </article>
    <article class="card">
      <h2>Pause any time</h2>
      <p>Skip a week or cancel from your account page.</p>
    </article>
  </section>
  <blockquote>
    <p>"The best coffee I have had at home." - Priya, Leeds</p>
  </blockquote>
  <footer>
    <p class="copyright">&copy; 2024 Northwind Coffee Ltd.</p>
  </footer>
</body>
</html>
`

const SLIDES = `${SPDX_HEADER}<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Quarterly review - Q3</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #111; color: #eee; }
    header { padding: 16px 32px; }
    .deck .slide { display: none; padding: 48px 64px; min-height: 60vh; }
    .deck .slide.active { display: block; }
    .controls { padding: 16px 32px; }
    button { font-size: 16px; padding: 8px 16px; }
  </style>
</head>
<body>
  <header>
    <h1>Quarterly review</h1>
  </header>
  <div id="deck" class="deck"></div>
  <div class="controls">
    <button id="prev" type="button">Prev</button>
    <button id="next" type="button">Next</button>
  </div>
  <script>
    // Slides are built from this list at load time.
    const slides = [
      { title: 'Welcome', bullets: ['Agenda', 'Highlights', 'Questions'] },
      { title: 'Q3 results', bullets: ['Revenue up 12%', 'Churn down to 3%', 'Two new markets'] },
      { title: 'Next quarter', bullets: ['Launch the mobile app', 'Hire two engineers', 'Office move (tentative)'] }
    ]
    const deck = document.getElementById('deck')
    slides.forEach((slide, i) => {
      const section = document.createElement('section')
      section.className = 'slide' + (i === 0 ? ' active' : '')
      const h2 = document.createElement('h2')
      h2.textContent = slide.title
      const ul = document.createElement('ul')
      for (const bullet of slide.bullets) {
        const li = document.createElement('li')
        li.textContent = bullet
        ul.appendChild(li)
      }
      section.append(h2, ul)
      deck.appendChild(section)
    })
    let current = 0
    function show(n) {
      const all = deck.querySelectorAll('.slide')
      current = (n + all.length) % all.length
      all.forEach((s, i) => s.classList.toggle('active', i === current))
      location.hash = String(current + 1)
    }
    document.getElementById('prev').addEventListener('click', () => show(current - 1))
    document.getElementById('next').addEventListener('click', () => show(current + 1))
  </script>
</body>
</html>
`

const FORM = `${SPDX_HEADER}<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Create your Northwind account</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 48px auto; }
    label { display: block; margin-top: 16px; font-weight: 600; }
    input, select { width: 100%; padding: 8px; margin-top: 4px; }
    .check { font-weight: normal; }
    .check input { width: auto; }
  </style>
</head>
<body>
  <h1>Create your account</h1>
  <form action="/signup" method="post">
    <label for="name">Full name</label>
    <input id="name" name="name" type="text" autocomplete="name">
    <label for="email">Email</label>
    <input id="email" name="email" type="email">
    <label for="password">Password</label>
    <input id="password" name="password" type="password">
    <label for="plan">Plan</label>
    <select id="plan" name="plan">
      <option value="basic" selected>Basic - 10 EUR a month</option>
      <option value="pro">Pro - 20 EUR a month</option>
    </select>
    <label class="check"><input type="checkbox" name="newsletter"> Send me the weekly newsletter</label>
    <label class="check"><input type="checkbox" name="terms" required> I accept the terms</label>
    <button type="submit">Sign up</button>
  </form>
</body>
</html>
`

/** Readable text says one thing, @data another: Erfana treats the block as damaged. */
const handEdited = (from: string, to: string) => (block: string) => {
  if (!block.includes(from)) throw new Error(`damage: "${from}" not in block`)
  return block.replace(from, to)
}

/** The @data line cut off mid-way, as a careless hand edit or a bad merge leaves it. */
const truncatedData = (block: string) => block.replace(/(\n[ \t]*@data [^\n]{120})[^\n]*/, '$1')

/** A merge that left two marker lines inside the block (no complete hunk in the file). */
const mergeLeftovers = (block: string) => block.replace(/\n(\s*)(comment by)/, '\n<<<<<<< HEAD\n=======\n$1$2')

const byText = (needle: string) => (_a: Record<string, string>, text: string) => text.includes(needle)
const byAttr = (name: string, value: string) => (a: Record<string, string>) => a[name] === value

const LANDING_PICKS: readonly ReviewPick[] = [
  { tag: 'h1', text: 'Change the headline to "Coffee you will actually look forward to".' },
  {
    tag: 'a',
    match: byAttr('href', '#subscribe'),
    text: 'Make this button bigger (about 1.5x the padding) and change its label to "Get your first bag free".',
    replies: [{ by: TOM, text: 'Agreed. Keep the orange colour.' }]
  },
  { tag: 'em', text: 'Change "Thursday" to "Wednesday" - we ship a day earlier now.', by: TOM },
  {
    tag: 'article',
    match: byText('Grinder rental'),
    text: 'Remove this whole card. We no longer offer grinder rental.'
  },
  { tag: 'p', match: byAttr('class', 'copyright'), text: 'Update the year to 2026.', by: TOM },
  {
    tag: 'a',
    match: byAttr('href', '#blog'),
    text: 'Rename this link to "Journal".',
    replies: [{ by: TOM, text: 'We decided to keep "Blog". Leaving it as is.' }],
    resolve: TOM
  },
  {
    tag: 'blockquote',
    text: 'Shorten this quote to "The best coffee I have had at home."',
    damage: handEdited('  Shorten this quote to', '  Delete this testimonial and replace it with')
  }
]

const SLIDES_PICKS: readonly ReviewPick[] = [
  { tag: 'h1', text: 'Add a subtitle under this heading: "26 October 2026".' },
  {
    tag: 'div',
    match: byAttr('id', 'deck'),
    text: 'Rename this slide to "Q3 2026 results".',
    runtime: { path: 'section:nth-of-type(2) > h2:nth-of-type(1)', tag: 'h2', outerHtml: '<h2>Q3 results</h2>', exact: 'Q3 results' }
  },
  {
    tag: 'div',
    match: byAttr('id', 'deck'),
    text: 'Remove this bullet - the office move is not confirmed.',
    by: TOM,
    runtime: {
      path: 'section:nth-of-type(3) > ul:nth-of-type(1) > li:nth-of-type(3)',
      tag: 'li',
      outerHtml: '<li>Office move (tentative)</li>',
      exact: 'Office move (tentative)'
    }
  },
  {
    tag: 'div',
    match: byAttr('id', 'deck'),
    text: 'Typo: "Welcom" should be "Welcome".',
    runtime: { path: 'section:nth-of-type(1) > h2:nth-of-type(1)', tag: 'h2', outerHtml: '<h2>Welcome</h2>', exact: 'Welcome' },
    replies: [{ by: TOM, text: 'Fixed in the slide list already.' }],
    resolve: MARTA
  },
  { tag: 'button', match: byAttr('id', 'next'), text: 'Add an arrow to this label: "Next ->".', by: TOM },
  { tag: 'button', match: byAttr('id', 'prev'), text: 'Remove the Prev button entirely.', damage: truncatedData }
]

const FORM_PICKS: readonly ReviewPick[] = [
  { tag: 'input', match: byAttr('id', 'email'), text: 'Make this field required and add the placeholder "you@example.com".' },
  { tag: 'label', match: byAttr('for', 'password'), text: 'Add a hint after the label text: "(at least 12 characters)".', by: TOM },
  { tag: 'select', text: 'Make "Pro" the default option instead of "Basic".' },
  { tag: 'button', text: 'Change the label to "Create account".', by: TOM },
  {
    tag: 'input',
    match: byAttr('id', 'name'),
    text: 'Add autocomplete="name" to this field.',
    replies: [{ by: TOM, text: 'It already has it.' }],
    resolve: TOM
  },
  {
    tag: 'label',
    match: byText('newsletter'),
    text: 'Remove the newsletter checkbox.',
    damage: mergeLeftovers
  }
]

/** The pages in build order: the clock and the random source run on across them. */
const PAGES: ReadonlyArray<readonly [name: string, source: string, picks: readonly ReviewPick[]]> = [
  ['landing', LANDING, LANDING_PICKS],
  ['slides', SLIDES, SLIDES_PICKS],
  ['signup-form', FORM, FORM_PICKS]
]

/** Kind of each block as the parser reads it, for the one-line summary per page. */
function blockSummary(html: string): string {
  const doc = analyzeCommentDocument(html)
  const kinds = doc.state.blocks.map((b) =>
    b.kind === 'ok' ? `${b.data.status}:${b.target.state}` : b.kind === 'damaged' ? `damaged:${b.reason}` : b.kind
  )
  return `${doc.state.writable} ${kinds.join(' ')}`
}

/** Writes landing.html, slides.html and signup-form.html into `dir`. */
export function buildAgentReview(dir: string): void {
  mkdirSync(dir, { recursive: true })
  for (const [name, source, picks] of PAGES) {
    const html = annotate(source, picks)
    writeFileSync(join(dir, `${name}.html`), html)
    console.log(name, blockSummary(html))
  }
}
