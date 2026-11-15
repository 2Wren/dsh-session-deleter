/**
 * Browser half of the conversation deleter.
 *
 * Adds one destructive row to the shared conversation context menu and a
 * confirmation dialog in the shell overlay. The dialog calls the Host's
 * owner-only `api/session.delete` route and then refreshes the Session list.
 * @module dsh-session-deleter/client
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-deleter',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'sessionDeleter'
    const DELETE_ROUTE = 'api/session.delete'
    const ICON_KEY = 'session-deleter.trash'

    const DICTIONARIES = {
      en: {
        'menu.delete': 'Delete conversation permanently',
        'dialog.title': 'Delete this conversation permanently?',
        'dialog.description': '“{title}” and its conversation log will be deleted from this device. Shared attachments may remain. This cannot be undone.',
        'dialog.untitled': 'Untitled conversation',
        'dialog.cancel': 'Cancel',
        'dialog.confirm': 'Delete permanently',
        'dialog.pending': 'Deleting…',
        'dialog.close': 'Close',
        'delete.done': 'Conversation deleted',
        'error.running': 'This conversation still has a running turn. Stop its work before deleting it.',
        'error.active': 'This conversation still has work in progress ({activity}). Stop it before deleting.',
        'error.workGeneric': 'unfinished work',
        'error.kind.turn': 'a running turn',
        'error.kind.job': 'background jobs',
        'error.kind.subagent': 'subagents',
        'error.kind.schedule': 'scheduled reminders',
        'error.kind.work': 'other work',
        'error.notFound': 'This conversation no longer exists.',
        'error.subagent': 'Subagent conversations are managed by their parent conversation and cannot be deleted directly.',
        'error.path': 'The conversation’s storage location could not be verified, so nothing was deleted.',
        'error.archiveFailed': 'The conversation could not be gated for deletion, so nothing was deleted.',
        'error.deleteFailed': 'The conversation log could not be removed. Check file permissions and try again.',
        'error.disposeFailed': 'The conversation could not be closed in the running application, so nothing was deleted.',
        'error.unreadable': 'The conversation log could not be read.',
        'error.unavailable': 'Session storage is unavailable in this profile.',
        'error.invalid': 'The conversation identifier was rejected.',
        'error.network': 'The application could not be reached. Check that DeepSeek Harness is still running.',
        'error.generic': 'The conversation could not be deleted.',
        'error.request': 'The delete request was rejected by the application.',
      },
      zh: {
        'menu.delete': '永久删除对话',
        'dialog.title': '确定永久删除此对话？',
        'dialog.description': '将从此设备删除“{title}”的对话记录。共享附件可能保留。此操作无法撤销。',
        'dialog.untitled': '未命名对话',
        'dialog.cancel': '取消',
        'dialog.confirm': '永久删除',
        'dialog.pending': '正在删除…',
        'dialog.close': '关闭',
        'delete.done': '对话已删除',
        'error.running': '该对话仍在运行，请先停止其工作后再删除。',
        'error.active': '该对话仍有进行中的工作（{activity}），请先停止后再删除。',
        'error.workGeneric': '未完成的工作',
        'error.kind.turn': '进行中的回合',
        'error.kind.job': '后台任务',
        'error.kind.subagent': '子智能体',
        'error.kind.schedule': '定时提醒',
        'error.kind.work': '其他工作',
        'error.notFound': '该对话已不存在。',
        'error.subagent': '子智能体对话由父对话管理，不能直接删除。',
        'error.path': '无法确认该对话的存储位置，未删除任何内容。',
        'error.archiveFailed': '无法为该对话建立删除保护，未删除任何内容。',
        'error.deleteFailed': '无法删除对话记录，请检查文件权限后重试。',
        'error.disposeFailed': '无法在运行中的应用里关闭该对话，未删除任何内容。',
        'error.unreadable': '无法读取该对话记录。',
        'error.unavailable': '当前配置无法使用会话存储。',
        'error.invalid': '该对话标识被拒绝。',
        'error.network': '无法连接应用，请确认 DeepSeek Harness 仍在运行。',
        'error.generic': '无法删除该对话。',
        'error.request': '应用拒绝了该删除请求。',
      },
    }

    const CSS = `
.dsd-root{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}
.dsd-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.32));backdrop-filter:var(--dsw-mask-blur,blur(2px))}
.dsd-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel,12px);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent,0 12px 40px rgba(0,0,0,.22));outline:none}
.dsd-content{display:flex;flex-direction:column;width:100%}
.dsd-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
.dsd-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsd-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:6px;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;font-family:inherit}
.dsd-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-close:disabled{opacity:.4;cursor:not-allowed}
.dsd-description{margin:0;padding:0 24px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);white-space:pre-line}
.dsd-error{margin:0 24px;padding:8px 10px;border-radius:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-1)}
.dsd-status{margin:0 24px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsd-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.dsd-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent}
.dsd-button:disabled{cursor:not-allowed;opacity:.4}
.dsd-button:focus-visible,.dsd-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsd-outline{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.dsd-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
.dsd-danger{color:var(--dsw-alias-state-error-primary);box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.dsd-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
@media(prefers-reduced-motion:no-preference){.dsd-dialog{animation:dsd-enter var(--ds-transition-duration,.14s) ease-out}@keyframes dsd-enter{from{opacity:0;transform:scale(.98)}}}
`

    /**
     * Small external store for the single confirmation dialog.
     * @returns state accessors used by the menu and the dialog component.
     */
    function createDialogStore() {
      let snapshot = { open: false, sessionId: null, title: '', pending: false, error: null }
      const listeners = new Set()
      const set = (next) => {
        snapshot = next
        for (const listener of [...listeners]) {
          try { listener() } catch { /* a listener failure must not block the rest */ }
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set,
      }
    }

    const store = createDialogStore()
    const runtime = { t: key => key, contextMenus: null, sessions: null, getService: () => undefined }

    function isOpenInMainView(sessionId) {
      if (sessionId === null) return false
      return (runtime.sessions?.list?.getSnapshot()?.byId?.[sessionId]?.retainedBy?.mainView ?? 0) > 0
    }

    function anyOtherOpenInMainView(sessionId) {
      const byId = runtime.sessions?.list?.getSnapshot()?.byId
      if (!byId) return false
      return Object.entries(byId).some(([id, summary]) => id !== sessionId && (summary?.retainedBy?.mainView ?? 0) > 0)
    }

    function workspaceIdForSession(sessionId) {
      const items = runtime.getService('workspaces')?.list?.getSnapshot()?.items
      if (!Array.isArray(items)) return undefined
      return items.find(item => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))?.workspaceId
    }

    const dialog = {
      open(sessionId, title) {
        store.set({ open: true, sessionId, title, pending: false, error: null })
      },
      close() {
        if (store.getSnapshot().pending) return
        store.set({ open: false, sessionId: null, title: '', pending: false, error: null })
      },
      async confirm() {
        const current = store.getSnapshot()
        if (!current.open || current.pending || current.sessionId === null) return
        const targetId = current.sessionId
        const wasOpenInMainView = isOpenInMainView(targetId)
        const workspaceId = wasOpenInMainView ? workspaceIdForSession(targetId) : undefined
        store.set({ ...current, pending: true, error: null })
        const finish = async () => {
          store.set({ open: false, sessionId: null, title: '', pending: false, error: null })
          runtime.contextMenus?.notify(runtime.t('delete.done'), true)
          try {
            await runtime.sessions?.refresh()
          } catch (error) {
            console.warn('session-deleter: Session list refresh failed', error)
          }
          if (wasOpenInMainView && !anyOtherOpenInMainView(targetId)) {
            try {
              runtime.getService('uiWorkspace')?.startSession(workspaceId)
            } catch (error) {
              console.warn('session-deleter: switching away from deleted conversation failed', error)
            }
          }
        }
        let response
        let payload = null
        try {
          response = await fetch(DELETE_ROUTE, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: targetId }),
          })
          payload = await response.json().catch(() => null)
        } catch {
          store.set({ ...store.getSnapshot(), pending: false, error: runtime.t('error.network') })
          return
        }
        if (!response.ok || payload === null || payload.ok !== true) {
          // The log is already gone: close and refresh instead of asking again.
          if (payload?.code === 'session/not-found') {
            await finish()
            return
          }
          store.set({ ...store.getSnapshot(), pending: false, error: errorText(payload) })
          return
        }
        await finish()
      },
    }

    /** Active-work family keys the Host may report. */
    const ACTIVITY_KIND_KEYS = {
      turn: 'error.kind.turn',
      job: 'error.kind.job',
      subagent: 'error.kind.subagent',
      schedule: 'error.kind.schedule',
    }

    /**
     * Answer one failed deletion with localized guidance; never surface the
     * Host's English diagnostic or a raw error message.
     * @param payload - parsed Host body, if any.
     * @returns localized message.
     */
    function errorText(payload) {
      switch (payload?.code) {
        case 'session/running': return runtime.t('error.running')
        case 'session/active':
          return runtime.t('error.active', { activity: activityText(payload.activity) })
        case 'session/not-found': return runtime.t('error.notFound')
        case 'session/subagent': return runtime.t('error.subagent')
        case 'session/path-unverified': return runtime.t('error.path')
        case 'session/archive-failed': return runtime.t('error.archiveFailed')
        case 'session/delete-failed': return runtime.t('error.deleteFailed')
        case 'session/dispose-failed': return runtime.t('error.disposeFailed')
        case 'session/unreadable': return runtime.t('error.unreadable')
        case 'session/unavailable': return runtime.t('error.unavailable')
        case 'session/invalid-id': return runtime.t('error.invalid')
        case 'request/unsupported-media-type':
        case 'request/invalid-json': return runtime.t('error.request')
        default: return runtime.t('error.generic')
      }
    }

    /**
     * Render reported active-work families as one short clause.
     * @param activity - Host activity projection.
     * @returns display text.
     */
    function activityText(activity) {
      if (!Array.isArray(activity)) return runtime.t('error.workGeneric')
      const parts = []
      for (const entry of activity) {
        const items = Array.isArray(entry?.items) ? entry.items.filter(item => typeof item === 'string' && item !== '') : []
        if (items.length > 0) parts.push(items.join(', '))
        else {
          const kind = typeof entry?.kind === 'string' ? entry.kind : ''
          parts.push(runtime.t(ACTIVITY_KIND_KEYS[kind] ?? 'error.kind.work'))
        }
      }
      return parts.length > 0 ? parts.join('; ') : runtime.t('error.workGeneric')
    }

    /** Menu-row glyph for permanent deletion. */
    function TrashIcon() {
      return h('svg', {
        viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M2.6 4.4h10.8' }),
        h('path', { d: 'M6.2 4.4V3.1h3.6v1.3' }),
        h('path', { d: 'M3.9 4.4l.7 9.1h6.8l.7-9.1' }),
        h('path', { d: 'M6.6 7v4.2M9.4 7v4.2' }),
      )
    }

    /**
     * Confirmation dialog rendered in the shell overlay.
     * @param props - slot runtime props; `t` comes from the locale registration.
     * @returns the dialog or nothing while closed.
     */
    function DeleteDialog(props) {
      const state = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
      const t = typeof props.t === 'function' ? props.t : runtime.t
      const dialogRef = React.useRef(null)

      React.useEffect(() => {
        if (state.pending) dialogRef.current?.focus?.()
      }, [state.pending])

      React.useEffect(() => {
        if (!state.open) return undefined
        const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const frame = requestAnimationFrame(() => { dialogRef.current?.focus?.() })
        const onKeyDown = (event) => {
          if (event.defaultPrevented) return
          if (event.key === 'Escape' && !event.repeat) {
            event.preventDefault()
            dialog.close()
            return
          }
          if (event.key !== 'Tab' || dialogRef.current === null) return
          const focusable = [...dialogRef.current.querySelectorAll('button:not(:disabled)')]
          if (focusable.length === 0) {
            event.preventDefault()
            dialogRef.current.focus()
            return
          }
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          const active = document.activeElement
          if (!dialogRef.current.contains(active)) {
            event.preventDefault()
            ;(event.shiftKey ? last : first).focus()
            return
          }
          if (event.shiftKey && (active === first || active === dialogRef.current)) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
          cancelAnimationFrame(frame)
          document.removeEventListener('keydown', onKeyDown, true)
          if (restore !== null && restore.isConnected) restore.focus()
        }
      }, [state.open])

      if (!state.open) return null
      const title = state.title === '' ? t('dialog.untitled') : state.title
      const pending = state.pending
      return h('div', { className: 'dsd-root', role: 'presentation' },
        h('div', {
          className: 'dsd-mask',
          'aria-hidden': true,
          onClick: () => { if (!pending) dialog.close() },
        }),
        h('div', {
          ref: dialogRef,
          className: 'dsd-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('dialog.title'),
          tabIndex: -1,
        },
          h('div', { className: 'dsd-content' },
            h('div', { className: 'dsd-header' },
              h('h2', { className: 'dsd-title' }, t('dialog.title')),
              h('button', {
                type: 'button',
                className: 'dsd-close',
                'aria-label': t('dialog.close'),
                disabled: pending,
                onClick: () => dialog.close(),
              }, '×'),
            ),
            h('p', { className: 'dsd-description' }, t('dialog.description', { title })),
          ),
          state.error === null ? null : h('div', { className: 'dsd-error', role: 'alert' }, state.error),
          pending ? h('div', { className: 'dsd-status', role: 'status' }, t('dialog.pending')) : null,
          h('div', { className: 'dsd-footer' },
            h('button', {
              type: 'button',
              className: 'dsd-button dsd-outline',
              disabled: pending,
              onClick: () => dialog.close(),
            }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: 'dsd-button dsd-danger',
              disabled: pending,
              onClick: () => { void dialog.confirm() },
            }, t('dialog.confirm')),
          ),
        ),
      )
    }

    return {
      inject: ['contextMenus', 'slots', 'locale', 'sessions'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), 'session-deleter: dictionaries')
        runtime.t = ctx.locale.bind(NS)
        runtime.contextMenus = ctx.contextMenus
        runtime.sessions = ctx.sessions
        runtime.getService = typeof ctx.get === 'function' ? name => ctx.get(name) : () => undefined
        ctx.effect(() => {
          const element = document.createElement('style')
          element.dataset.sessionDeleter = ''
          element.textContent = CSS
          document.head.append(element)
          return () => { element.remove() }
        }, 'session-deleter: styles')
        ctx.effect(() => ctx.contextMenus.register({
          id: 'session-deleter.delete',
          target: 'session',
          order: 700,
          resolve: (target) => [{
            id: 'delete',
            label: runtime.t('menu.delete'),
            icon: { key: ICON_KEY },
            danger: true,
            separatorBefore: true,
            run: () => { dialog.open(target.sessionId, target.displayTitle) },
          }],
        }), 'session-deleter: session menu')
        ctx.slots.inject('contextMenu.icon', () => ctx.slots.register({
          name: 'contextMenu.icon',
          key: ICON_KEY,
        }, TrashIcon))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'session-deleter-dialog',
          locale: NS,
        }, DeleteDialog))
      },
    }
  },
})
