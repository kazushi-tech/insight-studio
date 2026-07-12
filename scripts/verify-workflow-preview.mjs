import { access, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuilder } from 'vite'

process.env.WORKFLOW_VITE_ENABLED = 'true'
process.env.WORKFLOW_SUITABILITY_ENABLED = 'true'
process.env.WORKFLOW_SUITABILITY_TOKEN = 'preview-only-build-token-32-bytes-minimum'
process.env.VERCEL_ENV = 'preview'
// Keep this framework contract deterministic on linked developer machines and
// unlinked CI runners. The Vercel adapter is exercised by Preview deployment.
process.env.NITRO_PRESET = 'node-server'

const builder = await createBuilder({ mode: 'production' })
await builder.buildApp()

// createBuilder() validates the framework-level Nitro + Workflow integration.
// Vercel's Build Output API directory is produced later by the Vercel adapter,
// so this CI contract must inspect Nitro's canonical build output instead.
const outputRoot = join(process.cwd(), '.output')
const serverRoot = join(outputRoot, 'server')
await Promise.all([
  access(join(outputRoot, 'nitro.json')),
  access(join(serverRoot, 'index.mjs')),
])

const outputEntries = (await readdir(serverRoot, { recursive: true }))
  .map((entry) => String(entry).replaceAll('\\', '/'))

if (!outputEntries.some((entry) => entry.includes('_libs/workflow.mjs'))) {
  throw new Error('Preview Workflow compile emitted no Workflow runtime')
}
if (!outputEntries.some((entry) => entry.includes('_routes/api/workflow_suitability'))) {
  throw new Error('Preview Workflow compile emitted no suitability start route')
}
if (!outputEntries.some((entry) => entry.includes('workflow_suitability/') && entry.endsWith('/cancel.mjs'))) {
  throw new Error('Preview Workflow compile emitted no suitability cancel route')
}

console.log('Preview-only Nitro + Workflow server compile passed.')
