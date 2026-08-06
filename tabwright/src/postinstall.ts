import { installTabwrightAgentSkill } from './tabwright-agent-skill.js'

try {
  const result = installTabwrightAgentSkill({ target: 'agents' })
  console.log(`[tabwright] Agent Skill ${result.fileStatus}: ${result.installedPath}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[tabwright] Agent Skill was not installed automatically: ${message}`)
  console.error('[tabwright] The CLI is installed. Run `tabwright skill install` to retry.')
}
