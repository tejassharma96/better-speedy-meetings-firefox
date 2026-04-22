// Better Speedy Meetings — content script.
//
// Strategy:
//   1. Find pairs of time-picker inputs inside any event dialog or the full-page
//      event editor by looking for `<input role="combobox">` whose value parses as
//      a clock time.
//   2. Attach listeners (change + blur) so we re-evaluate whenever the user edits
//      start/end/duration.
//   3. When the computed duration matches a rule exactly, rewrite either the
//      start or the end input (per the rule) to shorten by the configured amount.
//   4. Remember the last applied duration per end-input so we don't loop on our
//      own edits and so the user can still leave a shortened meeting untouched.

(() => {
  "use strict";

  const S = window.BSM_Storage;
  if (!S) {
    console.error("[BSM] storage module missing");
    return;
  }

  // Set to "end" or "start" to override every rule's side (debugging only).
  const DEBUG_FORCE_SIDE = null;

  const settings = { ...S.DEFAULT_SETTINGS };
  let settingsLoaded = false;

  S.load().then((s) => {
    Object.assign(settings, s);
    settingsLoaded = true;
    queueScan();
  });
  S.onChange((s) => {
    Object.assign(settings, s);
    queueScan();
  });

  // ---------- time parsing / formatting ----------

  // Accepts "9:00 am", "09:00", "1:30pm", "10:05 a.m." etc.
  const TIME_RE = /^\s*(\d{1,2})\s*:\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\s*$/i;

  function parseTime(raw) {
    if (typeof raw !== "string") return null;
    const m = raw.match(TIME_RE);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const mn = parseInt(m[2], 10);
    const suf = (m[3] || "").toLowerCase().replace(/\./g, "");
    if (!Number.isFinite(h) || !Number.isFinite(mn)) return null;
    if (h < 0 || h > 23 || mn < 0 || mn > 59) return null;
    if (suf === "am") {
      if (h === 12) h = 0;
    } else if (suf === "pm") {
      if (h < 12) h += 12;
    }
    return h * 60 + mn;
  }

  function formatTime(totalMinutes, template) {
    const total = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const h24 = Math.floor(total / 60);
    const mn = total % 60;
    const hasAmPm = /(am|pm|a\.m\.|p\.m\.)/i.test(template);
    if (hasAmPm) {
      const upper = /(AM|PM|A\.M\.|P\.M\.)/.test(template);
      const spaceBefore = /\s(a\.?m\.?|p\.?m\.?)\s*$/i.test(template);
      const dotted = /\.m\./i.test(template);
      let h = h24 % 12;
      if (h === 0) h = 12;
      const suf =
        h24 < 12 ? (dotted ? "a.m." : "am") : (dotted ? "p.m." : "pm");
      const sufFinal = upper ? suf.toUpperCase() : suf;
      return `${h}:${String(mn).padStart(2, "0")}${spaceBefore ? " " : ""}${sufFinal}`;
    }
    // 24h, zero-padded, matching the most common case
    return `${String(h24).padStart(2, "0")}:${String(mn).padStart(2, "0")}`;
  }

  // ---------- input mutation ----------

  // Writes `value` into `input` in a way that actually updates the downstream
  // framework's model (not just the DOM). Empirically Google Calendar ignores
  // plain `value=` + synthetic `input`/`change` events for its time combobox
  // — it only commits when the interaction looks like real typing, followed
  // by an Enter keypress (or blur) to close the combobox.
  function setInputValue(input, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;

    // Attempt to focus the target input. If focus doesn't stick (e.g. the
    // dialog is still mounting and GCal's autofocus has the title), we must
    // NOT use execCommand — it would insert our text into whatever happens
    // to be the active element (title input, etc). Guarding on activeElement
    // confines the text to our intended target.
    try {
      input.focus();
    } catch (_) {}
    const focused = document.activeElement === input;
    if (focused) {
      try {
        input.select();
      } catch (_) {}
    }

    // Try execCommand('insertText') first — it synthesises proper
    // `beforeinput` and `input` events with inputType="insertText" which is
    // what most modern frameworks listen for. Only safe if we hold focus.
    let typed = false;
    if (focused) {
      try {
        typed = document.execCommand("insertText", false, value);
      } catch (_) {}
    }

    // Fallback / reinforcement: set value directly and dispatch synthetic
    // events, matching what a paste operation looks like.
    if (!typed || input.value !== value) {
      try {
        if (nativeSetter) nativeSetter.call(input, value);
        else input.value = value;
      } catch (_) {
        input.value = value;
      }
      input.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertReplacementText",
          data: value,
        }),
      );
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertReplacementText",
          data: value,
        }),
      );
    }

    input.dispatchEvent(new Event("change", { bubbles: true }));

    // Commit the combobox: simulate pressing Enter. GCal listens for this to
    // close the time dropdown and accept the typed value into its model.
    const enter = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    input.dispatchEvent(new KeyboardEvent("keydown", enter));
    input.dispatchEvent(new KeyboardEvent("keyup", enter));

    // Blur as a belt-and-braces finalizer.
    try {
      input.blur();
    } catch (_) {}
  }

  // ---------- pair discovery ----------

  // Per end-input state: { applied: {from, to} | null, updating: bool }.
  //   applied.from = the duration we saw just before we shortened (e.g. 30)
  //   applied.to   = the duration we produced (e.g. 25)
  // If the user edits the dialog so the duration equals `applied.from` again,
  // we treat that as a deliberate override and leave it alone. If the user
  // deviates to a non-matching duration we forget, so a later return to a
  // rule-matching duration counts as a fresh intent and is shortened again.
  // WeakMap so state evaporates when the DOM node is discarded.
  const stateMap = new WeakMap();

  function timeLike(input) {
    return TIME_RE.test(input.value || "");
  }

  function findPairs() {
    const inputs = Array.from(
      document.querySelectorAll('input[role="combobox"]'),
    ).filter(timeLike);
    if (inputs.length < 2) return [];

    // Group by the nearest plausible form/dialog container so we don't pair a
    // start-time from one dialog with an end-time from another.
    const groups = new Map();
    for (const inp of inputs) {
      const container =
        inp.closest('[role="dialog"]') ||
        inp.closest("form") ||
        inp.closest('[role="main"]') ||
        document.body;
      let list = groups.get(container);
      if (!list) {
        list = [];
        groups.set(container, list);
      }
      list.push(inp);
    }

    const pairs = [];
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      // The first two time-like comboboxes in DOM order are start, then end.
      pairs.push({ start: list[0], end: list[1] });
    }
    return pairs;
  }

  // ---------- rule application ----------

  function evaluate(pair) {
    if (!settings.enabled) return;
    const state = stateMap.get(pair.end) || { applied: null, updating: false };
    stateMap.set(pair.end, state);
    if (state.updating) return;

    const sMin = parseTime(pair.start.value);
    const eMin = parseTime(pair.end.value);
    if (sMin == null || eMin == null) return;

    let duration = eMin - sMin;
    if (duration < 0) duration += 24 * 60; // wraps past midnight
    if (duration <= 0) return;

    if (state.applied) {
      // Our own post-apply echo: duration matches what we just produced.
      if (duration === state.applied.to) return;
      // User manually reverted to the pre-shortening duration — treat as an
      // intentional override and leave it alone.
      if (duration === state.applied.from) return;
    }

    let rule = settings.rules.find((r) => r.duration === duration);
    if (rule && DEBUG_FORCE_SIDE) rule = { ...rule, side: DEBUG_FORCE_SIDE };
    if (!rule) {
      // User is on a non-matching duration; clear memory so a later return to
      // a matching duration counts as a fresh intent.
      state.applied = null;
      return;
    }

    const shortened = duration - rule.shortenBy;
    if (shortened <= 0) return; // invalid rule, ignore

    state.updating = true;
    state.applied = { from: duration, to: shortened };

    applyRule(pair, rule, sMin, eMin, duration, shortened).finally(() => {
      // Small grace period after the last write before freeing the guard.
      setTimeout(() => {
        state.updating = false;
      }, 200);
    });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Writes `wantMinutes` into `input`, then polls to confirm the framework
  // didn't clobber it back. If it did, write again. Gives up after
  // `maxAttempts` tries. Returns true if the value ultimately stuck.
  async function writeUntilStuck(
    input,
    wantMinutes,
    template,
    label,
    maxAttempts = 5,
  ) {
    for (let i = 1; i <= maxAttempts; i++) {
      setInputValue(input, formatTime(wantMinutes, template));
      await sleep(160);
      if (parseTime(input.value) === wantMinutes) return true;
    }
    console.error(
      `[BSM] ${label} failed to stick after ${maxAttempts} attempts ` +
        `(wanted ${formatTime(wantMinutes, template)}, last saw "${input.value}")`,
    );
    return false;
  }

  async function applyRule(pair, rule, sMin, eMin, duration, shortened) {
    const origStartTpl = pair.start.value;
    const origEndTpl = pair.end.value;

    if (rule.side === "end") {
      const newEnd = (sMin + shortened) % (24 * 60);
      const ok = await writeUntilStuck(pair.end, newEnd, origEndTpl, "end");
      if (ok) {
        console.log(
          `[BSM] shortened ${duration}→${shortened} min at end: ` +
            `${origStartTpl}–${origEndTpl} → ${pair.start.value}–${pair.end.value}`,
        );
      }
      return;
    }

    // side === "start"
    //   step 1: shorten end so duration = `shortened`
    //   step 2: push start forward; GCal's duration-preservation restores end
    //           to its original value, giving us the desired final state:
    //             start = orig + shortenBy,  end = orig
    const tempEnd = (sMin + shortened) % (24 * 60);
    const newStart = (sMin + rule.shortenBy) % (24 * 60);

    const endOk = await writeUntilStuck(
      pair.end,
      tempEnd,
      origEndTpl,
      "end(step1)",
    );
    if (!endOk) return;

    setInputValue(pair.start, formatTime(newStart, origStartTpl));
    await sleep(200);

    if (parseTime(pair.start.value) !== newStart) {
      const startOk = await writeUntilStuck(
        pair.start,
        newStart,
        origStartTpl,
        "start",
      );
      if (!startOk) return;
    }

    // GCal should have dragged end to origEnd via duration-preservation. If it
    // didn't (e.g. because it cached the pre-step-1 duration), force it.
    if (parseTime(pair.end.value) !== eMin) {
      const endFinalOk = await writeUntilStuck(
        pair.end,
        eMin,
        origEndTpl,
        "end(final)",
      );
      if (!endFinalOk) return;
    }

    console.log(
      `[BSM] shortened ${duration}→${shortened} min at start: ` +
        `${origStartTpl}–${origEndTpl} → ${pair.start.value}–${pair.end.value}`,
    );
  }

  function attach(pair) {
    const handler = () => setTimeout(() => evaluate(pair), 60);
    for (const inp of [pair.start, pair.end]) {
      if (inp._bsmAttached) continue;
      inp._bsmAttached = true;
      // Use capture so we see events even if the framework stops propagation.
      inp.addEventListener("change", handler, true);
      inp.addEventListener("blur", handler, true);
    }
    // Evaluate shortly after attach — the framework often populates the
    // initial time values asynchronously after the dialog mounts. Keep the
    // delays short so the shortening is perceptually immediate.
    [0, 30, 120, 400].forEach((d) => setTimeout(() => evaluate(pair), d));
  }

  // ---------- scan loop ----------

  let scanQueued = false;
  function queueScan() {
    if (!settingsLoaded) return;
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      try {
        for (const pair of findPairs()) attach(pair);
      } catch (e) {
        console.error("[BSM] scan failed", e);
      }
    });
  }

  const observer = new MutationObserver(queueScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // First scan as soon as storage loads (see load() above).
})();
