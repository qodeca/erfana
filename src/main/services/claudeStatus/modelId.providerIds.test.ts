// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * modelId — cloud-platform model ids (#49).
 *
 * Split out of `modelId.test.ts` (already 769 lines). Amazon Bedrock and Google
 * Cloud's Agent Platform (Vertex AI) wrap the Claude id in their own syntax, and
 * before #49 every such id failed the `^claude-` grammar: the meter fell back to
 * 200k, the label showed the raw id, and a `/model` selection was dropped.
 *
 * Every fixture below is a format copied from the platform's documentation:
 *  - Bedrock ids and prefixes: https://platform.claude.com/docs/en/build-with-claude/claude-in-amazon-bedrock,
 *    https://platform.claude.com/docs/en/build-with-claude/claude-on-amazon-bedrock-legacy and
 *    https://code.claude.com/docs/en/amazon-bedrock (`us.`, `eu.`, `apac.`, `jp.`, `au.`,
 *    `global.`, `us-gov.`; the `inference-profile/` ARN form).
 *  - Vertex `@date` ids: https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai
 *  - Foundry: deployments default to the bare Claude API id
 *    (https://code.claude.com/docs/en/microsoft-foundry), so it needs no normalisation;
 *    a custom deployment name is an unknown id and must still fall back safely.
 *
 * The oracle is the BARE id each one wraps: a provider id must resolve exactly
 * like it, which keeps these tests from restating the registry's windows.
 *
 * @see Issue #49 - Model ids from Bedrock, Vertex and Foundry are not recognised
 */
import { describe, it, expect } from 'vitest'
import {
  isRecognisedModelId,
  parseModelId,
  stickyModelKey,
  stripModelVariants,
  windowForModelId,
  MAX_PROVIDER_MODEL_ID_LENGTH
} from './modelId'
import { friendlyModelName } from './friendlyModelName'
import { MAX_MODEL_ID_LENGTH } from '../../../shared/ipc/claude-status-schema'

/** A Bedrock account id as documented in ARN examples. */
const ACCOUNT = '123456789012'

/** [provider id, the bare id it must resolve like]. */
const PROVIDER_IDS: ReadonlyArray<[provider: string, bare: string]> = [
  // Claude in Amazon Bedrock (Messages API): `anthropic.` vendor prefix.
  ['anthropic.claude-opus-4-8', 'claude-opus-4-8'],
  ['anthropic.claude-sonnet-5', 'claude-sonnet-5'],
  ['anthropic.claude-haiku-4-5', 'claude-haiku-4-5'],
  ['anthropic.claude-opus-5', 'claude-opus-5'],
  ['anthropic.claude-mythos-preview', 'claude-mythos-preview'],
  // Cross-region inference profiles: a geography in front of the vendor.
  ['us.anthropic.claude-opus-4-8', 'claude-opus-4-8'],
  ['eu.anthropic.claude-opus-5', 'claude-opus-5'],
  ['global.anthropic.claude-opus-4-6-v1', 'claude-opus-4-6'],
  ['apac.anthropic.claude-sonnet-4-20250514-v1:0', 'claude-sonnet-4-20250514'],
  ['jp.anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6'],
  ['au.anthropic.claude-haiku-4-5', 'claude-haiku-4-5'],
  ['us-gov.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5-20250929'],
  // Legacy InvokeModel ids with a Bedrock version suffix.
  ['anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-haiku-4-5-20251001'],
  ['us.anthropic.claude-haiku-4-5-20251001-v1:0', 'claude-haiku-4-5-20251001'],
  ['anthropic.claude-opus-4-5-20251101-v1:0', 'claude-opus-4-5-20251101'],
  // Full ARNs whose resource id is a Claude id.
  [
    `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`,
    'claude-sonnet-4-5-20250929'
  ],
  [
    'arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
    'claude-haiku-4-5-20251001'
  ],
  [
    `arn:aws-us-gov:bedrock:us-gov-west-1:${ACCOUNT}:inference-profile/us-gov.anthropic.claude-opus-4-8`,
    'claude-opus-4-8'
  ],
  // An undecomposable id behind an ARN: the label must still be the bare id.
  [
    `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.claude-mythos-preview`,
    'claude-mythos-preview'
  ],
  // Google Cloud's Agent Platform (Vertex AI): `@` before the pinned date.
  ['claude-haiku-4-5@20251001', 'claude-haiku-4-5-20251001'],
  ['claude-sonnet-4-5@20250929', 'claude-sonnet-4-5-20250929'],
  ['claude-opus-4-5@20251101', 'claude-opus-4-5-20251101'],
  ['claude-opus-4-1@20250805', 'claude-opus-4-1-20250805'],
  // Casing and surrounding whitespace behave as for a bare id.
  ['  US.Anthropic.Claude-Opus-4-8  ', 'claude-opus-4-8']
]

/**
 * Rows whose bare id the grammar decomposes / the registry sizes. Comparing a
 * provider id with a bare id that is ALSO null would pass whatever the
 * provider id did, so those comparisons run only where there is a value.
 */
const DECOMPOSABLE = PROVIDER_IDS.filter(([, bare]) => parseModelId(bare) !== null)
const SIZED = PROVIDER_IDS.filter(([, bare]) => windowForModelId(bare) !== null)

describe('provider ids resolve exactly like the bare id they wrap', () => {
  it('the comparison sets are not vacuous', () => {
    // Pins the filters: if the registry stops sizing these rows, say so here
    // rather than silently comparing fewer of them.
    expect(DECOMPOSABLE.length).toBe(PROVIDER_IDS.length - 2) // the two mythos-preview rows
    expect(SIZED.length).toBe(PROVIDER_IDS.length - 2) // sonnet-4 and opus-4-1: no row, no heuristic
  })

  it.each(DECOMPOSABLE)('%s parses like %s', (provider, bare) => {
    const parsed = parseModelId(provider)
    expect(parsed).not.toBeNull()
    expect(parsed).toEqual(parseModelId(bare))
  })

  it.each(PROVIDER_IDS)('%s normalises to %s', (provider, bare) => {
    expect(stripModelVariants(provider)?.base).toBe(bare)
  })

  it.each(SIZED)('%s gets the window of %s', (provider, bare) => {
    const window = windowForModelId(provider)
    expect(window).not.toBeNull()
    expect(window).toBe(windowForModelId(bare))
  })

  it.each(PROVIDER_IDS)('%s gets the label of %s', (provider, bare) => {
    expect(friendlyModelName(provider)).toBe(friendlyModelName(bare))
  })

  it.each(PROVIDER_IDS)('%s shares the sticky key of %s', (provider, bare) => {
    expect(stickyModelKey(provider)).toBe(stickyModelKey(bare))
  })

  it.each(PROVIDER_IDS)('%s is recognised', (provider) => {
    expect(isRecognisedModelId(provider)).toBe(true)
  })

  it('reaches the 1M window and a friendly label for the issue examples', () => {
    // The literal reproduction from #49: each of these was 200k, raw-labelled.
    expect(windowForModelId('us.anthropic.claude-opus-4-8')).toBe(1_000_000)
    expect(friendlyModelName('us.anthropic.claude-opus-4-8')).toBe('Opus 4.8')
    expect(windowForModelId('anthropic.claude-sonnet-5')).toBe(1_000_000)
    expect(friendlyModelName('anthropic.claude-sonnet-5')).toBe('Sonnet 5')
    expect(windowForModelId('anthropic.claude-mythos-preview')).toBe(1_000_000)
  })

  it('keeps a [1m] variant on a provider id', () => {
    expect(stripModelVariants('us.anthropic.claude-opus-4-6-v1[1m]')).toEqual({
      base: 'claude-opus-4-6',
      variants: ['1m']
    })
    expect(windowForModelId('us.anthropic.claude-opus-4-6-v1[1m]')).toBe(1_000_000)
  })

  it('labels an ARN longer than the display bound by the model it names', () => {
    const arn = `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.claude-sonnet-4-5-20250929-v1:0`
    expect(arn.length).toBeGreaterThan(MAX_MODEL_ID_LENGTH)
    expect(friendlyModelName(arn)).toBe('Sonnet 4.5')
  })

  it('labels an undecomposable id by its normalised form, variant and casing dropped', () => {
    // Intended (#49 review): the label of a registry-named id no longer echoes
    // a bracket variant or the source casing.
    expect(friendlyModelName('claude-mythos-preview[1m]')).toBe('claude-mythos-preview')
    expect(friendlyModelName('CLAUDE-MYTHOS-PREVIEW')).toBe('claude-mythos-preview')
  })
})

describe('ids that still cannot be read fall back safely', () => {
  const unreadable: ReadonlyArray<[label: string, id: string]> = [
    // Documented: a Foundry deployment may carry any name.
    ['a custom Foundry deployment name', 'team-opus-prod'],
    ['another vendor on Bedrock', 'meta.llama3-70b-instruct-v1:0'],
    ['a vendor prefix behind a non-geography', 'us.east.anthropic.claude-opus-4-8'],
    ['a vendor prefix behind an undocumented geography', 'openai.anthropic.claude-opus-5'],
    ['a Bedrock version suffix on a BARE id', 'claude-opus-4-8-v1:0'],
    ['a Vertex @ without an 8-digit date', 'claude-opus-4-8@latest'],
    ['a vendor prefix and nothing else', 'anthropic.'],
    // The pre-#41 naming: still outside the grammar, now an honest guess.
    ['an old-style family-last id', 'claude-3-7-sonnet-20250219']
  ]

  it.each(unreadable)('%s has no window opinion, a raw label and is not recognised', (_label, id) => {
    expect(parseModelId(id)).toBeNull()
    expect(windowForModelId(id)).toBeNull()
    expect(isRecognisedModelId(id)).toBe(false)
    expect(friendlyModelName(id)).toBe(id.slice(0, MAX_MODEL_ID_LENGTH))
  })

  const unreadableArns: ReadonlyArray<[name: string, id: string, expected: string]> = [
    // Documented: an application inference profile ARN names no model.
    [
      'an application-inference-profile ARN',
      `arn:aws:bedrock:us-east-2:${ACCOUNT}:application-inference-profile/opus-47-prod`,
      'arn:aws:bedrock:us-east-2:[redacted-account]:application-inferen'
    ],
    [
      'an ARN with no resource id',
      `arn:aws:bedrock:us-east-1:${ACCOUNT}:`,
      'arn:aws:bedrock:us-east-1:[redacted-account]:'
    ],
    // Another AWS service never maps, even when its resource looks like a model.
    ['an S3 ARN', 'arn:aws:s3:::bucket/claude-opus-5', 'arn:aws:s3:::bucket/claude-opus-5'],
    // A model ARN whose resource is not a Claude id labels as that resource.
    [
      'an inference-profile ARN naming an unknown model',
      `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/us.anthropic.claude-foo`,
      'claude-foo'
    ]
  ]

  it.each(unreadableArns)('%s is unread, and its label never shows the account id', (_name, id, expected) => {
    expect(parseModelId(id)).toBeNull()
    expect(windowForModelId(id)).toBeNull()
    expect(isRecognisedModelId(id)).toBe(false)
    expect(friendlyModelName(id)).toBe(expected)
    expect(friendlyModelName(id)).not.toContain(ACCOUNT)
    expect(friendlyModelName(id).length).toBeLessThanOrEqual(MAX_MODEL_ID_LENGTH)
  })

  it('a bare alias is not a recognised id (it names a family, not a window)', () => {
    expect(isRecognisedModelId('opus')).toBe(false)
  })

  it('never throws for a non-string', () => {
    expect(isRecognisedModelId(undefined as unknown as string)).toBe(false)
    expect(isRecognisedModelId(42 as unknown as string)).toBe(false)
  })
})

describe('provider normalisation keeps parsing bounded (#49, design §11)', () => {
  it('rejects input over the provider bound before any work', () => {
    const arn = `arn:aws:bedrock:us-east-1:${ACCOUNT}:inference-profile/${'a'.repeat(MAX_PROVIDER_MODEL_ID_LENGTH)}`
    expect(arn.length).toBeGreaterThan(MAX_PROVIDER_MODEL_ID_LENGTH)
    expect(stripModelVariants(arn)).toBeNull()
  })

  it('holds the NORMALISED id to the IPC bound, so nothing longer reaches the wire', () => {
    const long = `us.anthropic.claude-opus-4-8-${'a'.repeat(MAX_MODEL_ID_LENGTH)}`
    expect(long.length).toBeLessThanOrEqual(MAX_PROVIDER_MODEL_ID_LENGTH)
    expect(stripModelVariants(long)).toBeNull()
  })

  it('every base it returns fits the IPC bound', () => {
    for (const [provider] of PROVIDER_IDS) {
      const stripped = stripModelVariants(provider)
      expect(stripped?.base.length).toBeLessThanOrEqual(MAX_MODEL_ID_LENGTH)
    }
  })

  it('strips ONE provider prefix, never a stack of them', () => {
    // Normalisation is a single pass, not a loop, so a stacked prefix stays
    // unparseable instead of being peeled to a valid id. Kept under the IPC
    // bound so that the length cap cannot be what rejects it.
    const stacked = 'us.anthropic.us.anthropic.claude-opus-4-8'
    expect(stacked.length).toBeLessThan(MAX_MODEL_ID_LENGTH)
    expect(parseModelId(stacked)).toBeNull()
    expect(windowForModelId(stacked)).toBeNull()
    expect(isRecognisedModelId(stacked)).toBe(false)
  })
})
