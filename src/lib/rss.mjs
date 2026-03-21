import { decodeHtmlEntities, stripHtml } from "./text-utils.mjs";

function unwrapCdata(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractTag(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(pattern);
  return match ? decodeHtmlEntities(unwrapCdata(match[1])) : "";
}

function extractBlocks(xml, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  return [...xml.matchAll(pattern)].map((match) => match[1]);
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeItem(rawItem) {
  const title = extractTag(rawItem, "title");
  const link = extractTag(rawItem, "link");
  const pubDate =
    extractTag(rawItem, "pubDate") ||
    extractTag(rawItem, "published") ||
    extractTag(rawItem, "updated");
  const description = extractTag(rawItem, "description") || extractTag(rawItem, "summary");
  const encoded = extractTag(rawItem, "content:encoded") || extractTag(rawItem, "content");

  return {
    title: stripHtml(title),
    link: link.trim(),
    publishedAt: parseDate(pubDate),
    description: stripHtml(description || encoded),
    rawContent: stripHtml(encoded || description)
  };
}

function normalizeAtomEntry(entry) {
  const title = extractTag(entry, "title");
  const updated = extractTag(entry, "updated") || extractTag(entry, "published");
  const summary = extractTag(entry, "summary") || extractTag(entry, "content");
  const linkMatch = entry.match(/<link[^>]+href="([^"]+)"/i);

  return {
    title: stripHtml(title),
    link: linkMatch ? decodeHtmlEntities(linkMatch[1]) : "",
    publishedAt: parseDate(updated),
    description: stripHtml(summary),
    rawContent: stripHtml(summary)
  };
}

export function parseRss(xml) {
  const itemBlocks = extractBlocks(xml, "item");
  if (itemBlocks.length > 0) {
    return itemBlocks.map(normalizeItem).filter((item) => item.title && item.link);
  }

  const entryBlocks = extractBlocks(xml, "entry");
  return entryBlocks.map(normalizeAtomEntry).filter((item) => item.title && item.link);
}
