// Shared storage helpers. Loaded both in content scripts and the popup.
// Exposes a single global object: BSM_Storage

(function () {
  "use strict";

  // A "rule" is: { duration: <minutes>, shortenBy: <minutes>, side: "start" | "end" }
  // The shortening is applied when the current event's duration equals `duration` exactly.
  // Multiple rules with the same `duration` are not allowed; the popup enforces this.
  const DEFAULT_SETTINGS = {
    enabled: true,
    rules: [
      { duration: 15, shortenBy: 5, side: "start" },
      { duration: 30, shortenBy: 5, side: "start" },
      { duration: 45, shortenBy: 5, side: "start" },
      { duration: 60, shortenBy: 5, side: "start" },
      { duration: 90, shortenBy: 5, side: "start" },
      { duration: 120, shortenBy: 5, side: "start" },
    ],
  };

  function getApi() {
    return typeof browser !== "undefined" ? browser : chrome;
  }

  function sanitizeRule(raw) {
    if (!raw || typeof raw !== "object") return null;
    const duration = Number(raw.duration);
    const shortenBy = Number(raw.shortenBy);
    const side = raw.side === "end" ? "end" : "start";
    if (!Number.isFinite(duration) || duration <= 0) return null;
    if (!Number.isFinite(shortenBy) || shortenBy <= 0) return null;
    if (shortenBy >= duration) return null;
    return {
      duration: Math.round(duration),
      shortenBy: Math.round(shortenBy),
      side,
    };
  }

  function sanitizeSettings(raw) {
    const base = { ...DEFAULT_SETTINGS };
    if (!raw || typeof raw !== "object") return base;
    if (typeof raw.enabled === "boolean") base.enabled = raw.enabled;
    if (Array.isArray(raw.rules)) {
      const seen = new Set();
      const rules = [];
      for (const r of raw.rules) {
        const clean = sanitizeRule(r);
        if (!clean) continue;
        if (seen.has(clean.duration)) continue;
        seen.add(clean.duration);
        rules.push(clean);
      }
      rules.sort((a, b) => a.duration - b.duration);
      base.rules = rules;
    }
    return base;
  }

  async function load() {
    const api = getApi();
    return new Promise((resolve) => {
      try {
        const res = api.storage.sync.get("settings");
        if (res && typeof res.then === "function") {
          res
            .then((data) => resolve(sanitizeSettings(data && data.settings)))
            .catch(() => resolve({ ...DEFAULT_SETTINGS }));
        } else {
          api.storage.sync.get("settings", (data) => {
            resolve(sanitizeSettings(data && data.settings));
          });
        }
      } catch (_) {
        resolve({ ...DEFAULT_SETTINGS });
      }
    });
  }

  async function save(settings) {
    const api = getApi();
    const clean = sanitizeSettings(settings);
    return new Promise((resolve, reject) => {
      try {
        const res = api.storage.sync.set({ settings: clean });
        if (res && typeof res.then === "function") {
          res.then(() => resolve(clean)).catch(reject);
        } else {
          api.storage.sync.set({ settings: clean }, () => resolve(clean));
        }
      } catch (e) {
        reject(e);
      }
    });
  }

  function onChange(cb) {
    const api = getApi();
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (!changes.settings) return;
      cb(sanitizeSettings(changes.settings.newValue));
    });
  }

  window.BSM_Storage = {
    DEFAULT_SETTINGS,
    sanitizeSettings,
    sanitizeRule,
    load,
    save,
    onChange,
  };
})();
