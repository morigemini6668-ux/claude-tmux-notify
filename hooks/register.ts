import type { EngineInterface, Register } from 'claude-code'

const EXTRA_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'
const GHOSTTY = 'com.mitchellh.ghostty'

const SCRIPT = [
  'on run argv',
  'if (item 3 of argv) is "" then',
  'display notification (item 2 of argv) with title (item 1 of argv)',
  'else',
  'display notification (item 2 of argv) with title (item 1 of argv) sound name (item 3 of argv)',
  'end if',
  'end run',
].join('\n')

const REASONS = { answer: '작업 완료', aborted: '중단됨', refusal: '거절됨', error: '오류로 종료' } as const

type Target = {
  folder: string
  group: string
  notifier?: string
  jump?: string
  paneQuery?: readonly string[]
}

type Settings = {
  sound: string
  terminalApp: string
  previewLength: number
  skipWhenWatching: boolean
}

const quote = (s: string) => `'${s}'`
const isSafe = (s: string) => !/['\n]/.test(s)

async function which($: EngineInterface, name: string) {
  const path = `${(await $.env.get('PATH')) ?? ''}:${EXTRA_PATH}`
  const found = await $.process.run(['/usr/bin/which', name], { env: { PATH: path }, timeoutMs: 3000 }).catch(() => undefined)
  const bin = found?.exitCode === 0 ? found.stdout.trim() : ''
  return bin !== '' && isSafe(bin) ? bin : undefined
}

async function frontmostApp($: EngineInterface) {
  const front = await $.process
    .run(['/bin/sh', '-c', '/usr/bin/lsappinfo info -only bundleid "$(/usr/bin/lsappinfo front)"'], { timeoutMs: 3000 })
    .catch(() => undefined)
  return front?.stdout.match(/"CFBundleIdentifier"="([^"]*)"/)?.[1]
}

// The terminal is the frontmost app and, inside tmux, this session's pane is on screen
async function isWatching($: EngineInterface, terminalApp: string, paneQuery: readonly string[] | undefined) {
  if (terminalApp === '' || (await frontmostApp($)) !== terminalApp) return false
  if (paneQuery === undefined) return true
  const shown = await $.process.run(paneQuery, { timeoutMs: 3000 }).catch(() => undefined)
  const [paneActive, windowActive, attached] = shown?.exitCode === 0 ? shown.stdout.trim().split(' ') : []
  return paneActive === '1' && windowActive === '1' && Number(attached) > 0
}

async function notify($: EngineInterface, target: Target, settings: Settings, status: string, text: string) {
  if (settings.skipWhenWatching && (await isWatching($, settings.terminalApp, target.paneQuery))) return

  const title = `Claude · ${target.folder} — ${status}`
  const body = text.replace(/\s+/g, ' ').trim().slice(0, settings.previewLength) || status
  const sound = settings.sound === '' || settings.sound.toLowerCase() === 'none' ? '' : settings.sound

  if (target.notifier !== undefined) {
    const argv = [target.notifier, '-title', title, '-message', body, '-group', target.group]
    if (sound !== '') argv.push('-sound', sound)
    if (settings.terminalApp !== '') argv.push('-activate', settings.terminalApp)
    if (target.jump !== undefined) argv.push('-execute', target.jump)
    const shown = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
    if (shown?.exitCode === 0) return
  }

  await $.process.run(['osascript', '-e', SCRIPT, title, body, sound], { timeoutMs: 5000 }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    sound: String(options.sound ?? 'Glass').trim(),
    terminalApp: String(options.terminalApp ?? GHOSTTY).trim(),
    previewLength: Number(options.previewLength ?? 120) || 120,
    skipWhenWatching: options.skipWhenWatching !== false,
  }
  const notifyOnInput = options.notifyOnInput !== false

  let target: Target = { folder: '', group: 'claude' }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const folder = started.cwd.split('/').filter(Boolean).pop() ?? ''
    const notifier = await which($, 'terminal-notifier')
    target = { folder, group: `claude-${started.cwd}`, notifier }

    // Inside tmux: the pane this session runs in, on the server it runs on
    const pane = await $.env.get('TMUX_PANE')
    const socket = (await $.env.get('TMUX'))?.split(',')[0]
    const tmux = pane !== undefined && /^%\d+$/.test(pane) ? await which($, 'tmux') : undefined
    if (tmux !== undefined && pane !== undefined && socket !== undefined && isSafe(socket)) {
      const t = `${quote(tmux)} -S ${quote(socket)}`
      // Ghostty can focus the tab already attached to the session; elsewhere switch-client moves the client in front
      const ghosttyJump = `${$.plugin.root}/hooks/ghostty-jump.sh`
      target = {
        ...target,
        group: `claude-${pane}`,
        paneQuery: [tmux, '-S', socket, 'display-message', '-p', '-t', pane, '#{pane_active} #{window_active} #{session_attached}'],
        jump:
          settings.terminalApp === GHOSTTY && isSafe(ghosttyJump)
            ? `/bin/sh ${quote(ghosttyJump)} ${quote(tmux)} ${quote(socket)} ${quote(pane)}`
            : `${t} switch-client -t ${quote(pane)}; ${t} select-window -t ${quote(pane)}; ${t} select-pane -t ${quote(pane)}`,
      }
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason !== 'aborted') {
      await notify($, target, settings, REASONS[e.reason], e.answer)
    }
    return done
  })

  // Claude stops mid-turn to ask you something: the question tool
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (notifyOnInput && e.agentId === undefined) {
      await notify($, target, settings, '질문이 있어요', e.questions.map(q => q.question).join(' / '))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // ...or waits on a permission prompt
  on('classic.Notification', async ($, e, next) => {
    if (notifyOnInput && e.notification_type === 'permission_prompt') {
      await notify($, target, settings, '권한 확인 필요', e.message)
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
