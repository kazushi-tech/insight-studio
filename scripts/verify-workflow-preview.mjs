import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createBuilder } from 'vite'

process.env.WORKFLOW_VITE_ENABLED = 'true'
process.env.WORKFLOW_SUITABILITY_ENABLED = 'true'
process.env.WORKFLOW_SUITABILITY_TOKEN = 'preview-only-build-token-32-bytes-minimum'
process.env.VERCEL_ENV = 'preview'

const builder = await createBuilder({ mode: 'production' })
await builder.buildApp()

const outputRoot = join(process.cwd(), '.vercel', 'output')
const functionsRoot = join(outputRoot, 'functions')
await access(functionsRoot)
const outputEntries = await readdir(functionsRoot, { recursive: true })
if (!outputEntries.some((entry) => String(entry).includes('.func'))) {
  throw new Error('Preview Workflow compile emitted no Vercel server function')
}
const config = JSON.parse(await readFile(join(outputRoot, 'config.json'), 'utf8'))
if (config.version !== 3) {
  throw new Error('Preview Workflow compile did not emit Vercel Build Output API v3')
}
console.log('Preview-only Nitro + Workflow server compile passed.')
