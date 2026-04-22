(() => {
  "use strict";

  const S = window.BSM_Storage;

  const els = {
    enabled: document.getElementById("enabled"),
    add: document.getElementById("add-rule"),
    reset: document.getElementById("reset"),
    list: document.getElementById("rule-list"),
    rowTpl: document.getElementById("rule-row"),
    status: document.getElementById("status"),
  };

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 150);
  }

  function flashStatus(text) {
    els.status.textContent = text;
    clearTimeout(flashStatus._t);
    flashStatus._t = setTimeout(() => (els.status.textContent = ""), 1500);
  }

  function readRowsToRules() {
    const rules = [];
    for (const row of els.list.querySelectorAll("li.rule")) {
      const durationInput = row.querySelector(".duration");
      const shortenInput = row.querySelector(".shortenBy");
      const sideSelect = row.querySelector(".side");
      const duration = Number(durationInput.value);
      const shortenBy = Number(shortenInput.value);
      const side = sideSelect.value;
      const valid =
        Number.isFinite(duration) &&
        duration > 0 &&
        Number.isFinite(shortenBy) &&
        shortenBy > 0 &&
        shortenBy < duration;
      row.classList.toggle("invalid", !valid);
      if (!valid) continue;
      rules.push({
        duration: Math.round(duration),
        shortenBy: Math.round(shortenBy),
        side: side === "end" ? "end" : "start",
      });
    }
    return rules;
  }

  async function persist() {
    const rules = readRowsToRules();
    const settings = {
      enabled: els.enabled.checked,
      rules,
    };
    try {
      await S.save(settings);
      flashStatus("Saved");
    } catch (e) {
      console.error(e);
      flashStatus("Save failed");
    }
  }

  function addRow(rule) {
    const frag = els.rowTpl.content.cloneNode(true);
    const li = frag.querySelector("li");
    const dInput = li.querySelector(".duration");
    const sInput = li.querySelector(".shortenBy");
    const sideSel = li.querySelector(".side");
    const remove = li.querySelector(".remove");

    dInput.value = rule.duration;
    sInput.value = rule.shortenBy;
    sideSel.value = rule.side;

    dInput.addEventListener("input", scheduleSave);
    sInput.addEventListener("input", scheduleSave);
    sideSel.addEventListener("change", scheduleSave);
    remove.addEventListener("click", () => {
      li.remove();
      scheduleSave();
    });

    els.list.appendChild(frag);
  }

  function render(settings) {
    els.enabled.checked = !!settings.enabled;
    els.list.innerHTML = "";
    for (const rule of settings.rules) addRow(rule);
  }

  els.add.addEventListener("click", () => {
    addRow({ duration: 30, shortenBy: 5, side: "start" });
    scheduleSave();
  });

  els.reset.addEventListener("click", async () => {
    render(S.DEFAULT_SETTINGS);
    await persist();
  });

  els.enabled.addEventListener("change", scheduleSave);

  (async () => {
    const settings = await S.load();
    render(settings);
  })();
})();
