export function resolveRootAuthMode({ key }) {
  if (key) return 'clerk'
  return 'legacy'
}
