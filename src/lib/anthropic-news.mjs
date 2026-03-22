import { decodeHtmlEntities, stripHtml } from "./text-utils.mjs";

const ANTHROPIC_ROOT = "https://www.anthropic.com";

export function parseAnthropicNews(html, source = {}) {
  const items = [];
  const seen = new Set();

  for (const match of html.matchAll(
    /<article class="ArticleList[^"]*__article">[\s\S]*?<a class="ArticleList[^"]*__cardLink" href="(?<href>\/[^"]+)">[\s\S]*?<h3[^>]*>(?<title>.*?)<\/h3>[\s\S]*?<div class="body-2 ArticleList[^"]*__date">(?<date>.*?)<\/div>/gi
  )) {
    pushItem(items, seen, match.groups);
  }

  for (const match of html.matchAll(
    /<a href="(?<href>\/[^"]+)" class="FeaturedGrid[^"]*__content">[\s\S]*?<h2[^>]*>(?<title>.*?)<\/h2>[\s\S]*?<time[^>]*>(?<date>.*?)<\/time>[\s\S]*?<p[^>]*>(?<desc>.*?)<\/p>/gi
  )) {
    pushItem(items, seen, match.groups);
  }

  for (const match of html.matchAll(
    /<a href="(?<href>\/[^"]+)" class="FeaturedGrid[^"]*__sideLink[^"]*">[\s\S]*?<time[^>]*>(?<date>.*?)<\/time>[\s\S]*?<h4[^>]*>(?<title>.*?)<\/h4>[\s\S]*?<p[^>]*>(?<desc>.*?)<\/p>/gi
  )) {
    pushItem(items, seen, match.groups);
  }

  return items.slice(0, source.limit ?? 20);
}

function pushItem(items, seen, groups = {}) {
  const href = groups.href || "";
  if (!href || seen.has(href)) {
    return;
  }

  const title = normalizeText(groups.title);
  const description = normalizeText(groups.desc);
  const publishedAt = normalizeDate(groups.date);

  if (!title) {
    return;
  }

  seen.add(href);
  items.push({
    title,
    link: `${ANTHROPIC_ROOT}${href}`,
    publishedAt,
    description,
    rawContent: description || title
  });
}

function normalizeText(value) {
  return stripHtml(decodeHtmlEntities(String(value || ""))).replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const cleaned = normalizeText(value);
  if (!cleaned) {
    return null;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return cleaned;
  }

  return parsed.toISOString();
}
