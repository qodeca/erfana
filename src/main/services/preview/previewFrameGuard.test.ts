// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The frame guard's decisions (issue #124, WI-14; part 2 §2.5–§2.7). The caps
 * are imported, never typed here, so a changed limit moves these tests with it.
 */
import { describe, expect, it, vi } from 'vitest'

import { PREVIEW_LIMITS } from '../../../shared/preview-limits'
import {
  ERR_BLOCKED_BY_CSP,
  ERR_BLOCKED_BY_RESPONSE,
  decideFailedFrameLoad,
  decideFrameNavigation,
  decideSrcdocFrame,
  frameDepth,
  isAboutBlankUrl,
  isOwnPreviewToken,
  isRefusedFrameCode,
  isSrcdocUrl,
  type PreviewFrameFacts,
  type PreviewFrameLike,
  type PreviewFrameNavigationFacts
} from './previewFrameGuard'

const { MAX_FRAME_DEPTH, MAX_FRAMES_PER_PAGE } = PREVIEW_LIMITS
const OWN_TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'
const OTHER_TOKEN = 'cafebabecafebabecafebabecafebabe'
const own = (path: string): string => `erfana-preview://${OWN_TOKEN}${path}`
const TOP_ID = 1
/** Chromium's `ERR_BLOCKED_BY_CLIENT`: the request filter's own cancel. */
const ERR_BLOCKED_BY_CLIENT = -20
const ERR_ABORTED = -3

/** The deepest frame of a chain `depth` levels below the page. */
function frameAt(depth: number, topId = TOP_ID): PreviewFrameLike {
  let frame: PreviewFrameLike = { frameTreeNodeId: topId, parent: null }
  for (let level = 1; level <= depth; level += 1) {
    frame = { frameTreeNodeId: topId + level, parent: frame }
  }
  return frame
}

/** Facts with spies, so a test can prove what was – and was not – read. */
function facts(overrides: Partial<PreviewFrameFacts> = {}) {
  const depth = vi.fn(() => 1 as number | null)
  const framesInTree = vi.fn(() => 2)
  return {
    depth,
    framesInTree,
    facts: { committedBefore: false, pageOverCap: false, depth, framesInTree, ...overrides }
  }
}

function navigation(
  url: string,
  overrides: Partial<PreviewFrameNavigationFacts> = {}
): PreviewFrameNavigationFacts & { depth: ReturnType<typeof vi.fn>; framesInTree: ReturnType<typeof vi.fn> } {
  const { facts: base } = facts()
  return { url, ownToken: OWN_TOKEN, ...base, ...overrides } as never
}

describe('frameDepth', () => {
  it('counts parent steps to the page: the page is 0, a frame in it 1', () => {
    expect(frameDepth(frameAt(0), TOP_ID)).toBe(0)
    expect(frameDepth(frameAt(1), TOP_ID)).toBe(1)
    expect(frameDepth(frameAt(MAX_FRAME_DEPTH + 1), TOP_ID)).toBe(MAX_FRAME_DEPTH + 1)
  })

  it('walks at most MAX_FRAME_DEPTH + 1 steps, then gives up', () => {
    let parentReads = 0
    let frame: PreviewFrameLike = { frameTreeNodeId: TOP_ID, parent: null }
    for (let level = 1; level <= 20; level += 1) {
      const parent = frame
      frame = {
        frameTreeNodeId: TOP_ID + level,
        get parent() {
          parentReads += 1
          return parent
        }
      }
    }

    expect(frameDepth(frame, TOP_ID)).toBeNull()
    expect(parentReads).toBeLessThanOrEqual(MAX_FRAME_DEPTH + 2)
  })

  it('gives null for a frame that is not in this page', () => {
    expect(frameDepth(frameAt(2, 100), TOP_ID)).toBeNull()
  })
})

describe('decideFrameNavigation – the scheme', () => {
  it("allows this view's own token (the protocol handler confines every request)", () => {
    expect(decideFrameNavigation(navigation(own('/child.html')))).toEqual({ action: 'allow' })
  })

  it.each(['about:blank', 'about:srcdoc', 'about:blank#x'])(
    'allows %s and reads nothing, even on a page past the cap',
    (url) => {
      const input = navigation(url, { pageOverCap: true })
      expect(decideFrameNavigation(input)).toEqual({ action: 'allow' })
      expect(input.depth).not.toHaveBeenCalled()
      expect(input.framesInTree).not.toHaveBeenCalled()
    }
  )

  it('refuses another token as frame-escape, listing the full address', () => {
    const url = `erfana-preview://${OTHER_TOKEN}/x.html`
    const input = navigation(url)
    expect(decideFrameNavigation(input)).toEqual({
      action: 'refuse',
      type: 'frame-escape',
      address: url
    })
    expect(input.depth).not.toHaveBeenCalled()
  })

  it.each(['', 'NOT-A-TOKEN', OWN_TOKEN.toUpperCase()])(
    'treats every preview frame as foreign when the own token is unusable (%j)',
    (ownToken) => {
      expect(decideFrameNavigation(navigation(own('/child.html'), { ownToken }))).toMatchObject({
        action: 'refuse',
        type: 'frame-escape'
      })
    }
  )

  it.each([
    ['https://example.com/page?q=1', 'https://example.com/page?q=1'],
    ['data:text/html,<p>big inline page</p>', 'data:'],
    ['blob:erfana-preview://deadbeef/1234', 'blob:'],
    ['https://[bad/x', 'https://[bad/x']
  ])('refuses a remote first load (%s) as frame-remote, listing %s', (url, address) => {
    expect(decideFrameNavigation(navigation(url))).toEqual({
      action: 'refuse',
      type: 'frame-remote',
      address
    })
  })

  it.each([
    ['https://user:pw@evil.example:8443/steal?token=1#x', 'https://evil.example:8443'],
    ['data:text/html,secret', 'data:'],
    ['https://[bad/x?secret', 'https:']
  ])('refuses a link out of a frame (%s) as frame-link-blocked: %s only', (url, address) => {
    expect(decideFrameNavigation(navigation(url, { committedBefore: true }))).toEqual({
      action: 'refuse',
      type: 'frame-link-blocked',
      address
    })
  })
})

describe('decideFrameNavigation – the caps (constants imported)', () => {
  it('allows depth MAX_FRAME_DEPTH and refuses one level deeper, listing the path, never the token', () => {
    expect(decideFrameNavigation(navigation(own('/l3.html'), { depth: () => MAX_FRAME_DEPTH }))).toEqual({
      action: 'allow'
    })
    expect(
      decideFrameNavigation(navigation(own('/sub/l4.html'), { depth: () => MAX_FRAME_DEPTH + 1 }))
    ).toEqual({ action: 'refuse', type: 'frame-too-deep', address: '/sub/l4.html' })
  })

  it('refuses a frame whose depth could not be read', () => {
    expect(decideFrameNavigation(navigation(own('/x.html'), { depth: () => null }))).toMatchObject({
      type: 'frame-too-deep'
    })
  })

  it('S12: frames 1 to MAX_FRAMES_PER_PAGE load, the next is past the cap', () => {
    // Inside the event the k-th frame is already in `framesInSubtree`, beside the main frame.
    const kth = (k: number): PreviewFrameNavigationFacts =>
      navigation(own(`/f${k}.html`), { framesInTree: () => k + 1 })

    expect(decideFrameNavigation(kth(MAX_FRAMES_PER_PAGE))).toEqual({ action: 'allow' })
    expect(decideFrameNavigation(kth(MAX_FRAMES_PER_PAGE + 1))).toEqual({ action: 'over-limit' })
  })

  it('past the cap, a first load is refused with no depth or count read', () => {
    const input = navigation(own('/f61.html'), { pageOverCap: true })

    expect(decideFrameNavigation(input)).toEqual({ action: 'over-limit' })
    expect(input.depth).not.toHaveBeenCalled()
    expect(input.framesInTree).not.toHaveBeenCalled()
  })

  it('a link inside a frame that shows a document adds no frame: the count cap does not apply', () => {
    const input = navigation(own('/next.html'), {
      committedBefore: true,
      pageOverCap: true,
      framesInTree: vi.fn(() => MAX_FRAMES_PER_PAGE + 20)
    })

    expect(decideFrameNavigation(input)).toEqual({ action: 'allow' })
    expect(input.framesInTree).not.toHaveBeenCalled()
  })

  it('a link inside a srcdoc frame shown past the depth cap cannot load a src page', () => {
    expect(
      decideFrameNavigation(
        navigation(own('/deep.html'), { committedBefore: true, depth: () => MAX_FRAME_DEPTH + 1 })
      )
    ).toEqual({ action: 'refuse', type: 'frame-too-deep', address: '/deep.html' })
  })
})

describe('decideSrcdocFrame – shown anyway, listed (answer 9)', () => {
  it('within both caps: nothing to list', () => {
    expect(decideSrcdocFrame(facts({ depth: () => MAX_FRAME_DEPTH }).facts)).toEqual({
      tooDeep: false,
      overLimit: false
    })
  })

  it('deeper than MAX_FRAME_DEPTH: too deep', () => {
    expect(decideSrcdocFrame(facts({ depth: () => MAX_FRAME_DEPTH + 1 }).facts)).toEqual({
      tooDeep: true,
      overLimit: false
    })
  })

  it('the frame after MAX_FRAMES_PER_PAGE is past the cap, and both can hold at once', () => {
    expect(
      decideSrcdocFrame(facts({ framesInTree: () => MAX_FRAMES_PER_PAGE + 2 }).facts)
    ).toEqual({ tooDeep: false, overLimit: true })
    expect(
      decideSrcdocFrame(
        facts({ depth: () => null, framesInTree: () => MAX_FRAMES_PER_PAGE + 2 }).facts
      )
    ).toEqual({ tooDeep: true, overLimit: true })
  })

  it('on a page past the cap it is only counted: no reads', () => {
    const { facts: input, depth, framesInTree } = facts({ pageOverCap: true })

    expect(decideSrcdocFrame(input)).toEqual({ tooDeep: false, overLimit: true })
    expect(depth).not.toHaveBeenCalled()
    expect(framesInTree).not.toHaveBeenCalled()
  })

  it('a frame that showed a document before was judged on its first load', () => {
    const { facts: input, depth } = facts({ committedBefore: true, pageOverCap: true })

    expect(decideSrcdocFrame(input)).toEqual({ tooDeep: false, overLimit: false })
    expect(depth).not.toHaveBeenCalled()
  })
})

describe('decideFailedFrameLoad – the failed-load writer (S10)', () => {
  const failed = (errorCode: number, url: string, committedBefore = false, ownToken = OWN_TOKEN) =>
    decideFailedFrameLoad({ errorCode, url, ownToken, committedBefore })

  it.each([
    [ERR_BLOCKED_BY_CSP, 'https://example.com/', false, 'frame-remote', 'https://example.com/'],
    [ERR_BLOCKED_BY_RESPONSE, 'https://example.com/x', false, 'frame-remote', 'https://example.com/x'],
    [
      ERR_BLOCKED_BY_CSP,
      `erfana-preview://${OTHER_TOKEN}/x.html`,
      false,
      'frame-escape',
      `erfana-preview://${OTHER_TOKEN}/x.html`
    ],
    [
      ERR_BLOCKED_BY_CSP,
      `erfana-preview://${OTHER_TOKEN}/x.html`,
      true,
      'frame-escape',
      `erfana-preview://${OTHER_TOKEN}/x.html`
    ],
    [ERR_BLOCKED_BY_CSP, 'data:text/html,<p>x</p>', false, 'frame-remote', 'data:'],
    [ERR_BLOCKED_BY_CSP, 'blob:erfana-preview://deadbeef/uuid', false, 'frame-remote', 'blob:'],
    [ERR_BLOCKED_BY_CSP, 'https://evil.example/p?token=1', true, 'frame-link-blocked', 'https://evil.example']
  ])('code %i on %s (committed before: %s) → %s, %s', (code, url, committedBefore, type, address) => {
    expect(failed(code, url, committedBefore)).toEqual({ type, address })
  })

  it.each([ERR_BLOCKED_BY_CLIENT, ERR_ABORTED, 0, -2])(
    'lists nothing for code %i: the filter and the load-state path own those',
    (code) => {
      expect(failed(code, 'https://example.com/')).toBeNull()
    }
  )

  it("lists nothing for this view's own token or about: frames", () => {
    expect(failed(ERR_BLOCKED_BY_CSP, own('/child.html'))).toBeNull()
    expect(failed(ERR_BLOCKED_BY_CSP, 'about:blank')).toBeNull()
  })

  it('a bad own token refuses every src frame with -30, and each is listed (WI-13)', () => {
    expect(failed(ERR_BLOCKED_BY_CSP, own('/child.html'), false, 'bad token')).toEqual({
      type: 'frame-escape',
      address: own('/child.html')
    })
  })
})

describe('helpers', () => {
  it('recognises the srcdoc document URL only', () => {
    expect(isSrcdocUrl('about:srcdoc')).toBe(true)
    expect(isSrcdocUrl('about:srcdoc#top')).toBe(true)
    expect(isSrcdocUrl('about:srcdocx')).toBe(false)
    expect(isSrcdocUrl('about:blank')).toBe(false)
  })

  it('recognises the about:blank document URL only', () => {
    expect(isAboutBlankUrl('about:blank')).toBe(true)
    expect(isAboutBlankUrl('about:blank#top')).toBe(true)
    expect(isAboutBlankUrl('about:blankx')).toBe(false)
    expect(isAboutBlankUrl('about:srcdoc')).toBe(false)
  })

  it('names -30 and -27 as refusals, and nothing else', () => {
    expect(isRefusedFrameCode(ERR_BLOCKED_BY_CSP)).toBe(true)
    expect(isRefusedFrameCode(ERR_BLOCKED_BY_RESPONSE)).toBe(true)
    expect(isRefusedFrameCode(ERR_BLOCKED_BY_CLIENT)).toBe(false)
  })

  it('matches the own token exactly, by the CSP builder’s grammar', () => {
    expect(isOwnPreviewToken(OWN_TOKEN, OWN_TOKEN)).toBe(true)
    expect(isOwnPreviewToken(OTHER_TOKEN, OWN_TOKEN)).toBe(false)
    expect(isOwnPreviewToken('', '')).toBe(false)
  })
})
