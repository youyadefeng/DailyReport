import { decodeHtmlEntities, stripHtml } from "./text-utils.mjs";

export function parseGoogleCloudBlog(html, source = {}) {
  const items = [];
  const seen = new Set();
  const limit = source.limit ?? 20;
  const typeFilter = source.pathPrefix ? String(source.pathPrefix) : null;

  for (const match of html.matchAll(
    /<a href="(?<href>https:\/\/cloud\.google\.com\/blog\/[^"]+)" class="w7DBpd"[\s\S]*?<div class="Qwf2Db-MnozTc[^"]*"[^>]*>(?<tag>.*?)<\/div>[\s\S]*?<h5 class="Qwf2Db-MnozTc[^"]*">(?<title>.*?)<\/h5>[\s\S]*?<p class="nRhiJb-cHYyed[^"]*">(?<meta>.*?)<\/p>/gi
  )) {
    const href = String(match.groups?.href ?? "").trim();
    if (!href || seen.has(href)) {
      continue;
    }
    if (typeFilter && !href.includes(typeFilter)) {
      continue;
    }

    const tag = normalizeText(match.groups?.tag);
    if (tag !== "Developers & Practitioners") {
      continue;
    }

    const title = normalizeText(match.groups?.title);
    const meta = normalizeText(match.groups?.meta);
    if (!title) {
      continue;
    }

    seen.add(href);
    items.push({
      title,
      link: href,
      publishedAt: null,
      description: meta,
      rawContent: [title, meta].filter(Boolean).join(" | ")
    });

    if (items.length >= limit) {
      break;
    }
  }

  return items;
}

function normalizeText(value) {
  return stripHtml(decodeHtmlEntities(String(value ?? ""))).replace(/\s+/g, " ").trim();
}
