// content/popup.js
/* global Zotero */

(function () {
  "use strict";

  const AIS = Zotero.AISummarizer || window.opener?.Zotero?.AISummarizer || null;

  let aborter = null;

  function $(id) {
    return document.getElementById(id);
  }

  function addMessage(role, text) {
    const chat = $("chat");
    const div = document.createElement("div");
    div.className = `msg ${role}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = role === "user" ? "You" : "AI";
    div.appendChild(meta);

    const body = document.createElement("div");
    body.textContent = text;
    div.appendChild(body);

    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function setStatus(s) {
    $("statusLine").textContent = s;
  }

  function setProgress(s) {
    $("progressLine").textContent = s || "";
  }

  function setRunning(running) {
    $("runBtn").disabled = running;
    $("scopeSelect").disabled = running;
    $("promptBox").disabled = running;
    $("saveNoteChk").disabled = running;
    $("cancelBtn").disabled = !running;
    $("settingsBtn").disabled = running;
  }

  async function loadDefaults() {
    if (!AIS) return;
    $("promptBox").value = (AIS.getPref("promptTemplate") || "").trim();
    $("saveNoteChk").checked = !!AIS.getPref("saveAsChildNoteDefault");
  }

  async function run() {
    if (!AIS) {
      setStatus("Addon API not found. Restart Zotero after reinstalling the XPI.");
      return;
    }

    setRunning(true);
    setStatus("Working…");
    setProgress("");

    aborter = new AbortController();

    const scope = $("scopeSelect").value;
    const prompt = $("promptBox").value.trim();
    const saveAsChildNote = $("saveNoteChk").checked;

    try {
      await AIS.summarizeItems({
        scope,
        userPromptOverride: prompt,
        saveAsChildNote,
        signal: aborter.signal,
        onEvent: (ev) => {
          if (!ev) return;
          if (ev.type === "status") {
            setStatus(ev.message || "");
          } else if (ev.type === "progress") {
            setProgress(`Item ${ev.current}/${ev.total}: ${ev.title || ""}`);
          } else if (ev.type === "message") {
            addMessage(ev.role, ev.text);
          }
        }
      });
    } catch (e) {
      setStatus(`Error: ${e?.message || e}`);
    } finally {
      aborter = null;
      setRunning(false);
      setProgress("");
      if ($("statusLine").textContent === "Working…") setStatus("Ready.");
    }
  }

  function openSettings() {
    try {
      const win = Zotero.getMainWindow();
      win.openDialog(
        "chrome://ai-summarizer/content/prefs.xhtml",
        "ai-summarizer-settings",
        "chrome,dialog=yes,modal=yes,resizable,centerscreen,width=640,height=520"
      );
    } catch (e) {
      setStatus(`Couldn't open settings: ${e?.message || e}`);
    }
  }

  window.addEventListener("load", async () => {
    if (!AIS) {
      addMessage("assistant", "Addon API not available in this window. Try restarting Zotero.");
      setStatus("Not ready (restart Zotero).");
      $("runBtn").disabled = true;
      return;
    }

    await loadDefaults();

    $("runBtn").addEventListener("click", run);
    $("cancelBtn").addEventListener("click", () => aborter?.abort());
    $("settingsBtn").addEventListener("click", openSettings);

    addMessage("assistant", "Select items or a folder in Zotero, choose a scope, then click Summarize.");
    setStatus("Ready.");
  });
})();

