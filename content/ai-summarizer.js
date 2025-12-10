/* global Zotero, Services */

(function () {
  "use strict";

  const PREF_BRANCH = "extensions.aiSummarizer.";

  const UI_IDS = {
    toolbarBtn: "ai-summarizer-toolbarbutton",
    toolsMenuItem: "ai-summarizer-tools-menuitem",
    toolsSep: "ai-summarizer-tools-sep"
  };

  function getPref(key) {
    return Zotero.Prefs.get(PREF_BRANCH + key);
  }
  function setPref(key, val) {
    return Zotero.Prefs.set(PREF_BRANCH + key, val);
  }

  function pickFirst(arr) {
    return Array.isArray(arr) && arr.length ? arr[0] : null;
  }

  function isPDF(attachmentItem) {
    try {
      const mime = attachmentItem.attachmentContentType;
      return mime === "application/pdf" || (mime || "").includes("pdf");
    } catch {
      return false;
    }
  }

  function plainToNoteHTML(text) {
    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return (
      "<h2>AI Summary</h2>" +
      "<pre style='white-space:pre-wrap;font-family:inherit'>" +
      esc(text) +
      "</pre>"
    );
  }

  function clampPayload(fullText, maxChars) {
    if (!maxChars || fullText.length <= maxChars) return fullText;
    return fullText.slice(0, maxChars) + "\n\n[TRUNCATED]";
  }

  function clampPdfTextSmart(pdfText, cap) {
    if (!cap || pdfText.length <= cap) return pdfText;

    const headLen = Math.floor(cap * 0.85);
    const tailLen = cap - headLen;

    const head = pdfText.slice(0, headLen);
    const tail = pdfText.slice(-tailLen);

    return head + "\n\n...[TRUNCATED]...\n\n" + tail;
  }

  async function getBestTextForItem(regularItem) {
    const title = regularItem.getField("title") || "(Untitled)";
    const abstract = regularItem.getField("abstractNote") || "";
    const date =
      regularItem.getField("date") ||
      regularItem.getField("year") ||
      "";

    const maxCharsPref = Number(getPref("maxChars") || 20000);
    const targetTokens = Number(getPref("targetTokensPerRequest") || 6000);

    const tokenCharCap = Math.max(4000, Math.floor(targetTokens * 4));
    const finalCharCap = Math.max(4000, Math.min(maxCharsPref, tokenCharCap));

    let pdfText = "";
    try {
      const attachmentIDs = regularItem.getAttachments();
      const attachments = attachmentIDs.length
        ? await Zotero.Items.getAsync(attachmentIDs)
        : [];
      const pdf = attachments.find((a) => a.isAttachment() && isPDF(a));
      if (pdf) {
        const ft = await Zotero.PDFWorker.getFullText(pdf.id);
        if (typeof ft === "string") pdfText = ft;
        else if (ft && typeof ft.text === "string") pdfText = ft.text;
        else if (ft && Array.isArray(ft.pages)) {
          pdfText = ft.pages.map((p) => p.text || "").join("\n");
        }
      }
    } catch {

    }


    const meta = [
      `Title: ${title}`,
      date ? `Date: ${date}` : null,
      `ItemID: ${regularItem.id}`
    ].filter(Boolean).join("\n");


    const pdfCap = Math.floor(finalCharCap * 0.9); 
    const pdfTextTrim = pdfText.trim() ? clampPdfTextSmart(pdfText.trim(), pdfCap) : "";

    const parts = [];
    if (abstract.trim()) parts.push(`ABSTRACT:\n${abstract.trim()}`);
    if (pdfTextTrim) parts.push(`PDF TEXT (EXCERPT):\n${pdfTextTrim}`);

    let content = parts.join("\n\n---\n\n");
    if (!content.trim()) content = "(No abstract or PDF text available.)";

    let full = `${meta}\n\n${content}`;
    full = clampPayload(full, finalCharCap);

    return { title, text: full, hasPDFText: !!pdfTextTrim };
  }

  function extractOpenAIText(json) {
    if (!json) return "";
    if (typeof json.output_text === "string") return json.output_text;

    try {
      if (Array.isArray(json.output)) {
        let out = "";
        for (const block of json.output) {
          if (!block || !Array.isArray(block.content)) continue;
          for (const c of block.content) {
            if (c && typeof c.text === "string") out += c.text;
            if (c && c.type === "output_text" && typeof c.text === "string") out += c.text;
          }
        }
        if (out.trim()) return out.trim();
      }
    } catch {}
    return "";
  }

  function parseRetryAfterSecondsFromMessage(msg) {
    if (!msg) return null;
    const m = String(msg).match(/try again in\s+([0-9.]+)\s*s/i);
    if (!m) return null;
    const s = Number(m[1]);
    return Number.isFinite(s) ? s : null;
  }

  async function callOpenAIOnce({ apiKey, model, instructions, userText, signal }) {
    const url = "https://api.openai.com/v1/responses";
    const body = {
      model,
      instructions,
      input: [
        {
          role: "user",
          content: [{ type: "input_text", text: userText }]
        }
      ]
    };

    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const raw = await resp.text();
    let json;
    try { json = JSON.parse(raw); } catch { json = null; }

    if (!resp.ok) {
      const msg =
        (json && (json.error?.message || json.message)) ||
        raw ||
        `OpenAI request failed (${resp.status})`;

      const err = new Error(msg);
      err.status = resp.status;

      const retryAfterHeader = resp.headers.get("retry-after");
      if (retryAfterHeader) {
        const ra = Number(retryAfterHeader);
        if (Number.isFinite(ra)) err.retryAfter = ra;
      } else {
        const ra = parseRetryAfterSecondsFromMessage(msg);
        if (ra != null) err.retryAfter = ra;
      }
      throw err;
    }

    const out = extractOpenAIText(json);
    return out || "(No text returned.)";
  }

  async function callOpenAIWithRetry({ apiKey, model, instructions, userText, signal, onEvent }) {
    const maxRetries = Number(getPref("maxRetries") || 6);
    const jitterMs = Number(getPref("retryJitterMs") || 400);

    for (let attempt = 0; ; attempt++) {
      try {
        return await callOpenAIOnce({ apiKey, model, instructions, userText, signal });
      } catch (e) {
        const msg = e?.message || String(e);
        const retryable =
          e?.status === 429 ||
          /rate limit/i.test(msg) ||
          /too many requests/i.test(msg);

        if (!retryable || attempt >= maxRetries) throw e;

        const baseSeconds =
          (typeof e.retryAfter === "number" && Number.isFinite(e.retryAfter) && e.retryAfter > 0)
            ? e.retryAfter
            : Math.min(60, Math.pow(2, attempt));

        const waitMs = Math.ceil(baseSeconds * 1000 + Math.random() * jitterMs);

        onEvent?.({
          type: "status",
          message: `Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s then retrying (attempt ${attempt + 1}/${maxRetries})…`
        });

        await Zotero.Promise.delay(waitMs);
      }
    }
  }

  function extractGeminiText(json) {
    try {
      const c = json?.candidates?.[0];
      const parts = c?.content?.parts;
      if (Array.isArray(parts)) {
        return parts.map((p) => p.text || "").join("").trim();
      }
    } catch {}
    return "";
  }

  async function callGeminiOnce({ apiKey, model, userText, signal }) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const body = { contents: [{ role: "user", parts: [{ text: userText }] }] };

    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const raw = await resp.text();
    let json;
    try { json = JSON.parse(raw); } catch { json = null; }

    if (!resp.ok) {
      const msg =
        (json && (json.error?.message || json.message)) ||
        raw ||
        `Gemini request failed (${resp.status})`;
      const err = new Error(msg);
      err.status = resp.status;
      throw err;
    }

    const out = extractGeminiText(json);
    return out || "(No text returned.)";
  }

  async function createOrUpdateChildNote(parentItem, summaryText, modelLabel) {
    const overwrite = !!getPref("overwriteExistingNote");

    let existingNote = null;
    if (overwrite) {
      try {
        const noteIDs = parentItem.getNotes ? parentItem.getNotes() : [];
        if (noteIDs?.length) {
          const notes = await Zotero.Items.getAsync(noteIDs);
          existingNote =
            notes.find(
              (n) => n.isNote() && (n.getNote?.() || "").includes("<h2>AI Summary</h2>")
            ) || null;
        }
      } catch {}
    }

    const html = plainToNoteHTML(
      summaryText + (modelLabel ? `\n\nModel: ${modelLabel}` : "")
    );

    if (existingNote) {
      existingNote.setNote(html);
      await existingNote.saveTx();
      return existingNote;
    }

    const note = new Zotero.Item("note");
    note.parentID = parentItem.id;
    note.setNote(html);
    const id = await note.saveTx();
    return Zotero.Items.get(id);
  }

  async function addTagIfEnabled(item) {
    if (!getPref("addTagOnSave")) return;
    const tagName = (getPref("tagName") || "ai-summary").trim();
    if (!tagName) return;

    try {
      item.addTag(tagName);
      await item.saveTx();
    } catch {}
  }

  async function collectRegularItemsFromScope(scope) {
    const zp = Zotero.getActiveZoteroPane();

    const toRegular = async (it) => {
      if (!it) return null;
      if (it.isRegularItem && it.isRegularItem()) return it;
      if (it.isAttachment && it.isAttachment() && it.parentID) {
        return Zotero.Items.get(it.parentID);
      }
      return null;
    };

    if (scope === "selectedItem") {
      const sel = pickFirst(zp.getSelectedItems());
      const reg = await toRegular(sel);
      return reg ? [reg] : [];
    }

    if (scope === "selectedItems") {
      const selected = zp.getSelectedItems() || [];
      const out = [];
      for (const it of selected) {
        const reg = await toRegular(it);
        if (reg && reg.isRegularItem()) out.push(reg);
      }
      return Array.from(new Map(out.map((i) => [i.id, i])).values());
    }

    if (scope === "selectedCollection") {
      const col = zp.getSelectedCollection();
      if (!col) return [];
      const items = col.getChildItems();
      return items.filter((i) => i.isRegularItem && i.isRegularItem());
    }

    if (scope === "library") {
      const s = new Zotero.Search();
      const libID =
        (typeof zp.getSelectedLibraryID === "function" && zp.getSelectedLibraryID()) ||
        Zotero.Libraries.userLibraryID;
      s.libraryID = libID;

      const ids = await s.search();
      const items = ids.length ? await Zotero.Items.getAsync(ids) : [];
      return items.filter((i) => i.isRegularItem && i.isRegularItem());
    }

    return [];
  }

  async function summarizeItems({
    scope,
    userPromptOverride,
    saveAsChildNote,
    onEvent,
    signal
  }) {
    const provider = (getPref("provider") || "openai").toLowerCase();
    const model = (getPref("model") || "").trim();

    const openaiKey = (getPref("openaiApiKey") || "").trim();
    const geminiKey = (getPref("geminiApiKey") || "").trim();

    const basePrompt = (getPref("promptTemplate") || "").trim();
    const prompt = (userPromptOverride || basePrompt || "Summarize this paper.").trim();

    const minDelayMs = Number(getPref("minDelayMs") || 0);

    if (!model) throw new Error("Model is empty. Set it in Settings.");
    if (provider === "openai" && !openaiKey) throw new Error("OpenAI API key is missing. Set it in Settings.");
    if (provider === "gemini" && !geminiKey) throw new Error("Gemini API key is missing. Set it in Settings.");

    const items = await collectRegularItemsFromScope(scope);
    if (!items.length) {
      onEvent?.({ type: "status", message: "No items found for that scope." });
      return;
    }

    onEvent?.({ type: "status", message: `Found ${items.length} item(s).` });

    for (let idx = 0; idx < items.length; idx++) {
      if (signal?.aborted) throw new Error("Cancelled.");

      const item = items[idx];
      const { title, text, hasPDFText } = await getBestTextForItem(item);

      const composed = `${prompt}\n\n---\n\n${text}`;

      onEvent?.({
        type: "progress",
        current: idx + 1,
        total: items.length,
        title
      });

      onEvent?.({
        type: "message",
        role: "user",
        text: `Summarize: ${title}\n(Using ${hasPDFText ? "PDF excerpt" : "abstract/metadata"})`
      });

      let summary = "";
      if (provider === "openai") {
        summary = await callOpenAIWithRetry({
          apiKey: openaiKey,
          model,
          instructions: "You are a careful scientific summarizer. Do not invent details not supported by the paper text.",
          userText: composed,
          signal,
          onEvent
        });
      } else if (provider === "gemini") {

        summary = await callGeminiOnce({
          apiKey: geminiKey,
          model,
          userText: composed,
          signal
        });
      } else {
        throw new Error(`Unknown provider: ${provider}`);
      }

      onEvent?.({
        type: "message",
        role: "assistant",
        text: `### ${title}\n\n${summary}`
      });

      if (saveAsChildNote) {
        await createOrUpdateChildNote(item, summary, `${provider}:${model}`);
        await addTagIfEnabled(item);
        onEvent?.({ type: "status", message: `Saved summary as child note: ${title}` });
      }

      if (minDelayMs > 0 && idx < items.length - 1) {
        onEvent?.({ type: "status", message: `Waiting ${Math.ceil(minDelayMs / 1000)}s before next item…` });
        await Zotero.Promise.delay(minDelayMs);
      }
    }

    onEvent?.({ type: "status", message: "Done." });
  }

  function openPopup(win) {
    win.openDialog(
      "chrome://ai-summarizer/content/popup.xhtml",
      "ai-summarizer-popup",
      "chrome,dialog=no,resizable,centerscreen,width=560,height=720"
    );
  }

  function openSettings(win) {
    win.openDialog(
      "chrome://ai-summarizer/content/prefs.xhtml",
      "ai-summarizer-settings",
      "chrome,dialog=yes,modal=yes,resizable,centerscreen,width=640,height=520"
    );
  }

  function addToToolsMenu(win) {
    const doc = win.document;
    const toolsPopup =
      doc.getElementById("menu_ToolsPopup") ||
      doc.querySelector('menupopup[id="menu_ToolsPopup"]');

    if (!toolsPopup) return;

    if (!doc.getElementById(UI_IDS.toolsSep)) {
      const sep = doc.createXULElement("menuseparator");
      sep.id = UI_IDS.toolsSep;
      toolsPopup.appendChild(sep);
    }

    if (!doc.getElementById(UI_IDS.toolsMenuItem)) {
      const mi = doc.createXULElement("menuitem");
      mi.id = UI_IDS.toolsMenuItem;
      mi.setAttribute("label", "AI Summarizer…");
      mi.addEventListener("command", () => openPopup(win));
      toolsPopup.appendChild(mi);

      const mi2 = doc.createXULElement("menuitem");
      mi2.id = UI_IDS.toolsMenuItem + "-settings";
      mi2.setAttribute("label", "AI Summarizer Settings…");
      mi2.addEventListener("command", () => openSettings(win));
      toolsPopup.appendChild(mi2);
    }
  }

  function addToolbarButton(win) {
    const doc = win.document;
    if (doc.getElementById(UI_IDS.toolbarBtn)) return;

    const toolbar =
      doc.getElementById("zotero-toolbar") ||
      doc.getElementById("zotero-tb-actions") ||
      doc.getElementById("zotero-items-toolbar");

    if (!toolbar) return;

    const btn = doc.createXULElement("toolbarbutton");
    btn.id = UI_IDS.toolbarBtn;
    btn.setAttribute("class", "toolbarbutton-1");
    btn.setAttribute("label", "AI Summarizer");
    btn.setAttribute("tooltiptext", "AI Summarizer");

    btn.setAttribute("image", "chrome://ai-summarizer/content/icon16.png");

    btn.addEventListener("command", () => openPopup(win));

    toolbar.appendChild(btn);
  }

  function removeUI(win) {
    const doc = win.document;
    doc.getElementById(UI_IDS.toolbarBtn)?.remove();
    doc.getElementById(UI_IDS.toolsMenuItem)?.remove();
    doc.getElementById(UI_IDS.toolsMenuItem + "-settings")?.remove();
    doc.getElementById(UI_IDS.toolsSep)?.remove();
  }

  const API = {
    init(meta) {
      this._meta = meta;
    },
    shutdown() {},
    addToWindow(win) {
      addToolbarButton(win);
      addToToolsMenu(win);
    },
    removeFromWindow(win) {
      removeUI(win);
    },
    openPopupFromSomewhere() {
      const win = Zotero.getMainWindow();
      if (win) openPopup(win);
    },
    openSettingsFromSomewhere() {
      const win = Zotero.getMainWindow();
      if (win) openSettings(win);
    },
    getPref,
    setPref,
    summarizeItems
  };

  globalThis.AISummarizer = API;
  try {
    Zotero.AISummarizer = API;
  } catch {}
})();

