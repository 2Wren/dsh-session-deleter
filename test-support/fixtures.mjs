import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Session id used by every Host test fixture. */
export const SESSION_ID = 'session-12345678-1234-4234-8234-1234567890ab'

/**
 * Create one Session-owned directory shaped like the JSONL backend's layout.
 * @returns the fixture paths and a matching persistence snapshot.
 */
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-deleter-'))
  const project = join(root, '--Users-test-project--')
  const id = SESSION_ID
  const dir = join(project, id)
  await mkdir(dir, { recursive: true })
  const log = join(dir, 'session.v4.jsonl.zstd')
  await writeFile(log, 'fixture')
  await writeFile(join(dir, 'session.lock'), '')
  return {
    root,
    project,
    id,
    dir,
    log,
    snapshot: { header: { id, cwd: '/Users/test/project' }, location: { kind: 'jsonl', path: log } },
  }
}

/**
 * Minimal Workspace registry double that records every mutation.
 * @param id - Session the double accounts for.
 * @param options - archived seed and optional active-work refusal.
 * @returns the double and its call log.
 */
export function registryStub(id, { archived = false, active = null } = {}) {
  const calls = { archived: [], unarchived: [], unpinned: [], detached: null }
  const workspaces = [{
    sessionIds: [id],
    async detachSession(value) {
      calls.detached = value
      this.sessionIds = this.sessionIds.filter(entry => entry !== value)
    },
  }]
  return {
    calls,
    workspaces,
    archivedSessionIds: archived ? [id] : [],
    async archiveSession(value) {
      calls.archived.push(value)
      if (active !== null) {
        const error = new Error('active')
        error.name = 'WorkspaceActiveSessionError'
        error.activity = active
        throw error
      }
      this.archivedSessionIds = [value]
    },
    async unarchiveSession(value) {
      calls.unarchived.push(value)
      this.archivedSessionIds = this.archivedSessionIds.filter(entry => entry !== value)
    },
    async unpinSession(value) { calls.unpinned.push(value) },
    list() { return workspaces },
  }
}

/**
 * Storage-domain double that records projection-cache deletions.
 * @param deleted - array receiving each deleted Session id.
 * @returns the domain service double.
 */
export function cacheStub(deleted) {
  return {
    get(name) {
      if (name !== 'session_projcache') return undefined
      return {
        table(name) {
          if (name !== 'sessions') return undefined
          return { async delete(id) { deleted.push(id); return true } }
        },
      }
    },
  }
}

/**
 * Build a Host context double for the deletion logic and the HTTP route.
 * @param options - persistence snapshot, live agent, registry, cache, activity.
 * @returns a context object with the services the plugin reads.
 */
export function contextStub({
  snapshot,
  agent,
  registry,
  cache = cacheStub([]),
  activity = [],
  agents,
} = {}) {
  const logger = { warnings: [], infos: [], warn(...args) { this.warnings.push(args) }, info(message) { this.infos.push(message) } }
  return {
    logger,
    cleanups: [],
    on() { return () => {} },
    effect(callback) {
      const dispose = callback()
      this.cleanups.push(dispose)
      return dispose
    },
    async waterfall(_name, _request, fallback) {
      return activity.length === 0 ? fallback() : activity
    },
    get(name) {
      switch (name) {
        case 'sessionPersistence':
          return { async stat() { return snapshot } }
        case 'agents':
          return agents ?? { get() { return agent } }
        case 'workspaceRegistry':
          return registry
        case 'storageDomain':
          return cache
        default:
          return undefined
      }
    },
  }
}
