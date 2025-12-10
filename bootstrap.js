// bootstrap.js
/* global Zotero, Services, Cc, Ci, ChromeUtils */

var chromeHandle = null;

function install() {}
function uninstall() {}

function startup({ id, version, rootURI }, reason) {

  if (typeof Services === "undefined") {
    var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
  }
  if (typeof Cc === "undefined" || typeof Ci === "undefined") {
    var { classes: Cc, interfaces: Ci } = Components;
  }

  const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
    Ci.amIAddonManagerStartup
  );
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "ai-summarizer", "content/"]
  ]);

  try {
    Services.scriptloader.loadSubScript(
      "chrome://ai-summarizer/content/ai-summarizer.js"
    );
  } catch (e) {
    Services.scriptloader.loadSubScript(rootURI + "content/ai-summarizer.js");
  }

  globalThis.AISummarizer?.init({ id, version, rootURI });

  try {
    Zotero.AISummarizer = globalThis.AISummarizer;
  } catch (e) {}

  try {
    for (const win of Zotero.getMainWindows()) {
      onMainWindowLoad({ window: win });
    }
  } catch (e) {}
}

function shutdown({ id, version, rootURI }, reason) {
  try {
    for (const win of Zotero.getMainWindows()) {
      onMainWindowUnload({ window: win });
    }
  } catch (e) {}

  try {
    if (Zotero.AISummarizer) delete Zotero.AISummarizer;
  } catch (e) {}

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }

  try {
    globalThis.AISummarizer?.shutdown();
  } catch (e) {}
}

function onMainWindowLoad({ window }) {

  try {
    window.AISummarizer = Zotero.AISummarizer || globalThis.AISummarizer;
  } catch (e) {}

  globalThis.AISummarizer?.addToWindow(window);
}

function onMainWindowUnload({ window }) {
  globalThis.AISummarizer?.removeFromWindow(window);

  try {
    if (window.AISummarizer) delete window.AISummarizer;
  } catch (e) {}
}

