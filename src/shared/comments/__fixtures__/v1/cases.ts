// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * The ten canonical v1 serializations (G-001). Each case is serialized with
 * its layout and must equal `<name>.block.txt` in this folder byte for byte.
 *
 * APPEND ONLY. These files are the v1 format as shipped (decision 22): editing
 * a case or its output changes what Erfana writes, which needs the spec, these
 * goldens and `../v1.lock.json` updated together, on purpose.
 */
import type { BlockLayout, CommentData } from '../../format'
import {
  ADA,
  BUTTON_ANCHOR,
  GRACE,
  LINE_SEP,
  LONE_HIGH,
  LONE_LOW,
  LRI,
  NUL,
  PDI,
  RLO,
  VIEW,
  ZWJ,
  ZWSP,
  BOM,
  ch,
  fixedId,
  makeComment,
  makeReply
} from '../commentTestData'

export interface GoldenCase {
  readonly name: string
  readonly layout: BlockLayout
  readonly data: CommentData
}

const LF: BlockLayout = { indent: '', eol: '\n' }

const HOSTILE_TEXT = [
  'Ends the comment: --> and --!> and opens one: <!--',
  '> starts with a bracket',
  '-> starts with an arrow',
  '--- three dashes, and a trailing <!-',
  '@data {"v":2}',
  '\\server\\share',
  '<<<<<<< HEAD',
  '=======',
  '|||||||  base',
  '>>>>>>> feature',
  '  @indented data',
  'ends with a dash -'
].join('\n')

const UNICODE_TEXT = [
  `Thumbs ${ch(0x1f44d)}${ch(0x1f3fd)} family ${ch(0x1f469)}${ZWJ}${ch(0x1f469)}${ZWJ}${ch(0x1f467)}`,
  `Combining e${ch(0x301)} and CJK ${ch(0x6f22)}${ch(0x5b57)}, Arabic ${ch(0x645)}${ch(0x631)}${ch(0x62d)}${ch(0x628)}${ch(0x627)}`,
  `Bidi ${RLO}evil${ch(0x202c)} ${LRI}isolate${PDI} zero${ZWSP}width BOM${BOM}`,
  `Controls NUL${NUL} BEL${String.fromCharCode(7)} DEL${String.fromCharCode(0x7f)} C1${String.fromCharCode(0x85)}`,
  `Separators${LINE_SEP}inside, lone ${LONE_HIGH} and ${LONE_LOW}`
].join('\n')

export const GOLDEN_CASES: readonly GoldenCase[] = [
  { name: '01-minimal', layout: LF, data: makeComment() },
  {
    name: '02-thread-resolved',
    layout: { indent: '    ', eol: '\n' },
    data: makeComment({
      status: 'resolved',
      resolved: { by: GRACE, at: '2026-10-27T08:00:00Z' },
      msgs: [
        makeComment().msgs[0],
        makeReply(1, 'Agreed, and fix the padding too.'),
        makeReply(2, 'Done in the stylesheet.', ADA)
      ]
    })
  },
  {
    name: '03-crlf-tab',
    layout: { indent: '\t\t', eol: '\r\n' },
    data: makeComment({
      id: fixedId('c-', 3),
      msgs: [{ ...makeComment().msgs[0], text: 'Line one.\r\nLine two.\n\nAfter a blank line.' }]
    })
  },
  {
    name: '04-cr-only',
    layout: { indent: '  ', eol: '\r' },
    data: makeComment({ id: fixedId('c-', 4) })
  },
  {
    name: '05-hostile-text',
    layout: { indent: '  ', eol: '\n' },
    data: makeComment({
      id: fixedId('c-', 5),
      msgs: [{ ...makeComment().msgs[0], text: HOSTILE_TEXT }]
    })
  },
  {
    name: '06-unicode',
    layout: LF,
    data: makeComment({
      id: fixedId('c-', 6),
      msgs: [
        {
          ...makeComment().msgs[0],
          by: { name: `Zo${ch(0xeb)} ${ch(0x5f20)}${ch(0x4f1f)}`, role: 'human' },
          text: UNICODE_TEXT
        }
      ]
    })
  },
  {
    name: '07-runtime-snapshot',
    layout: { indent: '      ', eol: '\n' },
    data: makeComment({
      id: fixedId('c-', 7),
      anchor: {
        tag: 'section',
        id: 'deck',
        path: 'html > body > section:nth-of-type(1)',
        runtime: {
          path: 'div:nth-of-type(3) > h2:nth-of-type(1)',
          tag: 'h2',
          quote: { exact: 'Slide 3 – pricing', prefix: '', suffix: 'Plans start at' },
          snapshot: '<h2 class="title">Slide 3 &ndash; pricing <!-- not a block --></h2>',
          truncated: true,
          snapshotSource: 'page'
        }
      },
      view: { ...VIEW, hash: '#3' }
    })
  },
  {
    name: '08-runtime-no-snapshot',
    layout: { indent: '    ', eol: '\n' },
    data: makeComment({
      id: fixedId('c-', 8),
      anchor: {
        tag: 'table',
        cls: ['prices'],
        path: 'html > body > table:nth-of-type(1)',
        runtime: {
          path: 'tbody:nth-of-type(1)',
          tag: 'tbody',
          quote: { exact: 'Basic 10 EUR Pro 20 EUR', prefix: 'Plans', suffix: '' },
          snapshotSource: 'page'
        }
      }
    })
  },
  {
    name: '09-anchor-quote-view',
    layout: { indent: '  ', eol: '\n' },
    data: makeComment({
      id: fixedId('c-', 9),
      anchor: {
        ...BUTTON_ANCHOR,
        id: 'buy-now',
        cls: ['cta', 'cta--primary', 'w-1/2'],
        quote: { exact: 'Buy now – <b>&amp;</b>', prefix: 'Pricing -- plans', suffix: '-->' }
      },
      view: { w: 390, h: 844, dpr: 3, x: -12.5, y: 2048, hash: '#pricing-->' }
    })
  },
  {
    name: '10-future-fields',
    layout: LF,
    data: {
      ...makeComment({
        id: fixedId('c-', 10),
        anchor: { ...BUTTON_ANCHOR, futureAnchor: { score: 0.5 } },
        msgs: [
          { ...makeComment().msgs[0], edited: '2026-10-25T15:00:00Z', futureMsg: [1, 2, 3] },
          {
            ...makeReply(3, 'An agent reply, reserved for later versions.'),
            by: { name: 'Agent', role: 'agent' }
          }
        ]
      }),
      futureRoot: { nested: { deeper: 'kept' } }
    }
  }
]
