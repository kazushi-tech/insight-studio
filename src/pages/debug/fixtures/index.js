import discoverySample from './discovery-sample'
import discoveryMinimalMd from './discovery-minimal-md'

const REGISTRY = {
  'discovery-sample': discoverySample,
  'discovery-minimal-md': discoveryMinimalMd,
}

export function loadFixture(name) {
  return REGISTRY[name] ?? null
}

export function listFixtures() {
  return Object.keys(REGISTRY)
}
