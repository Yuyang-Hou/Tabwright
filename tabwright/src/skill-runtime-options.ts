import { toCapabilityContract } from './skill-runtime.js'
import {
  discoverAgentSkillCapabilities,
  type AgentSkillRoot,
  type DiscoveredAgentSkillCapability,
} from './agent-skill-discovery.js'

export type SkillRuntimeOptionsItem = Record<string, unknown>

export interface SkillRuntimeOptionsListResponse {
  cwd: string
  capabilities: SkillRuntimeOptionsItem[]
}

export interface SkillRuntimeOptionsDetailResponse {
  cwd: string
  capability: SkillRuntimeOptionsItem
}

export function listSkillRuntimeOptions(options: {
  cwd: string
  agentSkillRoots?: AgentSkillRoot[]
}): SkillRuntimeOptionsListResponse {
  const agentSkills = discoverAgentSkillCapabilities({ cwd: options.cwd, roots: options.agentSkillRoots })
  return {
    cwd: options.cwd,
    capabilities: agentSkills.map((agentSkill) => {
      return toAgentSkillOptionsItem(agentSkill)
    }),
  }
}

export function getSkillRuntimeOptionsDetail(options: {
  cwd: string
  id: string
  agentSkillRoots?: AgentSkillRoot[]
}): SkillRuntimeOptionsDetailResponse | null {
  const capability = listSkillRuntimeOptions({
    cwd: options.cwd,
    agentSkillRoots: options.agentSkillRoots,
  }).capabilities.find((candidate) => {
    return candidate.id === options.id
  })
  if (!capability) {
    return null
  }
  return {
    cwd: options.cwd,
    capability,
  }
}

function toAgentSkillOptionsItem(agentSkill: DiscoveredAgentSkillCapability): SkillRuntimeOptionsItem {
  return {
    ...toCapabilityContract(agentSkill.capability),
    description: agentSkill.description || agentSkill.capability.manifest.description,
    agentSkill: {
      installations: agentSkill.installations.map((installation) => {
        return {
          manager: installation.manager,
          scope: installation.scope,
          skillDir: installation.skillDir,
          runtimeDir: installation.runtimeDir,
        }
      }),
      hasRuntimeConflict: agentSkill.hasRuntimeConflict,
      localState: agentSkill.localState,
    },
  }
}
