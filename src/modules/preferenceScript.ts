import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref } from "../utils/prefs";
import { callLLM } from "./llmService";

export async function registerPrefsScripts(_window: Window) {
  if (!addon.data.prefs) {
    addon.data.prefs = {
      window: _window,
    };
  } else {
    addon.data.prefs.window = _window;
  }
  bindPrefEvents();
}

function bindPrefEvents() {
  const doc = addon.data.prefs?.window?.document;
  if (!doc) return;

  // Bind test connection button
  const testBtn = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-test-connection`,
  );
  if (testBtn) {
    testBtn.addEventListener("command", async () => {
      await testLLMConnection();
    });
  }
}

async function testLLMConnection() {
  const popupWin = new ztoolkit.ProgressWindow("LLM Connection Test", {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: "Testing connection...",
      type: "default",
      progress: 50,
    })
    .show();

  try {
    const response = await callLLM([
      {
        role: "user",
        content: "Say 'Connection successful!' in one sentence.",
      },
    ]);

    popupWin.changeLine({
      text: `Success: ${response.content.substring(0, 60)}`,
      type: "success",
      progress: 100,
    });
    popupWin.startCloseTimer(5000);
  } catch (e: any) {
    popupWin.changeLine({
      text: `Failed: ${e.message}`,
      type: "fail",
      progress: 100,
    });
    popupWin.startCloseTimer(10000);
  }
}