// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * 025-FR-040: the browser ships on for everyone, with no setting, feature flag
 * or hidden switch that turns it off. This walks every key of the settings
 * schemas (global `~/.erfana/settings.json`, project `.erfana/settings.json`)
 * and the app store's `Settings` interface, and fails on any key that names
 * the browser.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { GlobalSettingsSchema, getDefaultGlobalSettings } from '../ipc/global-settings-schema'
import { ProjectSettingsSchema } from '../ipc/project-settings-schema'

/** Every object key reachable in a zod schema, as dotted paths. */
function keyPaths(schema: z.ZodType, prefix = ''): string[] {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> } })._zod.def
  if (def.type === 'object') {
    const shape = (schema as unknown as z.ZodObject).shape as Record<string, z.ZodType>
    return Object.entries(shape).flatMap(([k, v]) => [`${prefix}${k}`, ...keyPaths(v, `${prefix}${k}.`)])
  }
  const inner = (def.innerType ?? def.in ?? def.element ?? def.schema) as z.ZodType | undefined
  const options = (def.options ?? []) as z.ZodType[]
  return [...(inner ? keyPaths(inner, prefix) : []), ...options.flatMap(o => keyPaths(o, prefix))]
}

const BROWSER_SWITCH = /browser|webview|builtin.?web|inapp.?web/i

describe('no switch turns the browser off (025-FR-040)', () => {
  it('025-AC-040 the settings schemas hold no key that names the browser', () => {
    const paths = [...keyPaths(GlobalSettingsSchema), ...keyPaths(ProjectSettingsSchema)]
    expect(paths.length).toBeGreaterThan(20)
    expect(paths.filter(p => BROWSER_SWITCH.test(p))).toEqual([])
  })

  it('025-AC-040 the app store (SettingsService) declares no browser key', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'main', 'services', 'SettingsService.ts'), 'utf8')
    const body = /interface Settings \{([^}]*)\}/.exec(source)?.[1]
    expect(body).toBeDefined()
    expect(body).not.toMatch(BROWSER_SWITCH)
  })

  it('025-AC-040 the default global settings hold no browser key either', () => {
    const json = JSON.stringify(getDefaultGlobalSettings())
    expect(json).not.toMatch(BROWSER_SWITCH)
  })

  it('025-AC-040 the key walk would catch a browser switch if one were added', () => {
    const planted = GlobalSettingsSchema.extend({ tools: z.object({ builtInBrowser: z.object({ enabled: z.boolean() }) }).optional() })
    expect(keyPaths(planted).filter(p => BROWSER_SWITCH.test(p))).toEqual(['tools.builtInBrowser', 'tools.builtInBrowser.enabled'])
  })
})
