// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Built-in browser pick mode, main side (spec 025 commit 14; 025-AC-025,
 * 025-AC-026, 025-AC-027, 025-AC-029 main parts).
 *
 * There is no pick UI yet (commit 19), so these tests drive what the
 * renderer will drive – `window.api.browserTab.pickMode` and `refine` – and
 * check what main does: the node and box of the highlight Erfana asked for
 * and its exact label (test hook, spec change S-1), the `browser-tab:pick`
 * events the window receives, and what the page saw.
 *
 * Pointer input goes through main-side `sendInputEvent` (S-27). That path
 * never reaches a cross-site frame's own widget (commit-8 probe), so frame
 * picks here exercise main's descent through the owner's content quad.
 * Condition-based waits only.
 */
import { test, expect } from './fixtures/browserHarness'
import { expectBoxNear, mainHook, openPicker, PICK_WAIT_MS as WAIT_MS } from './pages/browser-pick.page'

// Pick, key routing and focus moving into the page all follow the page's
// native focus, which ends when the window stops being the OS key window: run
// with the OS-focus lock held exclusive (e2e/fixtures/osFocusLock.ts).
test.use({ needsOsFocus: true })

test.describe('built-in browser pick mode (main side)', () => {
  test('pick mode outlines the hovered element with its exact label and keeps clicks from the page (main side of 025-AC-025, 025-AC-026)', async ({
    browserTabs,
    browserServers
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    await pick.page.eval('window.__fixture.resetCounters(); window.__fixture.clear(); 0')
    expect((await pick.mode(true)).ok).toBe(true)
    await pick.waitForEvent((e) => e.kind === 'mode' && e.on === true)

    const label = await pick.rect('#save-label')
    const shown = await pick.hover(label, 'span#save-label ')
    expect(shown.label).toBe(`span#save-label ${Math.round(label.width)} × ${Math.round(label.height)}`)
    expectBoxNear(shown.box, label)
    await pick.waitForEvent((e) => e.kind === 'highlight' && e.label === shown.label)

    // SVG classes, an id with colons, a 10.6 px wide element, an emoji at character 40.
    const bar = await pick.rect('[data-testid="bar-a"]')
    expect((await pick.hover(bar, 'rect.bar.bar--a.bar--tall ')).label).toMatch(/^rect\.bar\.bar--a\.bar--tall \d+ × \d+$/)
    expect((await pick.hoverSelector('[id=":r1:"]', 'div#:r1: ')).label).toMatch(/^div#:r1: \d+ × \d+$/)
    expect((await pick.hoverSelector('[data-testid="w10-6"]', 'div.w10-6 ')).label).toBe('div.w10-6 11 × 24')
    const emoji = await pick.hoverSelector('[data-testid="emoji-class"]', 'div.')
    expect(emoji.label).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
    const longList = await pick.hoverSelector('[data-testid="long-classes"]', 'div.alpha')
    expect(longList.label).toMatch(/ \d+ × \d+$/)
    expect([...longList.label.replace(/ \d+ × \d+$/, '')].length).toBeLessThanOrEqual(40)

    // A click in pick mode does not reach the page's handler.
    // The button's padding, left of its centred label.
    const button = await pick.rect('#save-button')
    await pick.move(Math.round(button.x + 3), Math.round(button.y + 3))
    await pick.waitForLabel('button#save-button ')
    expect(await pick.page.eval<number>('window.__fixture.mutations()')).toBe(0)
    expect(await pick.page.eval<number>('window.__fixture.resizeChanges()')).toBe(0)

    // Esc with page focus leaves pick mode; the highlight goes.
    await pick.key('Escape')
    await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(false)
    await expect.poll(() => pick.highlight(), { timeout: WAIT_MS }).toBeNull()
  })

  test('Up and Down walk the hovered chain, with the end notes (main side of 025-AC-027)', async ({ browserTabs, browserServers }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    await pick.mode(true)
    await pick.hoverSelector('#save-label', 'span#save-label ')
    await pick.key('Down')
    await pick.waitForEvent((e) => e.kind === 'note' && e.note === 'backAtStart')
    await pick.key('Up')
    await pick.waitForLabel('button#save-button ')
    await pick.key('Up')
    await pick.waitForLabel('div#outer ')
    await pick.key('Down')
    await pick.waitForLabel('button#save-button ')
    await pick.key('Down')
    await pick.waitForLabel('span#save-label ')
    for (let i = 0; i < 6; i++) await pick.key('Up')
    await pick.waitForLabel('html ')
    const before = (await pick.events()).length
    await pick.key('Up')
    await pick.waitForEvent((e) => e.kind === 'note' && e.note === 'topOfPage', before)
  })

  test('Enter confirms; Up in the menu moves the pick; Esc closes the menu and a second Esc leaves pick mode (main side of 025-AC-025, 025-AC-027)', async ({
    browserTabs,
    browserServers
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    await pick.mode(true)
    await pick.hoverSelector('#save-label', 'span#save-label ')
    await pick.key('Return')
    const captured = await pick.waitForEvent((e) => e.kind === 'captured')
    expect(captured.summary?.name).toBe('span#save-label')
    expect(captured.summary?.ancestors.slice(-3)).toEqual(['div#outer', 'button#save-button', 'span#save-label'])
    expect(captured.summary?.atStart).toBe(true)

    const before = (await pick.events()).length
    expect((await pick.refine(captured.captureId!, 'parent')).ok).toBe(true)
    const refined = await pick.waitForEvent((e) => e.kind === 'refined', before)
    expect(refined.summary?.name).toBe('button#save-button')
    await pick.refine(captured.captureId!, { ancestor: (refined.summary?.ancestors.length ?? 2) - 2 })
    await expect.poll(async () => (await pick.state()).capture?.summary.name, { timeout: WAIT_MS }).toBe('div#outer')

    // Esc closes the menu; pick mode stays on.
    expect((await pick.close(captured.captureId!, 'esc')).ok).toBe(true)
    await expect.poll(async () => (await pick.state()).capture, { timeout: WAIT_MS }).toBeNull()
    expect((await pick.state()).active).toBe(true)
    await pick.key('Escape')
    await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(false)
  })

  test('a new document ends pick mode; pushState does not (main side of 025-AC-025)', async ({ browserTabs, browserServers }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/elements.html'))
    await pick.mode(true)
    await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(true)
    await pick.page.eval(`history.pushState({}, '', '?pushed=1'); 0`)
    await pick.page.waitFor(`location.search === '?pushed=1'`)
    expect((await pick.state()).active).toBe(true)
    const next = browserServers.sites.static.url('/plain.html')
    await pick.page.eval(`location.href = ${JSON.stringify(next)}; 0`).catch(() => undefined)
    await pick.page.waitForLoaded(next)
    await expect.poll(async () => (await pick.state()).active, { timeout: WAIT_MS }).toBe(false)
  })

  test('frames: buttons in every frame kind are outlined, and Up crosses from a frame to its iframe (main side of 025-AC-029)', async ({
    browserTabs,
    browserServers
  }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/frames.html'))
    // The cross-site frame runs in its own process and attaches as its own target.
    await expect
      .poll(async () => (await mainHook<Array<{ type: string; url: string }>>(pick.app, 'pick', 'attachedTargets', pick.tabId)).some((t) => t.type === 'iframe'), {
        timeout: WAIT_MS
      })
      .toBe(true)
    await pick.mode(true)
    for (const id of ['same-origin', 'cross-site', 'nested', 'srcdoc', 'blank-written', 'sandboxed']) {
      const frame = await pick.rect(`#${id}`)
      // Each fixture frame shows its button near its top-left corner (margin 4px).
      const point = { x: Math.round(frame.x + 30), y: Math.round(frame.y + 14) }
      await pick.move(point.x, point.y)
      // The point lands on the button's label or the button; the nested frame shows its own text first.
      const pattern = id === 'nested' ? /^(p|html|body|iframe|span|button|div)[#. ]/ : /^(span|button#frame-button)[#. ]/
      // Wait for this frame's highlight: the previous frame's button matches the label pattern too.
      const inFrame = (box: { x: number; y: number; width: number; height: number } | null): boolean =>
        box !== null && box.x >= frame.x - 1 && box.y >= frame.y - 1 && box.x + box.width <= frame.x + frame.width + 1
      await expect
        .poll(
          async () => {
            const h = await pick.highlight()
            return h !== null && inFrame(h.box) ? h.label : `outside: ${JSON.stringify(h)}`
          },
          { timeout: WAIT_MS, message: `${id} highlight inside its frame` }
        )
        .toMatch(pattern)
      const shown = (await pick.highlight())!
      if (id === 'same-origin' || id === 'srcdoc' || id === 'blank-written') {
        // Up to the button, then compare with the button's box inside the frame (2px iframe border).
        if (shown.label.startsWith('span')) {
          await pick.key('Up')
          await pick.waitForLabel('button#frame-button ')
        }
        const inner = await pick.rect('#frame-button', id)
        const expected = { x: frame.x + inner.x + 2, y: frame.y + inner.y + 2, width: inner.width, height: inner.height }
        expectBoxNear((await pick.highlight())!.box, expected, 1)
      }
    }

    // Up from inside the cross-site frame reaches its <iframe> element in the parent document.
    const cross = await pick.rect('#cross-site')
    await pick.move(Math.round(cross.x + 30), Math.round(cross.y + 14))
    await expect.poll(async () => (await pick.highlight())?.sessionKey ?? '', { timeout: WAIT_MS }).not.toBe('')
    // Up walks button → body → html inside the frame, then the <iframe>; step until it shows.
    const crossed = async (): Promise<boolean> => ((await pick.highlight())?.label ?? '').startsWith('iframe#cross-site ')
    for (let i = 0; i < 8 && !(await crossed()); i++) {
      const before = (await pick.highlight())?.label ?? ''
      await pick.key('Up')
      await expect.poll(async () => (await pick.highlight())?.label ?? '', { timeout: WAIT_MS }).not.toBe(before)
    }
    await pick.waitForLabel('iframe#cross-site ')
    expectBoxNear((await pick.highlight())!.box, cross, 1)
  })

  test('a frame removed while it holds the highlight ends the highlight; pick mode stays on (main side of 025-AC-029)', async ({ browserTabs, browserServers }) => {
    const pick = await openPicker(browserTabs, browserServers.sites.static.url('/frames.html'))
    await pick.mode(true)
    const frame = await pick.rect('#same-origin')
    await pick.move(Math.round(frame.x + 30), Math.round(frame.y + 14))
    await expect.poll(async () => (await pick.highlight())?.label ?? '', { timeout: WAIT_MS }).not.toBe('')
    await pick.page.eval(`window.__fixture.removeFrame('same-origin')`)
    await pick.move(Math.round(frame.x + 31), Math.round(frame.y + 15))
    await expect.poll(async () => (await pick.highlight())?.label ?? '', { timeout: WAIT_MS }).not.toMatch(/^button#frame-button/)
    expect((await pick.state()).active).toBe(true)
  })
})

