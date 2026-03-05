import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import {
  generateLiteratureReview,
  generateSummariesOnly,
} from "./modules/reviewGenerator";

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();

  registerPrefs();

  await Promise.all(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
}

function registerPrefs() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`,
  });
}

async function onMainWindowLoad(win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();

  win.MozXULElement.insertFTLIfNeeded(
    `${addon.data.config.addonRef}-mainWindow.ftl`,
  );

  const popupWin = new ztoolkit.ProgressWindow(addon.data.config.addonName, {
    closeOnClick: true,
    closeTime: -1,
  })
    .createLine({
      text: getString("startup-begin"),
      type: "default",
      progress: 0,
    })
    .show();

  await Zotero.Promise.delay(500);

  popupWin.changeLine({
    progress: 50,
    text: `[50%] ${getString("startup-begin")}`,
  });

  // Register right-click menu
  registerRightClickMenu();

  // Register stylesheet
  registerStyleSheet(win);

  await Zotero.Promise.delay(500);

  popupWin.changeLine({
    progress: 100,
    text: `[100%] ${getString("startup-finish")}`,
  });
  popupWin.startCloseTimer(3000);
}

function registerStyleSheet(win: _ZoteroTypes.MainWindow) {
  const doc = win.document;
  const styles = ztoolkit.UI.createElement(doc, "link", {
    properties: {
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`,
    },
  });
  doc.documentElement?.appendChild(styles);
}

/**
 * Register right-click context menu items for literature review.
 */
function registerRightClickMenu() {
  const menuIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

  // Main menu item: Generate Literature Review
  ztoolkit.Menu.register("item", {
    tag: "menuitem",
    id: "zotero-itemmenu-litreview-generate",
    label: getString("menuitem-generate-review"),
    commandListener: (_ev) => {
      addon.hooks.onGenerateReview();
    },
    icon: menuIcon,
    getVisibility: (_elem, _ev) => {
      const items = Zotero.getActiveZoteroPane().getSelectedItems();
      if (!items || items.length === 0) return false;
      const regularItems = items.filter((item: Zotero.Item) =>
        item.isRegularItem(),
      );
      return regularItems.length >= 1;
    },
  });

  // Submenu with additional options
  ztoolkit.Menu.register(
    "item",
    {
      tag: "menu",
      id: "zotero-itemmenu-litreview-menu",
      label: getString("menuitem-litreview-menu"),
      icon: menuIcon,
      children: [
        {
          tag: "menuitem",
          id: "zotero-itemmenu-litreview-summarize",
          label: getString("menuitem-summarize-only"),
          commandListener: (_ev) => {
            addon.hooks.onSummarizeOnly();
          },
        },
      ],
      getVisibility: (_elem, _ev) => {
        const items = Zotero.getActiveZoteroPane().getSelectedItems();
        if (!items || items.length === 0) return false;
        const regularItems = items.filter((item: Zotero.Item) =>
          item.isRegularItem(),
        );
        return regularItems.length >= 1;
      },
    },
    "after",
    Zotero.getMainWindow().document?.querySelector(
      "#zotero-itemmenu-litreview-generate",
    ) as XUL.MenuItem,
  );
}

async function onMainWindowUnload(_win: Window): Promise<void> {
  ztoolkit.unregisterAll();
}

function onShutdown(): void {
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  switch (type) {
    case "load":
      registerPrefsScripts(data.window);
      break;
    default:
      return;
  }
}

/**
 * Generate full literature review (summarize + combine).
 */
async function onGenerateReview() {
  try {
    await generateLiteratureReview();
  } catch (e: any) {
    ztoolkit.log("Error in onGenerateReview:", e);
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: `Error: ${e.message}`,
        type: "fail",
      })
      .show();
  }
}

/**
 * Summarize selected items only (no combined review).
 */
async function onSummarizeOnly() {
  try {
    await generateSummariesOnly();
  } catch (e: any) {
    ztoolkit.log("Error in onSummarizeOnly:", e);
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 5000,
    })
      .createLine({
        text: `Error: ${e.message}`,
        type: "fail",
      })
      .show();
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onPrefsEvent,
  onGenerateReview,
  onSummarizeOnly,
};