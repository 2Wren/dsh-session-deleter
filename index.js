/**
 * Host half of the conversation deleter: one owner-only Fetch route that
 * removes a Session's durable JSONL directory, its projection-cache record,
 * and its Workspace accounting.
 *
 * The Session persistence seam has no deletion API by design, so this plugin
 * deletes the Session-owned directory that `ctx.sessionPersistence.stat()`
 * reports. Every path is re-verified against the Session id before removal.
 * @module dsh-session-deleter
 */

import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

/** Absolute Fetch route on the authenticated shared `/api` channel. */
export const DELETE_PATH = '/api/session.delete'

/** Ordinary Session ids only: no separators, no traversal, bounded length. */
const SESSION_ID_PATTERN = /^session-[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/

export const inject = ['agents', 'connection', 'sessionPersistence']

/**
 * Handles retained by the wrapper installed in {@link apply}, per Host context.
 * The Agent registry normally discards the handle it receives from the factory,
 * so a plugin cannot close a live agent later; retaining it here is the only
 * clean way to make a deleted conversation leave the in-memory store at once.
 */
const capturedHandles = new WeakMap()

/**
 * Register the deletion route on the owner-only Fetch channel.
 * @param ctx - Host context carrying connection, Session store, and persistence.
 * @returns nothing; the route is owned by the plugin fiber.
 */
export function apply(ctx) {
  const serial = createSerialQueue()
  try {
    captureAgentHandles(ctx)
  } catch (error) {
    // Losing the handle capture only costs the immediate in-memory removal;
    // never fail the route registration because of it.
    warn(ctx, 'session-deleter: could not retain Agent handles; live removals will wait for a restart', error)
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: DELETE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: request => handleRequest(ctx, request, serial),
  }), 'session-deleter: delete route')
}

/**
 * Validate one HTTP request and dispatch it serially.
 * @param ctx - Host context.
 * @param request - authenticated Fetch request.
 * @param serial - queue keeping concurrent deletions apart.
 * @returns the JSON response.
 */
async function handleRequest(ctx, request, serial) {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!contentType.startsWith('application/json')) {
    return json(415, {
      ok: false,
      code: 'request/unsupported-media-type',
      message: 'expected a JSON request body',
    })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return json(400, { ok: false, code: 'request/invalid-json', message: 'the request body is not valid JSON' })
  }
  const sessionId = body?.sessionId
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) {
    return json(400, { ok: false, code: 'session/invalid-id', message: 'a valid sessionId is required' })
  }
  try {
    const result = await serial(() => deleteSession(ctx, sessionId, request.signal))
    return json(result.status, result.body)
  } catch (error) {
    warn(ctx, `session-deleter: unexpected failure deleting "${sessionId}"`, error)
    return json(500, { ok: false, code: 'session/delete-failed', message: 'the conversation was not deleted' })
  }
}

/**
 * Permanently delete one ordinary Session.
 *
 * Ordering: prove the location, refuse work in progress, archive first (the
 * durable archive set gates every later model step), remove the Session-owned
 * directory, then erase derived state. Archiving is rolled back when removal
 * fails so a failed delete does not change what the user sees.
 * @param ctx - Host context with `sessionPersistence`, `sessions`, and optional
 *   `workspaceRegistry`, `agents`, `storageDomain`, and `logger`.
 * @param sessionId - ordinary Session id to delete.
 * @param signal - request lifetime; checked before removals.
 * @returns an HTTP status and JSON body.
 */
export async function deleteSession(ctx, sessionId, signal) {
  signal?.throwIfAborted()
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    return failure(500, 'session/unavailable', 'Session persistence is unavailable in this profile')
  }
  let snapshot
  try {
    snapshot = await persistence.stat(sessionId, { signal })
  } catch {
    return failure(500, 'session/unreadable', 'The conversation log could not be read')
  }
  if (snapshot === undefined) {
    return failure(404, 'session/not-found', 'This conversation no longer exists')
  }
  if (snapshot.header?.id !== undefined && snapshot.header.id !== sessionId) {
    return failure(409, 'session/path-unverified', 'The stored header does not match the requested conversation')
  }
  if (snapshot.header?.origin === 'subagent') {
    return failure(409, 'session/subagent', 'Subagent conversations are managed by their parent conversation')
  }
  const agent = ctx.get('agents')?.get(sessionId)
  if (agent?.status === 'running') {
    return failure(409, 'session/running', 'This conversation still has a running turn')
  }
  const location = snapshot.location
  if (location === undefined || location.kind !== 'jsonl' || typeof location.path !== 'string') {
    return failure(409, 'session/path-unverified', 'The conversation has no stored JSONL location to remove')
  }
  const target = verifiedSessionDirectory(location.path, sessionId)
  if (target === undefined) {
    return failure(409, 'session/path-unverified', 'The reported storage location is not a Session-owned directory; nothing was deleted')
  }

  const registry = ctx.get('workspaceRegistry')
  let archivedNow = false
  if (registry !== undefined) {
    // Ask the same activity waterfall the registry consults on archive, so an
    // already-archived Session cannot skip the work-in-progress gate.
    let activity
    if (typeof ctx.waterfall === 'function') {
      try {
        activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
      } catch {
        activity = undefined
      }
    }
    if (Array.isArray(activity) && activity.length > 0) {
      return failure(409, 'session/active', 'This conversation still has work in progress', {
        activity: describeActivity(activity),
      })
    }
    const archived = registry.archivedSessionIds.includes(sessionId)
    if (!archived) {
      try {
        await registry.archiveSession(sessionId)
        archivedNow = true
      } catch (error) {
        if (error?.name === 'WorkspaceActiveSessionError') {
          return failure(409, 'session/active', 'This conversation still has work in progress', {
            activity: describeActivity(error.activity),
          })
        }
        if (error?.name !== 'WorkspaceUnknownSessionError') {
          warn(ctx, `session-deleter: could not archive "${sessionId}" before deletion`, error)
          return failure(409, 'session/archive-failed', 'This conversation could not be gated for deletion; nothing was deleted')
        }
      }
    }
  }

  const handles = capturedHandles.get(ctx)
  const handle = handles?.get(sessionId)
  if (handle !== undefined) {
    try {
      // Stops the loop, closes the write handle, and removes the Session and
      // Agent from their stores, so the sidebar updates without a restart.
      await handle.dispose()
    } catch (error) {
      if (archivedNow) await restoreArchive(ctx, registry, sessionId)
      warn(ctx, `session-deleter: closing live agent "${sessionId}" failed`, error)
      return failure(500, 'session/dispose-failed', 'The conversation could not be closed in the running application; nothing was deleted')
    }
    handles.delete(sessionId)
  }

  try {
    signal?.throwIfAborted()
    await fs.rm(target, { recursive: true, force: true, maxRetries: 2 })
  } catch (error) {
    if (archivedNow) await restoreArchive(ctx, registry, sessionId)
    if (signal?.aborted === true) return failure(499, 'request/aborted', 'The request ended before deletion completed')
    warn(ctx, `session-deleter: deleting "${sessionId}" failed`, error)
    return failure(500, 'session/delete-failed', 'The conversation log could not be removed; nothing was deleted')
  }

  await deleteProjectionCache(ctx, sessionId)
  if (registry !== undefined) await cleanWorkspaceAccounting(ctx, registry, sessionId)
  ctx.logger?.info?.(`session-deleter: deleted conversation "${sessionId}"`)
  return { status: 200, body: { ok: true, sessionId } }
}

/**
 * Retain every Agent handle the registry hands to its callers so a later
 * deletion can dispose one exact live agent. The wrapper calls the original
 * method with the registry as `this`, and a later wrapper (if any) still wins
 * on unload because only our own wrapper is restored.
 * @param ctx - Host context carrying the Agent registry.
 * @returns the per-context handle map, also registered for {@link deleteSession}.
 */
function captureAgentHandles(ctx) {
  const handles = new Map()
  capturedHandles.set(ctx, handles)
  const registry = ctx.get('agents')
  if (registry === undefined) return handles
  // Service values are traced proxies: read the raw own values and the
  // prototype methods directly, because a proxy read wraps a function in a
  // caller-shadowing facade whose identity changes on every access.
  const ownResume = Object.getOwnPropertyDescriptor(registry, 'resume')?.value
  const ownCreate = Object.getOwnPropertyDescriptor(registry, 'create')?.value
  const proto = Object.getPrototypeOf(registry)
  const resume = ownResume ?? (typeof proto?.resume === 'function' ? proto.resume : undefined)
  const create = ownCreate ?? (typeof proto?.create === 'function' ? proto.create : undefined)
  if (typeof resume !== 'function' || typeof create !== 'function') return handles
  const remember = (handle) => {
    if (handle?.agent?.id !== undefined) handles.set(handle.agent.id, handle)
    return handle
  }
  const wrappedResume = async function (options) {
    return remember(await resume.call(this, options))
  }
  const wrappedCreate = async function (options) {
    return remember(await create.call(this, options))
  }
  registry.resume = wrappedResume
  registry.create = wrappedCreate
  ctx.effect(() => () => {
    restoreMethod(registry, 'resume', wrappedResume, ownResume)
    restoreMethod(registry, 'create', wrappedCreate, ownCreate)
  }, 'session-deleter: retained agent handles')
  ctx.on('agent/disposed', ({ agent }) => { handles.delete(agent.id) })
  return handles
}

/**
 * Restore one wrapped registry method when our wrapper is still installed.
 * @param registry - Agent registry whose own method was replaced.
 * @param name - method name.
 * @param wrapped - wrapper installed by this plugin.
 * @param original - previous raw own method, if the registry had one.
 * @returns nothing.
 */
function restoreMethod(registry, name, wrapped, original) {
  if (Object.getOwnPropertyDescriptor(registry, name)?.value !== wrapped) return
  if (original !== undefined) registry[name] = original
  else delete registry[name]
}

/**
 * Verify that a reported log path names exactly `<project>/<sessionId>/`.
 * @param logPath - absolute path of the selected generation file.
 * @param sessionId - id whose directory must own that file.
 * @returns the directory to remove, or undefined when the shape does not match.
 */
export function verifiedSessionDirectory(logPath, sessionId) {
  if (!isAbsolute(logPath)) return undefined
  const resolved = resolve(logPath)
  const dir = dirname(resolved)
  if (basename(dir) !== sessionId) return undefined
  const projectDir = dirname(dir)
  const projectName = basename(projectDir)
  if (projectName !== '_no-cwd' && !projectName.endsWith('--')) return undefined
  if (dirname(projectDir) === projectDir) return undefined
  return dir
}

/**
 * Remove one derived projection-cache record when the storage domain is mounted.
 * @param ctx - Host context.
 * @param sessionId - Session whose cached projections must be discarded.
 * @returns after the best-effort removal.
 */
async function deleteProjectionCache(ctx, sessionId) {
  const domain = ctx.get('storageDomain')?.get('session_projcache')
  if (domain === undefined) return
  try {
    await domain.table('sessions').delete(sessionId)
  } catch (error) {
    warn(ctx, `session-deleter: projection-cache cleanup failed for "${sessionId}"`, error)
  }
}

/**
 * Drop every derived Workspace reference to a deleted Session.
 * @param ctx - Host context.
 * @param registry - open Workspace registry.
 * @param sessionId - deleted Session id.
 * @returns after best-effort cleanup.
 */
async function cleanWorkspaceAccounting(ctx, registry, sessionId) {
  try {
    await registry.unpinSession(sessionId)
  } catch (error) {
    warn(ctx, `session-deleter: unpin cleanup failed for "${sessionId}"`, error)
  }
  try {
    await registry.unarchiveSession(sessionId)
  } catch (error) {
    warn(ctx, `session-deleter: unarchive cleanup failed for "${sessionId}"`, error)
  }
  for (const workspace of registry.list()) {
    if (!workspace.sessionIds.includes(sessionId)) continue
    try {
      await workspace.detachSession(sessionId)
    } catch (error) {
      warn(ctx, `session-deleter: workspace accounting cleanup failed for "${sessionId}"`, error)
    }
  }
}

/**
 * Undo a transient archive after a failed removal.
 * @param ctx - Host context.
 * @param registry - open Workspace registry, or undefined.
 * @param sessionId - Session to restore.
 * @returns after best-effort restoration.
 */
async function restoreArchive(ctx, registry, sessionId) {
  if (registry === undefined) return
  try {
    await registry.unarchiveSession(sessionId)
  } catch (error) {
    warn(ctx, `session-deleter: could not restore archive state for "${sessionId}"`, error)
  }
}

/**
 * Project active-work families for a refusal response.
 * @param activity - registry activity records, when present.
 * @returns plain JSON-safe family descriptions.
 */
function describeActivity(activity) {
  if (!Array.isArray(activity)) return undefined
  return activity.map((entry) => {
    if (entry === null || typeof entry !== 'object') return { kind: String(entry) }
    const items = Array.isArray(entry.items)
      ? entry.items.slice(0, 20).map(item => (item?.label ?? item?.id ?? '').toString()).filter(Boolean)
      : undefined
    return {
      kind: typeof entry.kind === 'string' ? entry.kind : 'work',
      ...(items === undefined || items.length === 0 ? {} : { items }),
    }
  })
}

/**
 * Log one contained cleanup failure without exposing it to the browser.
 * @param ctx - Host context.
 * @param message - diagnostic text.
 * @param error - contained rejection.
 * @returns nothing.
 */
function warn(ctx, message, error) {
  ctx.logger?.warn?.(message)
  ctx.logger?.warn?.(error)
}

/**
 * Build a JSON failure body and status.
 * @param status - HTTP status.
 * @param code - machine-readable code.
 * @param message - English diagnostic sentence.
 * @param extra - additional JSON-safe fields.
 * @returns an HTTP result.
 */
function failure(status, code, message, extra) {
  return { status, body: { ok: false, code, message, ...extra } }
}

/**
 * Build one JSON HTTP response.
 * @param status - HTTP status.
 * @param body - JSON-safe response body.
 * @returns the Fetch response.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Serialize deletions so two requests cannot race on one Session directory.
 * @returns a runner that queues operations in arrival order.
 */
function createSerialQueue() {
  let tail = Promise.resolve()
  return (operation) => {
    const result = tail.then(operation, operation)
    tail = result.then(() => undefined, () => undefined)
    return result
  }
}
