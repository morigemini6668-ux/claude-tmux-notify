#!/bin/sh
# Click action for Ghostty: jump to a tmux pane without taking over the tab in front.
#
# usage: ghostty-jump.sh <tmux-bin> <tmux-socket> <pane-id>
#
# - The pane's session is attached in some Ghostty tab: focus that tab, then select
#   the window and pane in it
# - The session is not attached anywhere: open a new Ghostty tab attached to it
# - Ghostty cannot be scripted (no AppleScript permission, older Ghostty): switch the
#   most recent client to the pane, as the plain tmux jump does
#
# Ghostty does not expose a terminal's tty, so the client's tty gets a temporary
# OSC 2 title as a marker; the terminal showing that title is the one to focus,
# and its old title is put back right after.

tmux_bin=$1
socket=$2
pane=$3

t() { "$tmux_bin" -S "$socket" "$@"; }

switch_current_client() {
  t switch-client -t "$pane"
  t select-window -t "$pane"
  t select-pane -t "$pane"
}

session=$(t display-message -p -t "$pane" '#{session_name}') || exit 0

# Most recently active client attached to the session
client_tty=$(t list-clients -t "=$session" -F '#{client_activity} #{client_tty}' 2>/dev/null |
  sort -rn | head -1 | cut -d' ' -f2)

if [ -z "$client_tty" ]; then
  osascript - "$tmux_bin" "$socket" "$session" <<'APPLESCRIPT' || { switch_current_client; exit 0; }
on run argv
  set cmd to quoted form of (item 1 of argv) & " -S " & quoted form of (item 2 of argv) & " attach -t " & quoted form of ("=" & (item 3 of argv))
  tell application "Ghostty"
    set cfg to new surface configuration
    set command of cfg to cmd
    if (count of windows) is 0 then
      new window with configuration cfg
    else
      new tab in front window with configuration cfg
    end if
    activate
  end tell
end run
APPLESCRIPT
  sleep 0.3
  t select-window -t "$pane"
  t select-pane -t "$pane"
  exit 0
fi

t select-window -t "$pane"
t select-pane -t "$pane"

osascript - "$client_tty" "claude-jump-$$" <<'APPLESCRIPT' || switch_current_client
on run argv
  set clientTty to item 1 of argv
  set marker to item 2 of argv

  tell application "Ghostty"
    set termIds to id of every terminal
    set termNames to name of every terminal
  end tell

  do shell script "printf '\\033]2;%s\\007' " & quoted form of marker & " > " & quoted form of clientTty

  set targetId to missing value
  repeat 20 times
    tell application "Ghostty"
      set found to (every terminal whose name is marker)
      if found is not {} then
        set targetId to id of (item 1 of found)
        focus (item 1 of found)
      end if
    end tell
    if targetId is not missing value then exit repeat
    delay 0.05
  end repeat

  -- Put back the title the terminal had before the marker
  set oldName to ""
  if targetId is not missing value then
    repeat with i from 1 to count of termIds
      if item i of termIds is targetId then set oldName to item i of termNames
    end repeat
  end if
  do shell script "printf '\\033]2;%s\\007' " & quoted form of oldName & " > " & quoted form of clientTty

  if targetId is missing value then error "no Ghostty terminal shows the tmux client"
end run
APPLESCRIPT
