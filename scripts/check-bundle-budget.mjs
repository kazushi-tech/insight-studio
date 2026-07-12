import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const DIST_DIR = join(process.cwd(), 'dist')
const ASSET_DIR = join(DIST_DIR, 'assets')
const KIB = 1024
const budgets = {
  entry: 85 * KIB,
  totalJavaScript: 460 * KIB,
  motionChunk: 22 * KIB,
}

const indexHtml = await readFile(join(DIST_DIR, 'index.html'), 'utf8')
const entryMatch = indexHtml.match(/<script[^>]+src="\/assets\/(index-[^"]+\.js)"/)
if (!entryMatch) {
  throw new Error('Could not find the production entry script in dist/index.html')
}

const files = (await readdir(ASSET_DIR)).filter((file) => file.endsWith('.js'))
const sizes = new Map()
for (const file of files) {
  const contents = await readFile(join(ASSET_DIR, file))
  sizes.set(file, gzipSync(contents, { level: 9 }).byteLength)
}

const entryFile = entryMatch[1]
const entryBytes = sizes.get(entryFile)
const totalBytes = [...sizes.values()].reduce((sum, value) => sum + value, 0)
const motionChunks = [...sizes.entries()].filter(([file]) => /motion/i.test(file))
const failures = []

if (entryBytes == null) failures.push(`Entry chunk ${entryFile} is missing`)
else if (entryBytes > budgets.entry) failures.push(`Entry ${entryFile}: ${(entryBytes / KIB).toFixed(2)} KiB > 85 KiB`)
if (totalBytes > budgets.totalJavaScript) failures.push(`All JS: ${(totalBytes / KIB).toFixed(2)} KiB > 460 KiB`)
if (motionChunks.length === 0) failures.push('No separately loadable Motion chunk was emitted')
for (const [file, bytes] of motionChunks) {
  if (bytes > budgets.motionChunk) failures.push(`Motion ${file}: ${(bytes / KIB).toFixed(2)} KiB > 22 KiB`)
}

console.log(`Entry JS gzip: ${(entryBytes / KIB).toFixed(2)} KiB (${entryFile})`)
console.log(`All JS gzip: ${(totalBytes / KIB).toFixed(2)} KiB across ${files.length} chunks`)
for (const [file, bytes] of motionChunks) {
  console.log(`Motion gzip: ${(bytes / KIB).toFixed(2)} KiB (${file})`)
}

if (failures.length) {
  throw new Error(`Bundle budget failed:\n- ${failures.join('\n- ')}`)
}
