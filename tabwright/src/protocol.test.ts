import { describe, expect, test } from 'vitest'
import {
  CURRENT_EXTENSION_FEATURES,
  EXTENSION_FEATURE,
  allowsExtensionFeature,
  parseExtensionFeatures,
  requiredExtensionFeatureForMethod,
  supportsExtensionFeature,
} from './protocol.js'

describe('extension feature negotiation', () => {
  test('treats a missing feature query as a legacy handshake', () => {
    expect(parseExtensionFeatures(undefined)).toBeUndefined()
    expect(
      supportsExtensionFeature({
        features: undefined,
        feature: EXTENSION_FEATURE.heartbeat,
      }),
    ).toBe(false)
    expect(
      allowsExtensionFeature({
        features: undefined,
        feature: EXTENSION_FEATURE.heartbeat,
      }),
    ).toBe(true)
    expect(
      allowsExtensionFeature({
        features: [],
        feature: EXTENSION_FEATURE.heartbeat,
      }),
    ).toBe(false)
  })

  test('deduplicates advertised features and ignores unknown values safely', () => {
    const features = parseExtensionFeatures(
      `${EXTENSION_FEATURE.heartbeat},future-feature-v9,${EXTENSION_FEATURE.heartbeat}`,
    )

    expect(features).toEqual([EXTENSION_FEATURE.heartbeat, 'future-feature-v9'])
    expect(
      supportsExtensionFeature({
        features,
        feature: EXTENSION_FEATURE.heartbeat,
      }),
    ).toBe(true)
    expect(CURRENT_EXTENSION_FEATURES).not.toContain('rrweb-recording-v1')
    expect(CURRENT_EXTENSION_FEATURES).not.toContain('activity-observation-v1')
    expect(requiredExtensionFeatureForMethod('createInitialTab')).toBe(EXTENSION_FEATURE.createInitialTab)
    expect(requiredExtensionFeatureForMethod('forwardCDPCommand')).toBeUndefined()
  })
})
