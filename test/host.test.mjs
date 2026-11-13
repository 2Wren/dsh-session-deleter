import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { chmod, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  apply,
  deleteSession,
  DELETE_PATH,
  verifiedSessionDirectory,
} from '../index.js'
import {
  SESSION_ID,
  cacheStub,
  contextStub,
  fixture,
  registryStub,
} from '../test-support/fixtures.mjs'

test('cold deletion removes the log, projection cache, and accounting', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(id)
  const deletedCache = []
  const ctx = contextStub({ snapshot, registry, cache: cacheStub(deletedCache) })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 200)
  assert.deepEqual(result.body, { ok: true, sessionId: id })
  assert.equal(existsSync(dir), false)
  assert.deepEqual(registry.calls.archived, [id])
  assert.deepEqual(registry.calls.unarchived, [id])
  assert.deepEqual(registry.calls.unpinned, [id])
  assert.equal(registry.calls.detached, id)
  assert.deepEqual(deletedCache, [id])
})

test('a missing session reports 404', async () => {
  const ctx = contextStub({ snapshot: undefined, registry: registryStub(SESSION_ID) })
  const result = await deleteSession(ctx, SESSION_ID)
  assert.equal(result.status, 404)
  assert.equal(result.body.code, 'session/not-found')
})

test('a running session is refused and left on disk', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const ctx = contextStub({ snapshot, agent: { status: 'running' }, registry: registryStub(id) })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'session/running')
  assert.equal(existsSync(dir), true)
})

test('reported work in progress is refused with its items', async (t) => {
  const { root, id, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(id, {
    active: [{ kind: 'job', items: [{ id: 'job-1', label: 'build' }] }],
  })
  const ctx = contextStub({ snapshot, registry })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'session/active')
  assert.equal(result.body.activity[0].kind, 'job')
  assert.deepEqual(result.body.activity[0].items, ['build'])
})

test('an already-archived session still passes the active-work gate', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(id, { archived: true })
  const ctx = contextStub({
    snapshot,
    registry,
    activity: [{ kind: 'schedule', items: [{ id: 'reminder-1', label: 'daily report' }] }],
  })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'session/active')
  assert.deepEqual(registry.calls.archived, [])
  assert.equal(existsSync(dir), true)
})

test('a stored path outside the Session-owned directory is refused', async (t) => {
  const { root, id, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const foreign = { ...snapshot, location: { kind: 'jsonl', path: `${root}/unrelated/session.v4.jsonl.zstd` } }
  const ctx = contextStub({ snapshot: foreign, registry: registryStub(id) })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'session/path-unverified')
  assert.equal(verifiedSessionDirectory(foreign.location.path, id), undefined)
})

test('a mismatched stored header is refused', async (t) => {
  const { root, id, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const other = 'session-ffffffff-ffff-4fff-8fff-ffffffffffff'
  const ctx = contextStub({ snapshot: { ...snapshot, header: { id: other } }, registry: registryStub(id) })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 409)
  assert.equal(result.body.code, 'session/path-unverified')
})

test('a failed removal restores the transient archive', { skip: process.platform === 'win32' }, async (t) => {
  const { root, project, id, dir, snapshot } = await fixture()
  t.after(async () => {
    await chmod(project, 0o700).catch(() => {})
    await rm(root, { recursive: true, force: true })
  })
  const registry = registryStub(id)
  await chmod(project, 0o500)
  const ctx = contextStub({ snapshot, registry })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 500)
  assert.equal(result.body.code, 'session/delete-failed')
  assert.deepEqual(registry.calls.archived, [id])
  assert.deepEqual(registry.calls.unarchived, [id])
  assert.equal(existsSync(dir), true)
})

test('the deletion route validates media type, JSON, and Session id shape', async () => {
  let route
  const ctx = contextStub()
  ctx.connection = { fetch: { register(candidate) { route = candidate; return async () => {} } } }
  apply(ctx)
  assert.equal(route.path, DELETE_PATH)
  assert.deepEqual(route.methods, ['POST'])
  assert.equal(route.requestBody, 'buffered')

  const wrongType = await route.fetch(new Request('http://local/api/session.delete', {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'session',
  }))
  assert.equal(wrongType.status, 415)

  const invalidJson = await route.fetch(new Request('http://local/api/session.delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
  }))
  assert.equal(invalidJson.status, 400)
  assert.equal((await invalidJson.json()).code, 'request/invalid-json')

  const invalidId = await route.fetch(new Request('http://local/api/session.delete', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"sessionId":"../etc/passwd"}',
  }))
  assert.equal(invalidId.status, 400)
  assert.equal((await invalidId.json()).code, 'session/invalid-id')
})

test('the authenticated route deletes one conversation end to end', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  let route
  const ctx = contextStub({ snapshot, registry: registryStub(id) })
  ctx.connection = { fetch: { register(candidate) { route = candidate; return async () => {} } } }
  apply(ctx)
  const response = await route.fetch(new Request('http://local/api/session.delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: id }),
  }))
  const body = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(body, { ok: true, sessionId: id })
  assert.equal(existsSync(dir), false)
  assert.equal(existsSync(dirname(dir)), true, 'the project directory is kept')
})
