import type { On } from 'claude-code'
import { test, expect } from 'claude-code/testing'

const base = { durationMs: 10, isAborted: false, turnId: 't1' }
const start = { cwd: '/Users/me/golf-score', surface: 'terminal', isInteractive: true } as const
const BINS: Record<string, string> = { 'terminal-notifier': '/opt/homebrew/bin/terminal-notifier', tmux: '/opt/homebrew/bin/tmux' }

type World = { env?: Record<string, string>; bins?: Record<string, string>; notifierExit?: number }

function world(on: On, { env = {}, bins = BINS, notifierExit = 0 }: World = {}) {
  const shown: (readonly string[])[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('process.run', ($, e) => {
    const [cmd, arg] = e.argv
    const result = (exitCode: number, stdout = '') =>
      ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === '/usr/bin/which') return bins[arg ?? ''] !== undefined ? result(0, `${bins[arg ?? '']}\n`) : result(1)
    shown.push(e.argv)
    return result(cmd?.endsWith('terminal-notifier') ? notifierExit : 0)
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
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
