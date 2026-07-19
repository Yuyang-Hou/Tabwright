import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getCapabilityAuthState, type CapabilityAuthStatus } from './capability-auth-state.js'
import {
  getCapabilityContractFingerprint,
  getCapabilityStateDir,
  readCapability,
  type CapabilityAuthType,
  type CapabilityRecord,
} from './capability-registry.js'

export type AgentSkillManager = 'codex' | 'agents' | 'claude' | 'custom'
export type AgentSkillScope = 'project' | 'user' | 'custom'

export interface AgentSkillRoot {
  dir: string
  manager: AgentSkillManager
  scope: AgentSkillScope
}

export interface AgentSkillInstallation {
  manager: AgentSkillManager
  scope: AgentSkillScope
  skillDir: string
  runtimeDir: string
  runtimeFingerprint?: string
}

export interface AgentSkillLocalState {
  stateDir: string
  auth: {
    type: CapabilityAuthType
    status: CapabilityAuthStatus
    canRefresh: boolean
    refreshedAt?: string
    expiresAt?: string
  }
  artifactCount: number
}

export interface DiscoveredAgentSkillCapability {
  capability: CapabilityRecord
  description: string
  installations: AgentSkillInstallation[]
  hasRuntimeConflict: boolean
  localState: AgentSkillLocalState
}

interface DiscoveredAgentSkillInstallation {
  capability: CapabilityRecord
  description: string
  installation: AgentSkillInstallation
}

export function getAgentSkillRoots(options: { cwd: string }): AgentSkillRoot[] {
  const homeDir = os.homedir()
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(homeDir, '.codex')
  const roots: AgentSkillRoot[] = [
    { dir: path.join(options.cwd, '.codex', 'skills'), manager: 'codex', scope: 'project' },
    { dir: path.join(options.cwd, '.agents', 'skills'), manager: 'agents', scope: 'project' },
    { dir: path.join(options.cwd, '.claude', 'skills'), manager: 'claude', scope: 'project' },
    { dir: path.join(codexHome, 'skills'), manager: 'codex', scope: 'user' },
    { dir: path.join(homeDir, '.agents', 'skills'), manager: 'agents', scope: 'user' },
    { dir: path.join(homeDir, '.claude', 'skills'), manager: 'claude', scope: 'user' },
    ...getExtraAgentSkillDirs().map((dir): AgentSkillRoot => {
      return { dir, manager: 'custom', scope: 'custom' }
    }),
  ]
  return roots.filter((root, index) => {
    return (
      roots.findIndex((candidate) => {
        return path.resolve(candidate.dir) === path.resolve(root.dir)
      }) === index
    )
  })
}

export function discoverAgentSkillCapabilities(options: {
  cwd: string
  roots?: AgentSkillRoot[]
}): DiscoveredAgentSkillCapability[] {
  const roots = options.roots || getAgentSkillRoots({ cwd: options.cwd })
  const discovered = roots.flatMap((root) => {
    return discoverAgentSkillsInRoot(root)
  })
  return discovered
    .filter((candidate, index) => {
      return (
        discovered.findIndex((other) => {
          return other.capability.manifest.id === candidate.capability.manifest.id
        }) === index
      )
    })
    .map((candidate) => {
      const installations = discovered
        .filter((other) => {
          return other.capability.manifest.id === candidate.capability.manifest.id
        })
        .map((other) => {
          return other.installation
        })
        .filter((installation, index, allInstallations) => {
          return (
            allInstallations.findIndex((other) => {
              return (
                other.manager === installation.manager &&
                other.scope === installation.scope &&
                path.resolve(other.skillDir) === path.resolve(installation.skillDir)
              )
            }) === index
          )
        })
      return {
        capability: candidate.capability,
        description: candidate.description,
        installations,
        hasRuntimeConflict:
          new Set(
            installations.flatMap((installation) => {
              return installation.runtimeFingerprint ? [installation.runtimeFingerprint] : []
            }),
          ).size > 1,
        localState: getAgentSkillLocalState(candidate.capability),
      }
    })
}

function getExtraAgentSkillDirs(): string[] {
  return (process.env.TABWRIGHT_SKILL_DIRS || '')
    .split(path.delimiter)
    .map((dir) => {
      return dir.trim()
    })
    .filter((dir) => {
      return dir.length > 0
    })
}

function discoverAgentSkillsInRoot(root: AgentSkillRoot): DiscoveredAgentSkillInstallation[] {
  if (!fs.existsSync(root.dir)) {
    return []
  }
  const entries: fs.Dirent[] = (() => {
    try {
      return fs.readdirSync(root.dir, { withFileTypes: true })
    } catch {
      return []
    }
  })()
  return entries
    .filter((entry) => {
      return isSkillDirectory({ rootDir: root.dir, entry })
    })
    .flatMap((entry) => {
      const skillDir = path.join(root.dir, entry.name)
      const runtimeDir = path.join(skillDir, 'runtime')
      if (!fs.existsSync(path.join(skillDir, 'SKILL.md')) || !fs.existsSync(path.join(runtimeDir, 'capability.json'))) {
        return []
      }
      const capability: CapabilityRecord | null = (() => {
        try {
          const manifestValue: unknown = JSON.parse(fs.readFileSync(path.join(runtimeDir, 'capability.json'), 'utf-8'))
          if (!isRecord(manifestValue) || typeof manifestValue.id !== 'string') {
            return null
          }
          return readCapability({
            dir: runtimeDir,
            stateDir: getCapabilityStateDir({ id: manifestValue.id }),
            target: runtimeDir,
            location: 'skill',
          })
        } catch {
          return null
        }
      })()
      if (!capability) {
        return []
      }
      const skillMetadata = readAgentSkillMetadata(skillDir)
      return [
        {
          capability,
          description: skillMetadata.description,
          installation: {
            manager: root.manager,
            scope: root.scope,
            skillDir,
            runtimeDir,
            runtimeFingerprint: (() => {
              try {
                return getCapabilityContractFingerprint(capability)
              } catch {
                return undefined
              }
            })(),
          },
        },
      ]
    })
}

function readAgentSkillMetadata(skillDir: string): { description: string } {
  const skillPath = path.join(skillDir, 'SKILL.md')
  const content: string = (() => {
    try {
      return fs.readFileSync(skillPath, 'utf-8')
    } catch {
      return ''
    }
  })()
  if (!content.startsWith('---')) {
    return { description: '' }
  }
  const frontmatterEnd = content.indexOf('\n---', 3)
  if (frontmatterEnd === -1) {
    return { description: '' }
  }
  const frontmatter = content.slice(3, frontmatterEnd)
  return { description: readFrontmatterScalar({ frontmatter, key: 'description' }) }
}

function readFrontmatterScalar(options: { frontmatter: string; key: string }): string {
  const match = options.frontmatter.match(new RegExp(`^${options.key}:\\s*(.+)$`, 'm'))
  const value = match?.[1]?.trim() || ''
  if (!value) {
    return ''
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : value
    } catch {
      return value.slice(1, -1)
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

function isSkillDirectory(options: { rootDir: string; entry: fs.Dirent }): boolean {
  if (options.entry.isDirectory()) {
    return true
  }
  if (!options.entry.isSymbolicLink()) {
    return false
  }
  try {
    return fs.statSync(path.join(options.rootDir, options.entry.name)).isDirectory()
  } catch {
    return false
  }
}

function getAgentSkillLocalState(capability: CapabilityRecord): AgentSkillLocalState {
  const auth = getCapabilityAuthState({ capability })
  return {
    stateDir: capability.stateDir,
    auth: {
      type: auth.type,
      status: auth.status,
      canRefresh: auth.canRefresh,
      refreshedAt: auth.refreshedAt,
      expiresAt: auth.expiresAt,
    },
    artifactCount: countArtifactFiles(path.join(capability.stateDir, 'artifacts')),
  }
}

function countArtifactFiles(dir: string): number {
  if (!fs.existsSync(dir)) {
    return 0
  }
  const entries: fs.Dirent[] = (() => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
  })()
  return entries.reduce((count, entry) => {
    if (entry.isDirectory()) {
      return count + countArtifactFiles(path.join(dir, entry.name))
    }
    return count + (entry.isFile() ? 1 : 0)
  }, 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
