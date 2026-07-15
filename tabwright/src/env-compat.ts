const PREFIX_MAPPINGS = [
  ['TABWRIGHT_', 'PLAYWRITER_'],
] as const

PREFIX_MAPPINGS.map(([currentPrefix, legacyPrefix]) => {
  const currentEntries = Object.entries(process.env).filter(([name, value]) => {
    return name.startsWith(currentPrefix) && value !== undefined
  })
  const legacyEntries = Object.entries(process.env).filter(([name, value]) => {
    return name.startsWith(legacyPrefix) && value !== undefined
  })

  currentEntries.map(([name, value]) => {
    const legacyName = `${legacyPrefix}${name.slice(currentPrefix.length)}`
    if (process.env[legacyName] === undefined) {
      process.env[legacyName] = value
    }
    return legacyName
  })

  legacyEntries.map(([name, value]) => {
    const currentName = `${currentPrefix}${name.slice(legacyPrefix.length)}`
    if (process.env[currentName] === undefined) {
      process.env[currentName] = value
    }
    return currentName
  })
})
