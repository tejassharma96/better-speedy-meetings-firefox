# Better Speedy Meetings (Firefox)

A Firefox port of the "Better Speedy Meetings" idea for Google Calendar:
instead of Google's built-in speedy-meetings toggle (fixed 25 / 50 min), you
configure your own rules — e.g. "shorten 30-minute meetings by 2 min at the
start" or "shorten 60-minute meetings by 10 min at the end".

## Features

- Per-duration rules: each rule maps an exact meeting length (e.g. 30 min) to
  a shortening amount (e.g. 5 min) and a side (start or end).
- Works on the full event editor (`/r/eventedit`) and the event dialog that
  opens over the grid.
- Toggle on/off without removing your rules.
- Settings sync across Firefox profiles via `storage.sync`.

The extension only touches `calendar.google.com` and has no network access.

## Install (temporary, for development)

1. `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` in this folder.

The extension stays loaded until you restart Firefox. For a permanent install
you need to package (`web-ext build`) and sign it via AMO, or use Firefox
Developer Edition / Nightly with `xpinstall.signatures.required` disabled.

Optional packaging:

```bash
npx web-ext build --source-dir . --artifacts-dir web-ext-artifacts
npx web-ext lint  --source-dir .
```

## How it works

The content script watches `calendar.google.com` for event dialogs. It
identifies the start/end time inputs by finding `<input role="combobox">`
elements whose value parses as a clock time, pairs them per dialog, and
re-evaluates whenever the user changes start, end, or duration.

When the current duration matches a rule exactly, the script rewrites either
the start input (to move it later) or the end input (to move it earlier) by
the configured amount, then fires `input` / `change` events so Google
Calendar's internal state updates.

### Override handling

Per-dialog state remembers the duration the rule fired from and the duration
it produced (e.g. `from: 30, to: 25`). Subsequent re-evaluations use this to
distinguish the three cases:

- Duration equals `to` (25) → our own post-apply echo, skip.
- Duration equals `from` (30) → user manually reverted our change, respect
  it and leave alone.
- Duration matches another rule → fresh intent, shorten again.
- Duration doesn't match any rule → forget state; a later return to a rule-
  matching duration is treated as a fresh intent.

This means you can always override by editing the start or end back after the
shortening — the extension won't fight you. If you go on a detour through a
different duration and come back, it *will* re-apply, on the assumption that
you meant it this time.

If a duration doesn't match any rule, nothing is changed.

## Default rules

| Duration | Shorten by | Side  |
| -------- | ---------- | ----- |
| 15 min   | 5 min      | start |
| 30 min   | 5 min      | start |
| 45 min   | 5 min      | start |
| 60 min   | 5 min      | start |
| 90 min   | 5 min      | start |
| 120 min  | 5 min      | start |

Edit these in the toolbar popup.

## Known limitations

- Google Calendar's DOM is not a public contract — selectors may break if
  Google restructures the event editor. The heuristics (combobox inputs whose
  value parses as a time) are deliberately loose to survive small changes.
- Time parsing understands 12h ("9:00 am", "9:00 a.m.") and 24h ("09:00").
  Other locale formats may not parse; please file an issue with an example.
- Multi-day events: only same-day duration is considered. A meeting that
  crosses midnight is treated as its wrapped length.
- The rule only fires when duration matches **exactly**. If Google's own
  "Speedy meetings" toggle is still on in Calendar settings, it will pre-empt
  some durations (e.g., a 30-min slot becomes 25-min before this extension
  sees it). Disable Google's speedy meetings if you want this one to take
  over.

## File layout

```
manifest.json
icons/                # toolbar icons (16/32/48/128, rasterized from icon.svg)
src/
  storage.js          # shared storage helpers + defaults
  content.js          # DOM scanner + rule engine
  popup.html / .css / .js   # toolbar popup UI
```
