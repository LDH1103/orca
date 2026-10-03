import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as NodeOs from 'node:os'

const hoisted = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeOs>()
  return { ...actual, homedir: () => hoisted.home }
})
vi.mock('electron', () => ({ app: { getPath: () => hoisted.home } }))

import { kiroHookService } from './hook-service'
import { getKiroHooksFilePath, getKiroManagedScriptPath, KIRO_HOOK_EVENTS } from './hook-settings'

type KiroHookEntry = {
  name: string
  trigger: string
  action: { type: string; command: string }
  timeout?: number
}
type KiroHooksFile = { version?: string; hooks?: KiroHookEntry[] }

// Why no assertion: `JSON.parse` is already `any`, so the annotation narrows without a cast.
function readHooksFile(): KiroHooksFile {
  return JSON.parse(readFileSync(getKiroHooksFilePath(), 'utf-8'))
}

function writeHooksFile(content: string): void {
  mkdirSync(dirname(getKiroHooksFilePath()), { recursive: true })
  writeFileSync(getKiroHooksFilePath(), content)
}

beforeEach(() => {
  hoisted.home = mkdtempSync(join(tmpdir(), 'orca-kiro-'))
})
afterEach(() => {
  rmSync(hoisted.home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('KiroHookService', () => {
  it('reports not_installed before any install', () => {
    expect(kiroHookService.getStatus()).toMatchObject({
      agent: 'kiro',
      state: 'not_installed',
      managedHooksPresent: false
    })
  })

  it('writes its own v1 hooks file under ~/.kiro/hooks with every lifecycle trigger', () => {
    const status = kiroHookService.install()
    expect(status).toMatchObject({ agent: 'kiro', state: 'installed', managedHooksPresent: true })
    expect(getKiroHooksFilePath()).toBe(
      join(hoisted.home, '.kiro', 'hooks', 'orca-agent-status.json')
    )
    const file = readHooksFile()
    expect(file.version).toBe('v1')
    expect(file.hooks?.map((entry) => entry.trigger)).toEqual([...KIRO_HOOK_EVENTS])
    for (const entry of file.hooks ?? []) {
      expect(entry.action.type).toBe('command')
      expect(entry.action.command).toContain('kiro-hook')
    }
    expect(readFileSync(getKiroManagedScriptPath(), 'utf-8')).toContain('/hook/kiro')
  })

  it('never registers the doc-only trigger names kiro-cli rejects', () => {
    kiroHookService.install()
    const triggers = readHooksFile().hooks?.map((entry) => entry.trigger)
    expect(triggers).not.toContain('PromptSubmit')
    expect(triggers).not.toContain('AgentStop')
  })

  it('is idempotent — a second install leaves the file byte-identical', () => {
    kiroHookService.install()
    const first = readFileSync(getKiroHooksFilePath(), 'utf-8')
    kiroHookService.install()
    expect(readFileSync(getKiroHooksFilePath(), 'utf-8')).toBe(first)
  })

  it('reports partial when the managed file lost some triggers', () => {
    kiroHookService.install()
    const file = readHooksFile()
    writeHooksFile(
      JSON.stringify({ ...file, hooks: file.hooks?.filter((entry) => entry.trigger !== 'Stop') })
    )
    expect(kiroHookService.getStatus()).toMatchObject({
      state: 'partial',
      managedHooksPresent: true,
      detail: 'events: Stop'
    })
  })

  it('reports an error for a hooks file it cannot parse', () => {
    writeHooksFile('{ "version": "v1", "hooks": ')
    expect(kiroHookService.getStatus()).toMatchObject({
      state: 'error',
      managedHooksPresent: false
    })
  })

  it('removes its own hooks file', () => {
    kiroHookService.install()
    const status = kiroHookService.remove()
    expect(existsSync(getKiroHooksFilePath())).toBe(false)
    expect(status).toMatchObject({ state: 'not_installed', managedHooksPresent: false })
  })

  it('leaves a same-named file alone when it does not run the Orca script', () => {
    const userFile = JSON.stringify({
      version: 'v1',
      hooks: [{ name: 'mine', trigger: 'Stop', action: { type: 'command', command: 'notify.sh' } }]
    })
    writeHooksFile(userFile)
    kiroHookService.remove()
    expect(readFileSync(getKiroHooksFilePath(), 'utf-8')).toBe(userFile)
  })
})
