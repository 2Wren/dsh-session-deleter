import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('the manifest is publishable and declares the DSH bundle', () => {
  assert.equal(manifest.name, 'dsh-session-deleter')
  assert.equal(manifest.private, undefined)
  assert.equal(manifest.license, 'MIT')
  assert.equal(typeof manifest.engines?.dsh, 'string')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(manifest.dsh?.client?.immediately, true)
  assert.ok(Array.isArray(manifest.files))
})

test('every declared export and packaged file exists', () => {
  for (const target of Object.values(manifest.exports)) {
    if (typeof target !== 'string' || target.includes('*')) continue
    assert.equal(existsSync(join(root, target)), true, `missing export target ${target}`)
  }
  for (const entry of manifest.files) {
    if (entry.includes('*')) continue
    assert.equal(existsSync(join(root, entry)), true, `missing packaged file ${entry}`)
  }
  assert.equal(existsSync(join(root, 'LICENSE')), true)
  assert.equal(existsSync(join(root, 'README.zh.md')), true)
})

test('the bundle patch inserts this package', () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, new RegExp(`name: ${manifest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
})

test('the icon is a self-contained SVG', () => {
  const icon = readFileSync(join(root, 'icon.svg'), 'utf8')
  assert.match(icon, /^<svg[\s>]/)
  assert.doesNotMatch(icon, /<script|<foreignObject|\sonload=/i)
  assert.ok(Buffer.byteLength(icon) < 256 * 1024)
})

test('locale metadata carries a title and description per language', () => {
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(readFileSync(join(root, `locale/${language}.json`), 'utf8'))
    assert.equal(typeof locale.meta?.title, 'string')
    assert.ok(locale.meta.title.length > 0)
    assert.equal(typeof locale.meta?.description, 'string')
    assert.ok(locale.meta.description.length > 0)
  }
})
