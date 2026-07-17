import {
  listCapabilities,
  toCapabilityContract,
  type CapabilityRecord,
} from './capability-registry.js'

export type CapabilityOptionsItem = Record<string, unknown>

export interface CapabilityOptionsListResponse {
  cwd: string
  capabilities: CapabilityOptionsItem[]
}

export interface CapabilityOptionsDetailResponse {
  cwd: string
  capability: CapabilityOptionsItem
}

export function listCapabilityOptions(options: { cwd: string }): CapabilityOptionsListResponse {
  return {
    cwd: options.cwd,
    capabilities: listCapabilities({ cwd: options.cwd }).map((capability) => {
      return toCapabilityOptionsItem(capability)
    }),
  }
}

export function getCapabilityOptionsDetail(options: {
  cwd: string
  id: string
}): CapabilityOptionsDetailResponse | null {
  const capability = listCapabilities({ cwd: options.cwd }).find((candidate) => {
    return candidate.manifest.id === options.id
  })
  if (!capability) {
    return null
  }
  return {
    cwd: options.cwd,
    capability: toCapabilityOptionsItem(capability),
  }
}

function toCapabilityOptionsItem(capability: CapabilityRecord): CapabilityOptionsItem {
  return toCapabilityContract(capability)
}
