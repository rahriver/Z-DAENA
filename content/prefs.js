// content/prefs.js
/* global Zotero */

(function () {
  "use strict";

  const AIS = Zotero.AISummarizer || window.opener?.Zotero?.AISummarizer || null;

  function $(id) {
    return document.getElementById(id);
  }

  function load() {
    if (!AIS) return;

    $("provider").value = (AIS.getPref("provider") || "openai").toLowerCase();
    $("model").value = (AIS.getPref("model") || "").trim();

    $("openaiKey").value = (AIS.getPref("openaiApiKey") || "").trim();
    $("geminiKey").value = (AIS.getPref("geminiApiKey") || "").trim();

    $("maxChars").value = Number(AIS.getPref("maxChars") || 60000);
    $("prompt").value = AIS.getPref("promptTemplate") || "";

    $("saveDefault").checked = !!AIS.getPref("saveAsChildNoteDefault");
    $("overwrite").checked = !!AIS.getPref("overwriteExistingNote");

    $("tagOnSave").checked = !!AIS.getPref("addTagOnSave");
    $("tagName").value = (AIS.getPref("tagName") || "ai-summary").trim();
  }

  function save() {
    if (!AIS) {
      window.close();
      return;
    }

    AIS.setPref("provider", $("provider").value);
    AIS.setPref("model", $("model").value.trim());

    AIS.setPref("openaiApiKey", $("openaiKey").value.trim());
    AIS.setPref("geminiApiKey", $("geminiKey").value.trim());

    AIS.setPref("maxChars", Number($("maxChars").value || 60000));
    AIS.setPref("promptTemplate", $("prompt").value);

    AIS.setPref("saveAsChildNoteDefault", !!$("saveDefault").checked);
    AIS.setPref("overwriteExistingNote", !!$("overwrite").checked);

    AIS.setPref("addTagOnSave", !!$("tagOnSave").checked);
    AIS.setPref("tagName", $("tagName").value.trim());

    window.close();
  }

  window.addEventListener("load", () => {
    if (!AIS) {

      $("saveBtn").disabled = true;
    } else {
      load();
    }

    $("saveBtn").addEventListener("click", save);
    $("cancelBtn").addEventListener("click", () => window.close());
  });
})();

