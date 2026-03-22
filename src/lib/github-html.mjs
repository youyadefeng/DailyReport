import { decodeHtmlEntities, stripHtml } from "./text-utils.mjs";
import { APP_CONFIG } from "../../config/project.config.mjs";

const GITHUB_ROOT = "https://github.com";
const DEFAULT_AI_KEYWORDS = APP_CONFIG.github.defaultAiKeywords;

export function parseGitHubTrending(html, source = {}) {
  const blocks = extractBlocks(html, /<article class="Box-row">([\s\S]*?)<\/article>/gi);
  const items = blocks
    .map((block) => normalizeTrendingBlock(block, source))
    .filter(Boolean);

  return items.slice(0, source.limit ?? 20);
}

export function parseGitHubTopic(html, source = {}) {
  const blocks = extractBlocks(
    html,
    /<article class="border rounded color-shadow-small color-bg-subtle tmp-my-4">([\s\S]*?)<\/article>/gi
  );
  const items = blocks
    .map((block) => normalizeTopicBlock(block, source))
    .filter(Boolean);

  return items.slice(0, source.limit ?? 20);
}

function normalizeTrendingBlock(block, source) {
  const repoPath = matchFirst(block, /<h2 class="h3 lh-condensed">[\s\S]*?<a[^>]+href="([^"]+)"/i);
  if (!repoPath || !isRepositoryPath(repoPath)) {
    return null;
  }

  const title = repoPath.slice(1);
  const description = stripHtml(matchFirst(block, /<p class="col-9 color-fg-muted my-1 tmp-pr-4">\s*([\s\S]*?)<\/p>/i) || "");
  const language = stripHtml(matchFirst(block, /<span itemprop="programmingLanguage">([\s\S]*?)<\/span>/i) || "");
  const stars = stripHtml(
    matchFirst(block, /<a[^>]+href="\/[^"]+\/stargazers"[^>]*>\s*[\s\S]*?<span[^>]*>\s*([\s\S]*?)\s*<\/span>\s*<\/a>/i) || ""
  );
  const rawContent = [description, language ? `Language: ${language}` : "", stars ? `Stars: ${stars}` : ""]
    .filter(Boolean)
    .join(". ");

  if (!isAiRelated(`${title} ${rawContent}`, source.keywords)) {
    return null;
  }

  return {
    title,
    link: `${GITHUB_ROOT}${repoPath}`,
    publishedAt: null,
    description: description || `Trending repository on GitHub: ${title}`,
    rawContent: rawContent || description || title
  };
}

function normalizeTopicBlock(block, source) {
  const repoPath = matchFirst(
    block,
    /<a[^>]+href="(\/[^"]+\/[^"]+)"[^>]*class="Link text-bold wb-break-word"/i
  );
  if (!repoPath || !isRepositoryPath(repoPath)) {
    return null;
  }

  const title = repoPath.slice(1);
  const description = stripHtml(matchFirst(block, /<p class="color-fg-muted mb-0">([\s\S]*?)<\/p>/i) || "");
  const starCount = stripHtml(matchFirst(block, /class="Counter js-social-count">([\s\S]*?)<\/span>/i) || "");
  const topics = [
    ...block.matchAll(/class="topic-tag topic-tag-link Link f6 mb-2">([\s\S]*?)<\/a>/gi)
  ].map((match) => stripHtml(match[1])).filter(Boolean);
  const rawContent = [
    description,
    starCount ? `Stars: ${starCount}` : "",
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : ""
  ]
    .filter(Boolean)
    .join(". ");

  return {
    title,
    link: `${GITHUB_ROOT}${repoPath}`,
    publishedAt: null,
    description: description || `Featured in GitHub AI topic: ${title}`,
    rawContent: rawContent || description || title
  };
}

function extractBlocks(value, pattern) {
  return [...value.matchAll(pattern)].map((match) => match[1]);
}

function matchFirst(value, pattern) {
  const match = value.match(pattern);
  if (!match) {
    return "";
  }
  return decodeHtmlEntities(match[1]).trim();
}

function isRepositoryPath(value) {
  return /^\/[^/\s]+\/[^/\s]+$/.test(value);
}

function isAiRelated(value, sourceKeywords = []) {
  const corpus = value.toLowerCase();
  const keywords = sourceKeywords.length > 0 ? sourceKeywords : DEFAULT_AI_KEYWORDS;
  return keywords.some((keyword) => matchesKeyword(corpus, keyword.toLowerCase()));
}

function matchesKeyword(corpus, keyword) {
  if (keyword.length <= 2) {
    const escaped = escapeRegExp(keyword);
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(corpus);
  }

  return corpus.includes(keyword);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
