import type { EngineInterface, Register } from 'claude-code'

const EXTRA_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'

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

const quote = (s: string) => `'${s}'`
const isSafe = (s: string) => !/['\n]/.test(s)

async function which($: EngineInterface, name: string) {
  const path = `${(await $.env.get('PATH')) ?? ''}:${EXTRA_PATH}`
  const found = await $.process.run(['/usr/bin/which', name], { env: { PATH: path }, timeoutMs: 3000 }).catch(() => undefined)
  const bin = found?.exitCode === 0 ? found.stdout.trim() : ''
  return bin !== '' && isSafe(bin) ? bin : undefined
}

export const register: Register = (on, options) => {
  const sound = String(options.sound ?? 'Glass').trim()
  const terminalApp = String(options.terminalApp ?? 'com.mitchellh.ghostty').trim()
  const previewLength = Number(options.previewLength ?? 120) || 120

  let folder = ''
  let notifier: string | undefined
  let jump: string | undefined
  let group = ''

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    folder = started.cwd.split('/').filter(Boolean).pop() ?? ''
    group = `claude-${started.cwd}`
    notifier = await which($, 'terminal-notifier')

    // Inside tmux: the pane this session runs in, on the server it runs on
    const pane = await $.env.get('TMUX_PANE')
    const socket = (await $.env.get('TMUX'))?.split(',')[0]
    const tmux = pane !== undefined && /^%\d+$/.test(pane) ? await which($, 'tmux') : undefined
    if (tmux !== undefined && pane !== undefined && socket !== undefined && isSafe(socket)) {
      const t = `${quote(tmux)} -S ${quote(socket)}`
      group = `claude-${pane}`
      jump = `${t} switch-client -t ${quote(pane)}; ${t} select-window -t ${quote(pane)}; ${t} select-pane -t ${quote(pane)}`
    } else {
      jump = undefined
    }
    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason === 'aborted') return done

    const title = `Claude · ${folder} — ${REASONS[e.reason]}`
    const body = e.answer.replace(/\s+/g, ' ').trim().slice(0, previewLength) || REASONS[e.reason]
    const soundName = sound === '' || sound.toLowerCase() === 'none' ? '' : sound

    if (notifier !== undefined) {
      const argv = [notifier, '-title', title, '-message', body, '-group', group]
      if (soundName !== '') argv.push('-sound', soundName)
      if (terminalApp !== '') argv.push('-activate', terminalApp)
      if (jump !== undefined) argv.push('-execute', jump)
      const shown = await $.process.run(argv, { timeoutMs: 5000 }).catch(() => undefined)
      if (shown?.exitCode === 0) return done
    }

    await $.process.run(['osascript', '-e', SCRIPT, title, body, soundName], { timeoutMs: 5000 }).catch(() => undefined)
    return done
  })
}
