import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Evaluate the browser bundle in an isolated context and call its factory.
 * @returns the module the factory exports and the head element's style nodes.
 */
function loadClient({ fetchImpl, reactImpl } = {}) {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let factory
  const head = { children: [], append(element) { this.children.push(element) } }
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { factory = definition.factory } } },
    document: {
      head,
      createElement() { return { dataset: {}, textContent: '' } },
      addEventListener() {},
      removeEventListener() {},
    },
    fetch: fetchImpl ?? (() => { throw new Error('the factory must not fetch during apply') }),
    console,
    HTMLElement: class {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(typeof factory, 'function')
  // A proxied React double: apply() only stores the runtime, so hooks must not run here.
  const React = reactImpl ?? new Proxy({}, { get: () => () => ({}) })
  const module = factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${name})`)
  })
  return { module, head }
}

/**
 * Build a strict client-context double that records registrations.
 * @returns the context and the recorded values.
 */
function clientContext({ sessionsById = {}, workspaces = [], onStartSession, onRefresh } = {}) {
  const recorded = { locale: null, menus: [], slots: [], unregistered: 0, notifications: [] }
  let currentById = { ...sessionsById }
  const services = {
    workspaces: {
      list: { getSnapshot: () => ({ items: workspaces }) },
    },
    uiWorkspace: {
      startSession(workspaceId) { onStartSession?.(workspaceId) },
    },
  }
  const ctx = {
    locale: {
      register(namespace, dictionaries) {
        recorded.locale = { namespace, dictionaries }
        return () => {}
      },
      bind(namespace) {
        return (key, params) => params === undefined
          ? `${namespace}:${key}`
          : `${namespace}:${key}:${JSON.stringify(params)}`
      },
    },
    contextMenus: {
      register(contribution) { recorded.menus.push(contribution); return () => {} },
      notify(message, ok) { recorded.notifications.push({ message, ok }) },
    },
    slots: {
      inject(_key, callback) { callback() },
      register(options, component) { recorded.slots.push({ ...options, component }); return () => {} },
    },
    sessions: {
      list: { getSnapshot: () => ({ byId: currentById }) },
      refresh: async () => {
        if (onRefresh) currentById = await onRefresh(currentById)
      },
    },
    get(name) { return services[name] },
    effect(callback) {
      const dispose = callback()
      recorded.unregistered++
      return dispose
    },
  }
  return { ctx, recorded, setSessionsById(next) { currentById = next } }
}

/** Minimal synchronous React double to inspect rendered virtual trees. */
function reactStub() {
  return {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat() }
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot() },
    useRef(initial) { return { current: initial } },
    useEffect() {},
  }
}

/** Recursively collect elements matching a predicate from a rendered tree. */
function findElements(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (predicate(node)) out.push(node)
  if (Array.isArray(node.children)) {
    for (const child of node.children) findElements(child, predicate, out)
  }
  return out
}

test('the client factory exposes the module contract and applies cleanly', () => {
  const { module, head } = loadClient()
  const { ctx, recorded } = clientContext()
  assert.equal(typeof module.apply, 'function')
  assert.deepEqual(JSON.parse(JSON.stringify(module.inject)), [
    'contextMenus', 'slots', 'locale', 'sessions',
  ])
  module.apply(ctx)
  assert.equal(recorded.locale.namespace, 'sessionDeleter')
  assert.equal(recorded.locale.dictionaries.en['menu.delete'], 'Delete conversation permanently')
  assert.equal(recorded.locale.dictionaries.zh['menu.delete'], '永久删除对话')
  assert.equal(recorded.locale.dictionaries.zh['menu.delete'].includes('…'), false)
  assert.equal(head.children.length, 1)
  assert.match(head.children[0].textContent, /--dsw-alias-bg-layer-2/)
  assert.match(head.children[0].textContent, /--dsw-alias-state-error-primary/)
})

test('the client registers one destructive Session menu action and its surfaces', () => {
  const { module } = loadClient()
  const { ctx, recorded } = clientContext()
  module.apply(ctx)
  assert.equal(recorded.menus.length, 1)
  const menu = recorded.menus[0]
  assert.equal(menu.id, 'session-deleter.delete')
  assert.equal(menu.target, 'session')
  assert.equal(menu.order, 700)
  const actions = menu.resolve({ sessionId: 'session-1', displayTitle: 'Example' })
  assert.equal(actions.length, 1)
  const action = actions[0]
  assert.equal(action.id, 'delete')
  assert.equal(action.label, 'sessionDeleter:menu.delete')
  assert.equal(action.danger, true)
  assert.equal(action.separatorBefore, true)
  assert.deepEqual(JSON.parse(JSON.stringify(action.icon)), { key: 'session-deleter.trash' })
  assert.equal(typeof action.run, 'function')

  const slots = recorded.slots.map(slot => slot.name).sort()
  assert.deepEqual(slots, ['contextMenu.icon', 'shell.overlay'])
  assert.equal(recorded.slots.find(slot => slot.name === 'contextMenu.icon').key, 'session-deleter.trash')
  assert.equal(recorded.slots.find(slot => slot.name === 'shell.overlay').id, 'session-deleter-dialog')
})

test('the bundle id matches the published package name', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.match(source, new RegExp(`id: '${manifest.name}'`))
})

test('an open conversation in the main view can be deleted and switches to a new blank session in its workspace', async () => {
  const events = []
  const { module } = loadClient({
    reactImpl: reactStub(),
    fetchImpl: async (url) => {
      events.push(['fetch', url])
      return { ok: true, async json() { return { ok: true, sessionId: 'session-open' } } }
    },
  })
  const { ctx, recorded } = clientContext({
    sessionsById: { 'session-open': { retainedBy: { mainView: 1 } } },
    workspaces: [{ workspaceId: 'ws-1', sessionIds: ['session-open'] }],
    onRefresh: async (byId) => {
      events.push(['refresh'])
      const next = { ...byId }
      delete next['session-open']
      return next
    },
    onStartSession: (workspaceId) => { events.push(['startSession', workspaceId]) },
  })
  module.apply(ctx)

  const [action] = recorded.menus[0].resolve({ sessionId: 'session-open', displayTitle: 'Current chat' })
  action.run()

  const Dialog = recorded.slots.find(slot => slot.name === 'shell.overlay').component
  const tree = Dialog({ t: key => key })
  const confirmButton = findElements(tree, el => el.type === 'button' && el.props?.className === 'dsd-button dsd-danger')[0]
  assert.ok(confirmButton)
  assert.equal(confirmButton.props.disabled, false)
  assert.equal(findElements(tree, el => el.props?.className === 'dsd-warning').length, 0)

  await confirmButton.props.onClick()
  // Allow the unawaited void confirm() promise chain to settle.
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(events, [
    ['fetch', 'api/session.delete'],
    ['refresh'],
    ['startSession', 'ws-1'],
  ])
  assert.equal(Dialog({ t: key => key }), null)
  assert.equal(recorded.notifications.length, 1)
})

test('deleting an ungrouped open conversation clears or switches without a workspace id', async () => {
  const started = []
  const { module } = loadClient({
    reactImpl: reactStub(),
    fetchImpl: async () => ({ ok: true, async json() { return { ok: true, sessionId: 'session-ungrouped' } } }),
  })
  const { ctx, recorded } = clientContext({
    sessionsById: { 'session-ungrouped': { retainedBy: { mainView: 1 } } },
    workspaces: [],
    onRefresh: async () => ({}),
    onStartSession: (workspaceId) => { started.push(workspaceId) },
  })
  module.apply(ctx)

  const [action] = recorded.menus[0].resolve({ sessionId: 'session-ungrouped', displayTitle: 'Ungrouped' })
  action.run()
  const Dialog = recorded.slots.find(slot => slot.name === 'shell.overlay').component
  const confirmButton = findElements(Dialog({ t: key => key }), el => el.type === 'button' && el.props?.className === 'dsd-button dsd-danger')[0]
  confirmButton.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(started, [undefined])
})

test('deleting an inactive conversation does not switch away from the current conversation', async () => {
  const started = []
  const { module } = loadClient({
    reactImpl: reactStub(),
    fetchImpl: async () => ({ ok: true, async json() { return { ok: true, sessionId: 'session-other' } } }),
  })
  const { ctx, recorded } = clientContext({
    sessionsById: {
      'session-current': { retainedBy: { mainView: 1 } },
      'session-other': { retainedBy: {} },
    },
    workspaces: [{ workspaceId: 'ws-1', sessionIds: ['session-current', 'session-other'] }],
    onStartSession: (workspaceId) => { started.push(workspaceId) },
  })
  module.apply(ctx)

  const [action] = recorded.menus[0].resolve({ sessionId: 'session-other', displayTitle: 'Other' })
  action.run()
  const Dialog = recorded.slots.find(slot => slot.name === 'shell.overlay').component
  const confirmButton = findElements(Dialog({ t: key => key }), el => el.type === 'button' && el.props?.className === 'dsd-button dsd-danger')[0]
  confirmButton.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(started, [])
})

test('a Host refusal while deleting an open conversation keeps the user in place and shows the error', async () => {
  const started = []
  const { module } = loadClient({
    reactImpl: reactStub(),
    fetchImpl: async () => ({ ok: false, async json() { return { ok: false, code: 'session/running' } } }),
  })
  const { ctx, recorded } = clientContext({
    sessionsById: { 'session-open': { retainedBy: { mainView: 1 } } },
    workspaces: [{ workspaceId: 'ws-1', sessionIds: ['session-open'] }],
    onStartSession: (workspaceId) => { started.push(workspaceId) },
  })
  module.apply(ctx)

  const [action] = recorded.menus[0].resolve({ sessionId: 'session-open', displayTitle: 'Running' })
  action.run()
  const Dialog = recorded.slots.find(slot => slot.name === 'shell.overlay').component
  const confirmButton = findElements(Dialog({ t: key => key }), el => el.type === 'button' && el.props?.className === 'dsd-button dsd-danger')[0]
  confirmButton.props.onClick()
  await new Promise(resolve => setTimeout(resolve, 0))

  assert.deepEqual(started, [])
  const errorNode = findElements(Dialog({ t: key => key }), el => el.props?.className === 'dsd-error')[0]
  assert.ok(errorNode)
  assert.equal(errorNode.children[0], 'sessionDeleter:error.running')
})
