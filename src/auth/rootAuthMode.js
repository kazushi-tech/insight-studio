export function resolveRootAuthMode({ key, isProduction }) {
  if (key) return 'clerk'
  return isProduction ? 'configuration_error' : 'legacy_development'
}
