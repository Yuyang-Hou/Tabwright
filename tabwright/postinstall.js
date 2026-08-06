import childProcess from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const postinstallEntry = path.join(packageDir, 'dist', 'postinstall.js')

if (fs.existsSync(postinstallEntry)) {
  const result = childProcess.spawnSync(process.execPath, [postinstallEntry], { stdio: 'inherit' })
  if (result.error) {
    console.error(`[tabwright] Agent Skill postinstall could not start: ${result.error.message}`)
  }
  if (result.status !== null && result.status !== 0) {
    console.error('[tabwright] Agent Skill postinstall did not complete. Run `tabwright skill install` to retry.')
  }
}
