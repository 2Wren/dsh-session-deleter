import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Evaluate the browser bundle in an isolated context and call its factory.
 * @returns the module the factory exports and the head element's style nodes.
 */
function loadClient() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let factory
  const head = { children: [], append(element) { this.children.push(element) } }
  const sandbox = {
    window: { __ModuleLoader__: { load(definition) { factory = definition.factory } } },
    document: {
      head,
      createElement() { return { dataset: {}, textContent: '' } },
    },
    fetch: () => { throw new Error('the factory must not fetch during apply') },
    console,
    HTMLElement: class {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.equal(typeof factory, 'function')
  // A proxied React double: apply() only stores the runtime, so hooks must not run here.
  const React = new Proxy({}, { get: () => () => ({}) })
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
function clientContext() {
  const recorded = { locale: null, menus: [], slots: [], unregistered: 0 }
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
      notify() {},
    },
    slots: {
      inject(_key, callback) { callback() },
      register(options) { recorded.slots.push(options); return () => {} },
    },
    sessions: { refresh: async () => {} },
    effect(callback) {
      const dispose = callback()
      recorded.unregistered++
      return dispose
    },
  }
  return { ctx, recorded }
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
