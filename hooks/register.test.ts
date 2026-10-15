import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'

const base = { durationMs: 10, isAborted: false, turnId: 't1' }
const start = { cwd: '/Users/me/golf-score', surface: 'terminal', isInteractive: true } as const
const BINS: Record<string, string> = { 'terminal-notifier': '/opt/homebrew/bin/terminal-notifier', tmux: '/opt/homebrew/bin/tmux' }

type World = { env?: Record<string, string>; bins?: Record<string, string>; notifierExit?: number; front?: string; pane?: string }

function world(on: On, { env = {}, bins = BINS, notifierExit = 0, front = 'com.apple.Safari', pane = '1 1 1' }: World = {}) {
  const shown: (readonly string[])[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('process.run', ($, e) => {
    const [cmd, arg] = e.argv
    const result = (exitCode: number, stdout = '') =>
      ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === '/usr/bin/which') return bins[arg ?? ''] !== undefined ? result(0, `${bins[arg ?? '']}\n`) : result(1)
    if (cmd === '/bin/sh' && e.argv[2]?.includes('lsappinfo')) return result(0, `"CFBundleIdentifier"="${front}"\n`)
    if (cmd?.endsWith('/tmux') && e.argv.includes('display-message')) return result(0, `${pane}\n`)
    shown.push(e.argv)
    return result(cmd?.endsWith('terminal-notifier') ? notifierExit : 0)
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => ({ result: { questions: e.questions, answers: {} } }))
  on('classic.Notification', () => ({}))
  return shown
}

const flag = (argv: readonly string[] | undefined, name: string) => argv?.[argv.indexOf(name) + 1]
const tmuxEnv = { TMUX: '/private/tmp/tmux-501/default,17662,0', TMUX_PANE: '%4' }

test('a click brings the terminal forward and jumps to the tmux pane', async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: '빌드   완료했어요.', reason: 'answer' })
  expect(shown.length).toBe(1)
  expect(shown[0]?.[0]).toBe('/opt/homebrew/bin/terminal-notifier')
  expect(flag(shown[0], '-title')).toBe('Claude · golf-score — 작업 완료')
  expect(flag(shown[0], '-message')).toBe('빌드 완료했어요.')
  expect(flag(shown[0], '-sound')).toBe('Glass')
  expect(flag(shown[0], '-activate')).toBe('com.mitchellh.ghostty')
  expect(flag(shown[0], '-execute')).toMatch(
    /^\/bin\/sh '\/\S+\/hooks\/ghostty-jump\.sh' '\/opt\/homebrew\/bin\/tmux' '\/private\/tmp\/tmux-501\/default' '%4'$/,
  )
})

test('other terminals switch the client in front to the tmux pane', { options: { terminalApp: 'com.googlecode.iterm2' } }, async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(flag(shown[0], '-execute')).toBe(
    "'/opt/homebrew/bin/tmux' -S '/private/tmp/tmux-501/default' switch-client -t '%4'; " +
      "'/opt/homebrew/bin/tmux' -S '/private/tmp/tmux-501/default' select-window -t '%4'; " +
      "'/opt/homebrew/bin/tmux' -S '/private/tmp/tmux-501/default' select-pane -t '%4'",
  )
})

test('sound, terminal app and preview length come from the options', { options: { sound: 'Hero', terminalApp: 'com.googlecode.iterm2', previewLength: 5 } }, async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'abcdefghij', reason: 'answer' })
  expect(flag(shown[0], '-sound')).toBe('Hero')
  expect(flag(shown[0], '-activate')).toBe('com.googlecode.iterm2')
  expect(flag(shown[0], '-message')).toBe('abcde')
})

test('sound none leaves the notification silent', { options: { sound: 'none' } }, async ($, on) => {
  const shown = world(on)
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown[0]?.includes('-sound')).toBe(false)
})

test('outside tmux it only brings the terminal forward', async ($, on) => {
  const shown = world(on)
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown[0]?.includes('-execute')).toBe(false)
  expect(flag(shown[0], '-activate')).toBe('com.mitchellh.ghostty')
})

test('falls back to osascript without terminal-notifier or when it fails', async ($, on) => {
  const shown = world(on, { env: tmuxEnv, bins: { tmux: BINS.tmux ?? '' } })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'error' })
  expect(shown.length).toBe(1)
  expect(shown[0]?.slice(0, 1)).toEqual(['osascript'])
  expect(shown[0]?.slice(3)).toEqual(['Claude · golf-score — 오류로 종료', 'ok', 'Glass'])
})

test('a failing terminal-notifier also falls back', async ($, on) => {
  const shown = world(on, { notifierExit: 1 })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.map(argv => argv[0])).toEqual(['/opt/homebrew/bin/terminal-notifier', 'osascript'])
})

test('stays quiet for subagents and interrupts', async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'x', reason: 'answer', agentId: 'a1' })
  await $.turn.complete({ ...base, answer: '', reason: 'aborted', isAborted: true })
  expect(shown.length).toBe(0)
})

const GHOSTTY = 'com.mitchellh.ghostty'

test('no notification while the terminal is in front showing this pane', async ($, on) => {
  const shown = world(on, { env: tmuxEnv, front: GHOSTTY, pane: '1 1 1' })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.length).toBe(0)
})

test('notifies while the terminal is in front but shows another tmux window', async ($, on) => {
  const shown = world(on, { env: tmuxEnv, front: GHOSTTY, pane: '1 0 1' })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.length).toBe(1)
})

test('notifies while another app is in front', async ($, on) => {
  const shown = world(on, { env: tmuxEnv, front: 'com.kakao.KakaoTalkMac' })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.length).toBe(1)
})

test('outside tmux the terminal in front counts as watching', async ($, on) => {
  const shown = world(on, { front: GHOSTTY })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.length).toBe(0)
})

test('skipWhenWatching off always notifies', { options: { skipWhenWatching: false } }, async ($, on) => {
  const shown = world(on, { env: tmuxEnv, front: GHOSTTY })
  await $.session.start(start)
  await $.turn.complete({ ...base, answer: 'ok', reason: 'answer' })
  expect(shown.length).toBe(1)
})

const question = { questions: [{ question: '어떤 소리로 바꿀까요?', header: '소리', options: [], multiSelect: false }] }

test('notifies when Claude asks a question', async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.tool.call({ tool: 'AskUserQuestion', ...question })
  expect(shown.length).toBe(1)
  expect(flag(shown[0], '-title')).toBe('Claude · golf-score — 질문이 있어요')
  expect(flag(shown[0], '-message')).toBe('어떤 소리로 바꿀까요?')
})

test('notifies on a permission prompt but not on the idle reminder', async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  await $.classic.Notification({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' })
  expect(shown.length).toBe(1)
  expect(flag(shown[0], '-title')).toBe('Claude · golf-score — 권한 확인 필요')
  expect(flag(shown[0], '-message')).toBe('Claude needs your permission to use Bash')
})

test('notifyOnInput off keeps questions and permission prompts quiet', { options: { notifyOnInput: false } }, async ($, on) => {
  const shown = world(on, { env: tmuxEnv })
  await $.session.start(start)
  await $.tool.call({ tool: 'AskUserQuestion', ...question })
  await $.classic.Notification({ message: 'Claude needs your permission to use Bash', notification_type: 'permission_prompt' })
  expect(shown.length).toBe(0)
})
