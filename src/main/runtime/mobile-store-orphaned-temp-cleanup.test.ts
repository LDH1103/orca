import { existsSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DeviceRegistry } from './device-registry'
import { MobileNotificationDismissalStore } from './mobile-notification-dismissal-store'
import { DEVICE_REGISTRY_FILENAME } from './mobile-pairing-files'

const dirs: string[] = []
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }))
})

it.each([
  [
    'dismissal store',
    'mobile-notification-dismissals.json',
    (dir: string) => new MobileNotificationDismissalStore(dir)
  ],
  ['device registry', DEVICE_REGISTRY_FILENAME, (dir: string) => new DeviceRegistry(dir)]
])(
  '%s reclaims temps orphaned by an interrupted write and keeps recent ones',
  async (_, fileName, open) => {
    const dir = mkdtempSync(join(tmpdir(), 'orca-orphaned-temp-'))
    dirs.push(dir)
    // Other-process PIDs: the sweep always spares this process's own temps.
    const orphaned = join(dir, `${fileName}.${process.pid + 1}.1784108697605.b306bb91.tmp`)
    const recent = join(dir, `${fileName}.${process.pid + 2}.${Date.now()}.cafef00d.tmp`)
    writeFileSync(orphaned, '[]')
    writeFileSync(recent, '[]')
    const twoDaysAgo = (Date.now() - 2 * 86400_000) / 1000
    utimesSync(orphaned, twoDaysAgo, twoDaysAgo)

    open(dir)

    await vi.waitFor(() => expect(existsSync(orphaned)).toBe(false))
    expect(existsSync(recent)).toBe(true)
  }
)
