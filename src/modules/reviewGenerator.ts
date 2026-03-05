import { getString } from "../utils/locale";
import { summarizeSingleItem, generateReview } from "./llmService";

/**
 * Extract metadata from a Zotero item for summarization.
 */
function extractItemInfo(item: Zotero.Item): {
  title: string;
  authors: string;
  year: string;
  abstract: string;
  journal: string;
  extraInfo: string;
} {
  const title = (item.getField("title") as string) || "Unknown Title";

  // Get authors - accept all creator types
  const creators = item.getCreators();
  const authorNames = creators
    .map((c: any) => {
      if (c.lastName && c.firstName) {
        return c.lastName + ", " + c.firstName;
      }
      return c.lastName || c.firstName || c.name || "";
    })
    .filter((n: string) => n.length > 0);
  const authors = authorNames.join("; ") || "Unknown Authors";

  // Get year
  let year = "";
  const date = item.getField("date") as string;
  if (date) {
    const match = date.match(/(\d{4})/);
    if (match) {
      year = match[1];
    }
  }

  // Get abstract
  const abstract = (item.getField("abstractNote") as string) || "";

  // Get journal
  let journal = "";
  try { journal = (item.getField("publicationTitle") as string) || ""; } catch (_) {}
  if (!journal) {
    try { journal = (item.getField("proceedingsTitle") as string) || ""; } catch (_) {}
  }
  if (!journal) {
    try { journal = (item.getField("bookTitle") as string) || ""; } catch (_) {}
  }

  // Extra info: DOI, tags, etc.
  let extraInfo = "";
  try {
    const doi = item.getField("DOI") as string;
    if (doi) extraInfo += "DOI: " + doi + "\n";
  } catch (_) {}
  const tags = item.getTags().map((t: any) => t.tag).join(", ");
  if (tags) extraInfo += "标签: " + tags + "\n";

  return { title, authors, year, abstract, journal, extraInfo };
}

/**
 * Get full text from item's best attachment.
 * Returns as much text as possible for MapReduce processing.
 */
async function getItemFullText(item: Zotero.Item): Promise<string> {
  try {
    const bestAttachment = await item.getBestAttachment();
    if (!bestAttachment) return "";

    const content = await bestAttachment.attachmentText;
    if (content && content.length > 0) {
      ztoolkit.log("Full text length:", content.length, "for:", item.getField("title"));
      // Return full text - MapReduce will handle chunking
      return content;
    }
  } catch (e) {
    ztoolkit.log("Failed to get full text:", e);
  }
  return "";
}

/**
 * Main entry point: Generate literature review from selected items.
 */
export async function generateLiteratureReview(): Promise<void> {
  const items = Zotero.getActiveZoteroPane().getSelectedItems();

  if (!items || items.length === 0) {
    showError(getString("review-no-items"));
    return;
  }

  const regularItems = items.filter(
    (item: Zotero.Item) => item.isRegularItem(),
  );

  if (regularItems.length === 0) {
    showError(getString("review-no-regular-items"));
    return;
  }

  const popupWin = new ztoolkit.ProgressWindow(getString("review-title"), {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: getString("review-starting"),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    // Step 1: Summarize each item
    const summaries: Array<{
      title: string;
      authors: string;
      year: string;
      summary: string;
      itemID: number;
    }> = [];

    for (let i = 0; i < regularItems.length; i++) {
      const item = regularItems[i];
      const info = extractItemInfo(item);
      const progress = Math.round(((i + 1) / (regularItems.length + 1)) * 80);

      popupWin.changeLine({
        progress,
        text: "[" + progress + "%] " + getString("review-summarizing") + " (" + (i + 1) + "/" + regularItems.length + "): " + info.title.substring(0, 40) + "...",
      });

      // Prefer full text, fall back to abstract
      let textForSummary = await getItemFullText(item);
      if (!textForSummary) {
        textForSummary = info.abstract;
      }
      if (!textForSummary) {
        textForSummary = "[无摘要/全文]仅有标题: " + info.title;
      }

      try {
        const summary = await summarizeSingleItem(
          info.title,
          info.authors,
          info.year,
          textForSummary,
          info.journal,
          info.extraInfo,
        );

        summaries.push({
          title: info.title,
          authors: info.authors,
          year: info.year,
          summary,
          itemID: item.id,
        });
      } catch (e: any) {
        ztoolkit.log("Error summarizing item " + info.title + ":", e);
        summaries.push({
          title: info.title,
          authors: info.authors,
          year: info.year,
          summary: "[总结失败: " + e.message + "] 摘要: " + (info.abstract || "").substring(0, 200),
          itemID: item.id,
        });
      }
    }

    // Step 2: Write individual summaries as child notes of each item
    popupWin.changeLine({
      progress: 82,
      text: "[82%] " + getString("review-writing-note") + " (个别摘要)",
    });

    for (let i = 0; i < summaries.length; i++) {
      const s = summaries[i];
      await writeChildNote(
        s.itemID,
        s.title,
        s.authors,
        s.year,
        s.summary,
      );
    }

    // Step 3: Generate combined review
    popupWin.changeLine({
      progress: 85,
      text: "[85%] " + getString("review-generating"),
    });

    const review = await generateReview(summaries);

    // Step 4: Write review as standalone note in collection
    popupWin.changeLine({
      progress: 95,
      text: "[95%] " + getString("review-writing-note"),
    });

    await writeReviewNote(regularItems, summaries, review);

    popupWin.changeLine({
      progress: 100,
      text: "[100%] " + getString("review-complete"),
      type: "success",
    });
    popupWin.startCloseTimer(5000);
  } catch (e: any) {
    ztoolkit.log("Error generating review:", e);
    popupWin.changeLine({
      progress: 100,
      text: getString("review-error") + ": " + e.message,
      type: "fail",
    });
    popupWin.startCloseTimer(10000);
  }
}

/**
 * Write a summary as a child note under the given parent item.
 */
async function writeChildNote(
  parentItemID: number,
  title: string,
  authors: string,
  year: string,
  summary: string,
): Promise<Zotero.Item> {
  let noteContent = "<h2>文献总结: " + escapeHTML(title) + "</h2>\n";
  noteContent += "<p><strong>" + escapeHTML(authors) + " (" + escapeHTML(year) + ")</strong></p>\n";
  noteContent += "<p><em>由 Zotero Literature Review 插件自动生成 - " + new Date().toLocaleString() + "</em></p>\n";
  noteContent += "<hr/>\n";
  noteContent += markdownToHTML(summary);

  const note = new Zotero.Item("note");
  note.libraryID = Zotero.Items.get(parentItemID).libraryID;
  note.parentID = parentItemID;
  note.setNote(noteContent);
  await note.saveTx();

  ztoolkit.log("Child note created for item:", parentItemID, "note ID:", note.id);
  return note;
}

/**
 * Write the combined literature review as a standalone note
 * in the current collection, related to all source items.
 */
async function writeReviewNote(
  items: Zotero.Item[],
  summaries: Array<{
    title: string;
    authors: string;
    year: string;
    summary: string;
  }>,
  review: string,
): Promise<void> {
  const currentLibraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID();

  let noteContent = "<h1>" + getString("review-note-title") + "</h1>\n";
  noteContent += "<p><em>" + getString("review-note-generated") + " " + new Date().toLocaleString() + "</em></p>\n";
  noteContent += "<p><em>" + getString("review-note-item-count") + ": " + items.length + "</em></p>\n";
  noteContent += "<hr/>\n";

  // Section 1: Literature Review
  noteContent += "<h2>" + getString("review-note-review-section") + "</h2>\n";
  noteContent += markdownToHTML(review);
  noteContent += "<hr/>\n";

  // Section 2: Individual Summaries
  noteContent += "<h2>" + getString("review-note-summaries-section") + "</h2>\n";
  for (let i = 0; i < summaries.length; i++) {
    const s = summaries[i];
    noteContent += "<h3>" + (i + 1) + ". " + escapeHTML(s.title) + "</h3>\n";
    noteContent += "<p><strong>" + escapeHTML(s.authors) + " (" + escapeHTML(s.year) + ")</strong></p>\n";
    noteContent += markdownToHTML(s.summary);
    noteContent += "<br/>\n";
  }

  // Section 3: References
  noteContent += "<h2>" + getString("review-note-references-section") + "</h2>\n";
  noteContent += "<ol>\n";
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const info = extractItemInfo(item);
    noteContent += "<li>" + escapeHTML(info.authors) + " (" + escapeHTML(info.year) + "). " + escapeHTML(info.title) + ". <em>" + escapeHTML(info.journal) + "</em>.</li>\n";
  }
  noteContent += "</ol>\n";

  const note = new Zotero.Item("note");
  note.libraryID = currentLibraryID;
  note.setNote(noteContent);

  const collection = Zotero.getActiveZoteroPane().getSelectedCollection();
  if (collection) {
    note.addToCollection(collection.id);
  }

  await note.saveTx();

  // Relate note to all source items
  for (const item of items) {
    note.addRelatedItem(item);
    item.addRelatedItem(note);
    await item.saveTx();
  }
  await note.saveTx();

  ztoolkit.log("Review note created with ID:", note.id);
}

/**
 * Simple markdown to HTML converter.
 */
function markdownToHTML(text: string): string {
  let html = escapeHTML(text);

  // Convert headers
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Convert bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Convert italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Convert numbered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

  // Convert unordered lists
  html = html.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");

  // Convert paragraphs (double newlines)
  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p>(<h[234]>)/g, "$1");
  html = html.replace(/(<\/h[234]>)<\/p>/g, "$1");

  return html;
}

function escapeHTML(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(message: string): void {
  new ztoolkit.ProgressWindow(getString("review-title"), {
    closeOnClick: true,
    closeTime: 5000,
  })
    .createLine({
      text: message,
      type: "fail",
    })
    .show();
}

/**
 * Generate summaries only (no combined review), write as child notes.
 */
export async function generateSummariesOnly(): Promise<void> {
  const items = Zotero.getActiveZoteroPane().getSelectedItems();

  if (!items || items.length === 0) {
    showError(getString("review-no-items"));
    return;
  }

  const regularItems = items.filter(
    (item: Zotero.Item) => item.isRegularItem(),
  );

  if (regularItems.length === 0) {
    showError(getString("review-no-regular-items"));
    return;
  }

  const popupWin = new ztoolkit.ProgressWindow(getString("review-title"), {
    closeOnClick: false,
    closeTime: -1,
  })
    .createLine({
      text: getString("review-starting"),
      type: "default",
      progress: 0,
    })
    .show();

  try {
    for (let i = 0; i < regularItems.length; i++) {
      const item = regularItems[i];
      const info = extractItemInfo(item);
      const progress = Math.round(((i + 1) / regularItems.length) * 95);

      popupWin.changeLine({
        progress,
        text: "[" + progress + "%] " + getString("review-summarizing") + " (" + (i + 1) + "/" + regularItems.length + "): " + info.title.substring(0, 40) + "...",
      });

      // Prefer full text, fall back to abstract
      let textForSummary = await getItemFullText(item);
      if (!textForSummary) {
        textForSummary = info.abstract;
      }
      if (!textForSummary) {
        textForSummary = "[无摘要/全文]仅有标题: " + info.title;
      }

      try {
        const summary = await summarizeSingleItem(
          info.title,
          info.authors,
          info.year,
          textForSummary,
          info.journal,
          info.extraInfo,
        );

        // Write summary as child note under the item
        await writeChildNote(
          item.id,
          info.title,
          info.authors,
          info.year,
          summary,
        );
      } catch (e: any) {
        ztoolkit.log("Error summarizing " + info.title + ":", e);
        // Write error note
        await writeChildNote(
          item.id,
          info.title,
          info.authors,
          info.year,
          "[总结失败: " + e.message + "]",
        );
      }
    }

    popupWin.changeLine({
      progress: 100,
      text: "[100%] " + getString("review-summary-complete"),
      type: "success",
    });
    popupWin.startCloseTimer(5000);
  } catch (e: any) {
    ztoolkit.log("Error generating summaries:", e);
    popupWin.changeLine({
      progress: 100,
      text: getString("review-error") + ": " + e.message,
      type: "fail",
    });
    popupWin.startCloseTimer(10000);
  }
}