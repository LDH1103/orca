import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  createManagedCommandMatcher,
  getSharedManagedScriptPath,
  isPlainObject,
  MANAGED_HOOK_TIMEOUT_SECONDS,
  wrapPosixHookCommand,
  wrapWindowsCmdHookCommand
} from '../agent-hooks/installer-utils'

const KIRO_SCRIPT_BASE = 'kiro-hook'

/**
 * Lifecycle triggers kiro-cli V3 fires from standalone `.kiro/hooks/*.json` files, captured
 * from a real `kiro-cli chat --tui --v3` session (2.27.0). Kiro uses Claude's names here, not
 * the `PromptSubmit`/`AgentStop` spelling its docs show: 2.27 drops entries with those
 * triggers when it loads the file, so they never fire.
 */
export const KIRO_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
  'SessionEnd'
] as const

export type KiroHooksFile = {
  version?: unknown
  hooks?: unknown
  [key: string]: unknown
}

export function getKiroHooksFilePath(): string {
  // Why a file of its own: kiro-cli V3 loads every `~/.kiro/hooks/*.json`, so Orca never has
  // to edit an agent config the user (or a dotfiles installer) owns.
  return join(homedir(), '.kiro', 'hooks', 'orca-agent-status.json')
}

export function getKiroRemoteHooksFilePath(remoteHome: string): string {
  return `${remoteHome.replace(/\/$/, '')}/.kiro/hooks/orca-agent-status.json`
}

export function getKiroManagedScriptFileName(): string {
  return process.platform === 'win32' ? `${KIRO_SCRIPT_BASE}.cmd` : `${KIRO_SCRIPT_BASE}.sh`
}

export function getKiroPosixManagedScriptFileName(): string {
  return `${KIRO_SCRIPT_BASE}.sh`
}

export function getKiroManagedScriptPath(): string {
  return getSharedManagedScriptPath(getKiroManagedScriptFileName())
}

export function getKiroManagedCommand(scriptPath: string): string {
  if (process.platform === 'win32') {
    // Why: Kiro runs a `command` action through a shell, so the bare .cmd is enough on a safe
    // path; anything else falls back to the encoded PowerShell launcher.
    return wrapWindowsCmdHookCommand(scriptPath)
  }
  return wrapPosixHookCommand(scriptPath)
}

export function getKiroRemoteManagedCommand(scriptPath: string): string {
  return wrapPosixHookCommand(scriptPath)
}

export function buildKiroHooksFile(command: string): KiroHooksFile {
  return {
    version: 'v1',
    hooks: KIRO_HOOK_EVENTS.map((trigger) => ({
      name: `orca-agent-status-${trigger}`,
      trigger,
      action: { type: 'command', command },
      timeout: MANAGED_HOOK_TIMEOUT_SECONDS
    }))
  }
}

/** Triggers in `file` whose action runs Orca's managed Kiro script. */
export function readManagedKiroHookEvents(file: KiroHooksFile): Set<string> {
  const isManagedCommand = createManagedCommandMatcher(getKiroManagedScriptFileName())
  const present = new Set<string>()
  if (!Array.isArray(file.hooks)) {
    return present
  }
  for (const entry of file.hooks) {
    if (!isPlainObject(entry) || typeof entry.trigger !== 'string') {
      continue
    }
    const action = entry.action
    if (
      isPlainObject(action) &&
      typeof action.command === 'string' &&
      isManagedCommand(action.command)
    ) {
      present.add(entry.trigger)
    }
  }
  return present
}
