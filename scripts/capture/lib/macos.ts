// SPDX-License-Identifier: GPL-3.0-only
// SPDX-FileCopyrightText: 2025-2026 Qodeca sp. z o.o.
/**
 * Real macOS input and the screen recorder for the README video (spec 023).
 * The video shows the real Open and Save dialogs and the real window picker
 * (023-FR-005, 023-FR-006), which Playwright cannot reach, so this module
 * drives them the way a person would: key presses through System Events and
 * a mouse click posted as a system event. It records the window area with
 * ffmpeg's AVFoundation screen input (023-FR-012).
 *
 * Every command runs with an argument array, never through a shell.
 */

import { type ElectronApplication } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFMPEG: string = require('ffmpeg-static')

function osa(script: string, lang = 'AppleScript'): string {
  return execFileSync('osascript', ['-l', lang, '-e', script], {
    encoding: 'utf8',
    timeout: 20_000
  }).trim()
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

/**
 * The app's process for System Events, by its process id: another Electron
 * app on the machine (another session's test run) has the same name.
 */
let appProcess = 'process "Electron"'

/** Make the app the frontmost one, so key presses reach its dialogs. */
export async function focusApp(app: ElectronApplication): Promise<void> {
  const pid = app.process().pid
  if (pid) appProcess = `(first process whose unix id is ${pid})`
  await app.evaluate(({ app: a, BrowserWindow }) => {
    a.focus({ steal: true })
    BrowserWindow.getAllWindows()[0]?.focus()
  })
}

/** Type text as key presses into the frontmost app. Quotes and backslashes are not supported. */
export function typeKeys(text: string): void {
  if (/["\\]/.test(text)) throw new Error('typeKeys: quotes and backslashes are not supported')
  osa(`tell application "System Events" to keystroke "${text}"`)
}

type Modifier = 'command' | 'control' | 'option' | 'shift'

/** Press one key by its macOS key code (36 Return, 53 Escape, 125 Down, 126 Up), with modifiers. */
export function pressKey(code: number, modifiers: Modifier[] = []): void {
  const using = modifiers.length ? ` using {${modifiers.map(m => `${m} down`).join(', ')}}` : ''
  osa(`tell application "System Events" to key code ${code}${using}`)
}

/** Press a character key with modifiers (⌘2, ⌃⌘S). */
export function pressChar(char: string, modifiers: Modifier[]): void {
  osa(
    `tell application "System Events" to keystroke "${char}" using {${modifiers.map(m => `${m} down`).join(', ')}}`
  )
}

export const KEY = { RETURN: 36, ESCAPE: 53, DOWN: 125, UP: 126 }

/**
 * Move the pointer to a global point (top-left origin, points) without a
 * click. The screen recorder draws the pointer even with `-capture_cursor 0`,
 * so the scene parks it outside the window.
 */
export function movePointer(x: number, y: number): void {
  osa(
    [
      'ObjC.import("CoreGraphics")',
      `var p = $.CGPointMake(${Math.round(x)}, ${Math.round(y)})`,
      '$.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, $.kCGEventMouseMoved, p, $.kCGMouseButtonLeft))'
    ].join('; '),
    'JavaScript'
  )
}

/** Move the pointer to a global point (top-left origin, points) and click there. */
export function clickAt(x: number, y: number): void {
  osa(
    [
      'ObjC.import("CoreGraphics")',
      `var p = $.CGPointMake(${Math.round(x)}, ${Math.round(y)})`,
      'function post(type) { $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateMouseEvent(null, type, p, $.kCGMouseButtonLeft)) }',
      'post($.kCGEventMouseMoved)',
      'delay(0.4)',
      'post($.kCGEventLeftMouseDown)',
      'delay(0.06)',
      'post($.kCGEventLeftMouseUp)'
    ].join('; '),
    'JavaScript'
  )
}

/** The roles of the top-level elements of the app's frontmost window (an open dialog). */
function dialogRoles(): string[] {
  return osa(
    `tell application "System Events" to tell ${appProcess} to get role of every UI element of window 1`
  ).split(', ')
}

/** The descriptions of those elements: the file area reads "List" in list view. */
function dialogDescriptions(): string[] {
  return osa(
    `tell application "System Events" to tell ${appProcess} to get description of every UI element of every UI element of window 1`
  ).split(', ')
}

/** The title of the app's frontmost window ('' when there is none). */
export function frontWindowTitle(): string {
  try {
    return osa(`tell application "System Events" to tell ${appProcess} to get name of window 1`)
  } catch {
    return ''
  }
}

/** Wait until a native dialog is the app's frontmost window: its title is not the main window's. */
export async function waitForDialog(mainTitle: string, timeout = 15_000): Promise<string> {
  const until = Date.now() + timeout
  for (;;) {
    const name = frontWindowTitle()
    if (name !== '' && name !== mainTitle) return name
    if (Date.now() > until) throw new Error(`no native dialog opened (front window: "${name}")`)
    await sleep(150)
  }
}

/** Wait until the main window is frontmost again (the dialog closed). */
export async function waitForDialogClosed(mainTitle: string, timeout = 15_000): Promise<void> {
  const until = Date.now() + timeout
  while (frontWindowTitle() !== mainTitle) {
    if (Date.now() > until)
      throw new Error(`the native dialog did not close (front window: "${frontWindowTitle()}")`)
    await sleep(150)
  }
}

/**
 * Off camera: put the open dialog in list view with its sidebar hidden. The
 * sidebar lists the operator's own folders and the column view the path from
 * the disk's root; list view of the project folder shows neither. The panel
 * remembers both settings, so the recorded dialog opens the same way.
 */
export async function tidyOpenDialog(): Promise<void> {
  pressChar('2', ['command'])
  await sleep(400)
  if (dialogRoles().includes('AXSplitter')) {
    pressChar('s', ['command', 'control'])
    await sleep(600)
  }
  if (dialogRoles().includes('AXSplitter'))
    throw new Error('the open dialog still shows its sidebar')
  if (!dialogDescriptions().includes('List')) throw new Error('the open dialog is not in list view')
}

/** Off camera: the save dialog with no sidebar (it lists the operator's folders when expanded). */
export async function tidySaveDialog(): Promise<void> {
  if (dialogRoles().includes('AXSplitter')) {
    pressChar('s', ['command', 'control'])
    await sleep(600)
  }
  if (dialogRoles().includes('AXSplitter'))
    throw new Error('the save dialog still shows its sidebar')
}

/** The AVFoundation screen inputs ("Capture screen N"), by device index. */
export function screenDevices(): number[] {
  let out = ''
  try {
    execFileSync(
      FFMPEG,
      ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  } catch (e) {
    out = String((e as { stderr?: string }).stderr ?? '')
  }
  return [...out.matchAll(/\[(\d+)\] Capture screen \d+/g)].map(m => Number(m[1]))
}

/**
 * The AVFoundation device that shows the window: with a magenta overlay up
 * in the window, the one whose pixel at `point` (device pixels, relative to
 * that screen) is magenta. Tries again until `timeout`, as the flash may
 * not have reached the screen yet.
 */
export async function deviceShowing(
  point: { x: number; y: number },
  timeout = 20_000
): Promise<number> {
  const devices = screenDevices()
  const until = Date.now() + timeout
  let seen: string[] = []
  for (;;) {
    seen = []
    for (const device of devices) {
      let raw: Buffer
      try {
        raw = execFileSync(
          FFMPEG,
          [
            '-hide_banner',
            '-loglevel',
            'error',
            '-f',
            'avfoundation',
            '-capture_cursor',
            '0',
            '-framerate',
            '30',
            '-i',
            `${device}:none`,
            '-frames:v',
            '1',
            '-vf',
            // The first frames can be stale: read the sixth.
            `select=gte(n\\,5),crop=2:2:${Math.round(point.x)}:${Math.round(point.y)}`,
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgb24',
            'pipe:1'
          ],
          { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000 }
        )
      } catch {
        seen.push(`${device}: no frame`)
        continue
      }
      seen.push(`${device}: rgb(${raw[0]}, ${raw[1]}, ${raw[2]})`)
      if (raw.length >= 3 && raw[0] > 200 && raw[1] < 60 && raw[2] > 200) return device
    }
    // The flash may not have reached the screen yet.
    if (Date.now() > until) break
    await sleep(300)
  }
  throw new Error(
    `no screen input shows the window at (${Math.round(point.x)}, ${Math.round(point.y)}): ${seen.join('; ')}`
  )
}

export interface Recorder {
  file: string
  stop: () => Promise<void>
}

/**
 * Record a rectangle of one screen, losslessly, at 30 frames a second, with
 * no pointer (the window picker's own highlight shows the pick).
 */
export async function startRecording(
  device: number,
  rect: { x: number; y: number; width: number; height: number },
  file: string
): Promise<Recorder> {
  const child: ChildProcess = spawn(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-framerate',
      '30',
      '-i',
      `${device}:none`,
      '-vf',
      `crop=${rect.width}:${rect.height}:${rect.x}:${rect.y}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-qp',
      '0',
      '-pix_fmt',
      'yuv444p',
      file
    ],
    { stdio: ['pipe', 'ignore', 'inherit'] }
  )
  const closed = new Promise<number | null>(resolve => child.on('close', resolve))
  // Wait until frames reach the file.
  const until = Date.now() + 15_000
  while (!(fs.existsSync(file) && fs.statSync(file).size > 0)) {
    if (child.exitCode !== null) throw new Error(`the screen recorder exited (${child.exitCode})`)
    if (Date.now() > until) throw new Error('the screen recorder wrote nothing in 15 s')
    await sleep(100)
  }
  return {
    file,
    stop: async () => {
      if (child.exitCode === null) child.stdin?.write('q')
      const timer = setTimeout(() => child.kill('SIGINT'), 10_000)
      await closed
      clearTimeout(timer)
    }
  }
}
