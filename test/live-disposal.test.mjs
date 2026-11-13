import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { apply, deleteSession } from '../index.js'
import { contextStub, fixture, registryStub } from '../test-support/fixtures.mjs'

/**
 * Build an Agent-registry double that hands out one disposable handle.
 * @param id - Session id the handle reports.
 * @param options - whether disposal rejects.
 * @returns the registry double, the handle, and the call log.
 */
function agentStub(id, { disposeFails = false } = {}) {
  const calls = { disposed: 0 }
  const handle = {
    agent: { id },
    async dispose() {
      if (disposeFails) throw new Error('drain failed')
      calls.disposed++
    },
  }
  // Methods live on the prototype, as they do on a Cordis Service instance.
  const agents = Object.create({
    async resume() { return handle },
    async create() { return handle },
  })
  agents.get = () => ({ status: 'idle' })
  return { agents, handle, calls }
}

/**
 * Install the plugin's route and Agent-handle capture on one fixture context.
 * @returns the context and the Agent double.
 */
function setup({ disposeFails = false, snapshot, registry }) {
  const { id } = snapshot.header
  const { agents, handle, calls } = agentStub(id, { disposeFails })
  const ctx = contextStub({ snapshot, registry, agents })
  ctx.connection = { fetch: { register() { return async () => {} } } }
  const beforeResume = agents.resume
  apply(ctx)
  return { ctx, handle, calls, beforeResume }
}

test('a live Agent is disposed before its log directory is removed', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(id)
  const { ctx, calls } = setup({ snapshot, registry })
  await ctx.get('agents').resume({ resumeSessionId: id })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 200)
  assert.equal(calls.disposed, 1)
  assert.equal(existsSync(dir), false)
  assert.deepEqual(registry.calls.detached, id)
})

test('a disposal failure aborts deletion and restores the archive', async (t) => {
  const { root, id, dir, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(id)
  const { ctx } = setup({ disposeFails: true, snapshot, registry })
  await ctx.get('agents').resume({ resumeSessionId: id })
  const result = await deleteSession(ctx, id)
  assert.equal(result.status, 500)
  assert.equal(result.body.code, 'session/dispose-failed')
  assert.equal(existsSync(dir), true)
  assert.deepEqual(registry.calls.archived, [id])
  assert.deepEqual(registry.calls.unarchived, [id])
})

test('the Agent-registry wrapper is removed when the plugin unloads', async (t) => {
  const { root, snapshot } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registry = registryStub(snapshot.header.id)
  const { ctx, beforeResume } = setup({ snapshot, registry })
  const agents = ctx.get('agents')
  assert.notEqual(agents.resume, beforeResume)
  for (const cleanup of ctx.cleanups) await cleanup()
  assert.equal(Object.getOwnPropertyDescriptor(agents, 'resume'), undefined)
})
