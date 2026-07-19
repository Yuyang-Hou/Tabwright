import { listCapabilities, toCapabilityContract, type CapabilityRecord } from './capability-registry.js'
import {
  discoverAgentSkillCapabilities,
  type AgentSkillRoot,
  type DiscoveredAgentSkillCapability,
} from './agent-skill-discovery.js'

export type CapabilityOptionsItem = Record<string, unknown>

export interface CapabilityOptionsListResponse {
  cwd: string
  capabilities: CapabilityOptionsItem[]
}

export interface CapabilityOptionsDetailResponse {
  cwd: string
  capability: CapabilityOptionsItem
}

export function listCapabilityOptions(options: {
  cwd: string
  agentSkillRoots?: AgentSkillRoot[]
}): CapabilityOptionsListResponse {
  const agentSkills = discoverAgentSkillCapabilities({ cwd: options.cwd, roots: options.agentSkillRoots })
  const agentSkillIds = new Set(
    agentSkills.map((agentSkill) => {
      return agentSkill.capability.manifest.id
    }),
  )
  const registryCapabilities = listCapabilities({ cwd: options.cwd }).filter((capability) => {
    return !agentSkillIds.has(capability.manifest.id)
  })
  return {
    cwd: options.cwd,
    capabilities: [
      ...agentSkills.map((agentSkill) => {
        return toAgentSkillOptionsItem(agentSkill)
      }),
      ...registryCapabilities.map((capability) => {
        return toCapabilityOptionsItem(capability)
      }),
    ],
  }
}

export function getCapabilityOptionsDetail(options: {
  cwd: string
  id: string
  agentSkillRoots?: AgentSkillRoot[]
}): CapabilityOptionsDetailResponse | null {
  const capability = listCapabilityOptions({
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

function toAgentSkillOptionsItem(agentSkill: DiscoveredAgentSkillCapability): CapabilityOptionsItem {
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

function toCapabilityOptionsItem(capability: CapabilityRecord): CapabilityOptionsItem {
  return toCapabilityContract(capability)
}
