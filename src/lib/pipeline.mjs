import { writeFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { readJson, writeJson, ensureDir } from "./fs-utils.mjs";
import { parseGitHubSearchResponse } from "./github-api.mjs";
import { parseAnthropicNews } from "./anthropic-news.mjs";
import { parseHuggingFaceBlog } from "./huggingface-blog.mjs";
import { fetchText } from "./http-utils.mjs";
import { parseRss } from "./rss.mjs";
import { buildSummary, categorizeText, sanitizeFeedNoise, scoreEntry, slugDate, slugHour } from "./text-utils.mjs";
import { APP_CONFIG } from "../../config/project.config.mjs";
import {
  getCachedHighlight,
  getCachedTranslation,
  getCachedTranslationFailure,
  loadLlmCache,
  saveLlmCache,
  setCachedHighlight,
  setCachedTranslation,
  setCachedTranslationFailure,
  clearCachedTranslationFailure
} from "./llm-cache.mjs";
import {
  getHighlightScoringConfig,
  pickHighlightCandidates,
  scoreHighlightCandidates
} from "./highlight-scorer.mjs";
import { getTranslationConfig, translateEntries } from "./translator.mjs";

const SOURCES_PATH = APP_CONFIG.paths.sources;
const STORE_DIR = APP_CONFIG.paths.storeDir;
const STORE_LEGACY_FILE = APP_CONFIG.paths.storeLegacyFile;
const REPORTS_DIR = APP_CONFIG.paths.reportsDir;
const MAX_FETCH_ATTEMPTS = APP_CONFIG.pipeline.maxFetchAttempts;
const NON_GITHUB_HIGHLIGHT_LIMIT = 20;
const GITHUB_HIGHLIGHT_LIMIT = 10;
const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  bold: "\u001b[1m"
};

export async function loadSources() {
  const config = await readJson(SOURCES_PATH, { sources: [] });
  return (config.sources ?? []).filter((source) => source.enabled !== false);
}

export async function loadSourceStatus() {
  const config = await readJson(SOURCES_PATH, { sources: [] });
  const allSources = config.sources ?? [];
  return {
    enabledSources: allSources.filter((source) => source.enabled !== false),
    disabledSources: allSources.filter((source) => source.enabled === false)
  };
}

export async function loadStore() {
  await ensureDir(STORE_DIR);
  const files = await readdir(STORE_DIR, { withFileTypes: true }).catch(() => []);
  const dayFiles = files
    .filter((file) => file.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(file.name))
    .map((file) => file.name)
    .sort();

  if (dayFiles.length === 0) {
    const legacy = await readJson(STORE_LEGACY_FILE, null);
    if (!legacy || !Array.isArray(legacy.entries)) {
      return { entries: [] };
    }

    await saveStore(legacy);
    await rm(STORE_LEGACY_FILE, { force: true });
    return legacy;
  }

  const entries = [];
  let updatedAt = null;

  for (const fileName of dayFiles) {
    const payload = await readJson(path.join(STORE_DIR, fileName), null);
    if (!payload || !Array.isArray(payload.entries)) {
      continue;
    }
    entries.push(...payload.entries);
    if (payload.updatedAt && (!updatedAt || payload.updatedAt > updatedAt)) {
      updatedAt = payload.updatedAt;
    }
  }

  return { updatedAt, entries };
}

export async function saveStore(store) {
  await ensureDir(STORE_DIR);
  const byDay = new Map();

  for (const entry of store.entries ?? []) {
    const day = String(entry.fetchedAt || "").slice(0, 10) || slugDate();
    const bucket = byDay.get(day) ?? [];
    bucket.push(entry);
    byDay.set(day, bucket);
  }

  for (const [day, entries] of byDay.entries()) {
    await writeJson(path.join(STORE_DIR, `${day}.json`), {
      updatedAt: store.updatedAt,
      date: day,
      entries
    });
  }
}

export async function fetchSource(source) {
  const body = await fetchText(source.url, {
    headers: {
      "user-agent": "ai-news-pipeline/1.0",
      accept:
        source.type === "rss"
          ? "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
          : source.type === "github-api-search"
            ? "application/vnd.github+json"
            : source.type === "anthropic-news-html" || source.type === "huggingface-blog-html"
              ? "text/html,application/xhtml+xml"
              : "text/html,application/xhtml+xml"
    },
    timeoutMs:
      source.timeoutMs ??
      (source.type === "rss" ? APP_CONFIG.network.rssTimeoutMs : APP_CONFIG.network.sourceTimeoutMs)
  });

  switch (source.type) {
    case "rss":
      return parseRss(body).slice(0, source.limit ?? 20);
    case "github-api-search":
      return parseGitHubSearchResponse(body, source);
    case "anthropic-news-html":
      return parseAnthropicNews(body, source);
    case "huggingface-blog-html":
      return parseHuggingFaceBlog(body, source);
    default:
      throw new Error(`Unsupported source type: ${source.type}`);
  }
}

async function fetchSourceWithRetry(source, { verbose = false } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      if (verbose) {
        console.log(colorize(`       \u7b2c ${attempt}/${MAX_FETCH_ATTEMPTS} \u6b21\u5c1d\u8bd5`, "cyan"));
      }
      const items = await fetchSource(source);
      return { items, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (verbose) {
        console.log(colorize(`       \u7b2c ${attempt} \u6b21\u5c1d\u8bd5\u5931\u8d25: ${error.message}`, "yellow"));
      }
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(600 * attempt);
      }
    }
  }

  throw lastError;
}

function normalizeEntry(item, source, fetchedAt, existingEntry = null) {
  const summarySource = sanitizeFeedNoise(item.description || item.rawContent || item.title);
  const summary = buildSummary(summarySource);
  const category = categorizeText(item.title, summary, source.name);
  const rawText = sanitizeFeedNoise(item.rawContent || item.description || "");

  return {
    id: item.link,
    title: item.title,
    url: item.link,
    source: source.name,
    sourceType: source.type,
    fetchedAt,
    publishedAt: item.publishedAt,
    summary,
    category,
    score: scoreEntry({ title: item.title, summary, source }),
    rawText,
    tags: source.tags ?? [],
    github: item.github ?? existingEntry?.github ?? null,
    titleZh: existingEntry?.titleZh,
    summaryZh: existingEntry?.summaryZh,
    translationProvider: existingEntry?.translationProvider,
    translationModel: existingEntry?.translationModel,
    translatedAt: existingEntry?.translatedAt
  };
}

function mergeEntries(existingEntries, incomingEntries) {
  const byId = new Map(existingEntries.map((entry) => [entry.id, entry]));

  for (const entry of incomingEntries) {
    const existing = byId.get(entry.id);
    byId.set(entry.id, existing ? { ...existing, ...entry } : entry);
  }

  return [...byId.values()].sort((left, right) => {
    const leftTime = left.publishedAt || left.fetchedAt;
    const rightTime = right.publishedAt || right.fetchedAt;
    return rightTime.localeCompare(leftTime);
  });
}

function groupBySection(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const section = isGitHubEntry(entry) ? "GitHub / Open Source" : entry.category;
    const bucket = groups.get(section) ?? [];
    bucket.push(entry);
    groups.set(section, bucket);
  }

  const priority = new Map([
    ["GitHub / Open Source", 1],
    ["Models", 2],
    ["Products", 3],
    ["Research", 4],
    ["Industry", 5],
    ["Guides", 6],
    ["Other", 7]
  ]);

  return [...groups.entries()].sort((left, right) => {
    const leftPriority = priority.get(left[0]) ?? 99;
    const rightPriority = priority.get(right[0]) ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    return right[1].length - left[1].length;
  }).map(([section, sectionEntries]) => [
    section,
    sortSectionEntries(sectionEntries, section)
  ]);
}

function isGitHubEntry(entry) {
  return entry.source.startsWith("GitHub") || entry.tags.includes("github");
}

function sortSectionEntries(entries, section) {
  if (section === "GitHub / Open Source") {
    return entries.slice().sort(compareGitHubEntries);
  }

  return entries;
}

function compareGitHubEntries(left, right) {
  const popularityDiff = getGitHubPopularityScore(right) - getGitHubPopularityScore(left);
  if (popularityDiff !== 0) {
    return popularityDiff;
  }

  const leftUpdated = left.github?.updatedAt ?? left.publishedAt ?? left.fetchedAt ?? "";
  const rightUpdated = right.github?.updatedAt ?? right.publishedAt ?? right.fetchedAt ?? "";
  return rightUpdated.localeCompare(leftUpdated);
}

function getGitHubPopularityScore(entry) {
  if (!entry.github) {
    return 0;
  }

  const stars = Number(entry.github.stars ?? 0);
  const watchers = Number(entry.github.watchers ?? 0);
  const forks = Number(entry.github.forks ?? 0);

  return stars * 5 + forks * 3 + watchers;
}

function summarizeNonGithubHighlights(entries) {
  if (entries.length === 0) {
    return {
      headline: "今天没有值得关注的非 GitHub 重点消息。",
      stats: ""
    };
  }

  const topSources = collectTopLabels(entries.map((entry) => entry.source));
  const topCategories = collectTopLabels(entries.map((entry) => entry.category));
  return {
    headline: `今天的非 GitHub 重点主要集中在 ${topCategories}。`,
    stats: `共选出 ${entries.length} 条重点，主要来自 ${topSources}。`
  };
}

function summarizeGithubHighlights(entries) {
  if (entries.length === 0) {
    return {
      headline: "今天没有值得关注的 GitHub 重点项目。",
      stats: ""
    };
  }

  const topCategories = collectTopLabels(entries.map((entry) => entry.category));
  const totalPopularity = entries.reduce((sum, entry) => sum + getGitHubPopularityScore(entry), 0);
  return {
    headline: `今天的 GitHub 热点以 ${topCategories} 为主。`,
    stats: `共选出 ${entries.length} 个项目，合计热度分 ${totalPopularity}。`
  };
}

function summarizeGithubSourceHighlights(sourceName, entries) {
  if (entries.length === 0) {
    return {
      headline: `今天没有来自 ${sourceName} 的重点项目。`,
      stats: ""
    };
  }

  const topCategories = collectTopLabels(entries.map((entry) => entry.category));
  const totalPopularity = entries.reduce((sum, entry) => sum + getGitHubPopularityScore(entry), 0);
  return {
    headline: `${sourceName} 今日热点以 ${topCategories} 为主。`,
    stats: `共选出 ${entries.length} 个项目，合计热度分 ${totalPopularity}。`
  };
}

function collectTopLabels(values, maxCount = 2) {
  const counts = new Map();
  for (const value of values) {
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .slice(0, maxCount)
    .map(([label]) => label);

  return ranked.length > 0 ? ranked.join("、") : "暂无明显集中方向";
}

function appendNonGithubHighlight(lines, entry, index) {
  lines.push(`${index}. **[${entry.titleZh ?? entry.title}](${entry.url})**`);
  lines.push(
    `   来源：${entry.source} | 分类：${entry.category} | 发布时间：${formatEntryDisplayTime(entry)}`
  );
  lines.push(`   评分：最终 ${getEntryDisplayScore(entry)} | 规则 ${entry.score ?? 0} | LLM ${Number(entry.llmScore ?? 0)}`);
  lines.push(`   核心摘要：${entry.highlightSummaryZh ?? entry.summaryZh ?? entry.summary}`);
  if (entry.highlightReasonZh) {
    lines.push(`   为什么重要：${entry.highlightReasonZh}`);
  }
  if (entry.titleZh) {
    lines.push(`   原文标题：${entry.title}`);
  }
  lines.push("");
}

function appendGithubHighlight(lines, entry, index) {
  lines.push(`${index}. **[${entry.titleZh ?? entry.title}](${entry.url})**`);
  lines.push(
    `   分类：${entry.category} | 热度分：${getGitHubPopularityScore(entry)} | 来源：${entry.source} | 最近更新：${entry.github?.updatedAtCn ?? formatEntryDisplayTime(entry)}`
  );
  if (entry.github) {
    lines.push(
      `   关键指标：Stars ${entry.github.stars ?? "unknown"} | Forks ${entry.github.forks ?? "unknown"} | Watchers ${entry.github.watchers ?? "unknown"} | Contributors ${entry.github.contributors ?? "unknown"}`
    );
  }
  lines.push(`   核心摘要：${entry.summaryZh ?? entry.summary}`);
  if (entry.titleZh) {
    lines.push(`   原文标题：${entry.title}`);
  }
  lines.push("");
}

function groupEntriesBySource(entries) {
  const groups = new Map();

  for (const entry of entries) {
    const bucket = groups.get(entry.source) ?? [];
    bucket.push(entry);
    groups.set(entry.source, bucket);
  }

  return [...groups.entries()]
    .map(([source, sourceEntries]) => [source, sourceEntries.slice().sort(compareSourceEntries)])
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));
}

function compareSourceEntries(left, right) {
  if (isGitHubEntry(left) || isGitHubEntry(right)) {
    const githubOrder = compareGitHubEntries(left, right);
    if (githubOrder !== 0) {
      return githubOrder;
    }
  } else {
    const scoreDiff = getEntryDisplayScore(right) - getEntryDisplayScore(left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
  }

  const leftTime = left.publishedAt || left.fetchedAt || "";
  const rightTime = right.publishedAt || right.fetchedAt || "";
  return rightTime.localeCompare(leftTime);
}

function getEntryDisplayScore(entry) {
  return Number(entry.blendedScore ?? entry.llmScore ?? entry.score ?? 0);
}

function slugifySourceName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "source";
}

function formatEntryDisplayTime(entry) {
  return formatBeijingTime(entry.publishedAt ?? entry.fetchedAt ?? "") || "unknown";
}

async function writeSourceReports(sourceGroups, { reportDir, dateSlug }) {
  const sourceDir = path.join(reportDir, "sources");
  await ensureDir(sourceDir);
  const sourceReports = [];

  for (const [source, sourceEntries] of sourceGroups) {
    const fileName = `${slugifySourceName(source)}.md`;
    const filePath = path.join(sourceDir, fileName);
    const relativePath = path.posix.join("sources", fileName);
    const latestEntry = sourceEntries[0];
    const lines = [
      `# ${source} - ${dateSlug}`,
      "",
      `- 条目数: ${sourceEntries.length}`,
      `- 最新时间: ${latestEntry ? formatEntryDisplayTime(latestEntry) : "unknown"}`,
      "",
      "## 条目明细",
      ""
    ];

    for (const entry of sourceEntries) {
      lines.push(`### [${entry.titleZh ?? entry.title}](${entry.url})`);
      lines.push(`- 发布时间: ${formatEntryDisplayTime(entry)}`);
      lines.push(`- 分类: ${entry.category}`);
      lines.push(`- 标签: ${entry.tags.join(", ") || "none"}`);
      if (isGitHubEntry(entry) && entry.github) {
        lines.push(`- 热度分: ${getGitHubPopularityScore(entry)}`);
        lines.push(
          `- 关键指标: Stars ${entry.github.stars ?? "unknown"} | Forks ${entry.github.forks ?? "unknown"} | Watchers ${entry.github.watchers ?? "unknown"} | Contributors ${entry.github.contributors ?? "unknown"}`
        );
        lines.push(`- 最近更新: ${entry.github.updatedAtCn ?? entry.github.updatedAt ?? "unknown"}`);
      } else {
        lines.push(`- 评分: 最终 ${getEntryDisplayScore(entry)} | 规则 ${entry.score ?? 0} | LLM ${Number(entry.llmScore ?? 0)}`);
      }
      lines.push(`- 摘要: ${entry.summaryZh ?? entry.summary}`);
      if (entry.titleZh) {
        lines.push(`- 原文标题: ${entry.title}`);
      }
      lines.push("");
    }

    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
    sourceReports.push({
      source,
      path: filePath,
      relativePath,
      count: sourceEntries.length,
      latestTime: latestEntry ? formatEntryDisplayTime(latestEntry) : "unknown",
      isGitHub: sourceEntries.some((entry) => isGitHubEntry(entry))
    });
  }

  return sourceReports;
}

export async function runPipeline({ verbose = false, sourceFilters = [], tagFilters = [] } = {}) {
  const sourceStatus = await loadSourceStatus();
  const allSources = sourceStatus.enabledSources;
  const sources = filterSources(allSources, { sourceFilters, tagFilters });
  const store = await loadStore();
  const existingEntries = store.entries ?? [];
  const existingIds = new Set(existingEntries.map((entry) => entry.id));
  const existingEntriesById = new Map(existingEntries.map((entry) => [entry.id, entry]));
  const fetchedAt = new Date().toISOString();
  const incomingEntries = [];
  const failures = [];
  const startedAtMs = Date.now();
  let createdCount = 0;
  let updatedCount = 0;
  const createdEntries = [];
  const translationConfig = getTranslationConfig();
  const highlightScoringConfig = getHighlightScoringConfig();
  const llmCache = await loadLlmCache();
  let translatedCount = 0;
  let translationSkippedCount = 0;
  let translationCacheHitCount = 0;
  let translationRequestedCount = 0;
  let translationRequestBatchCount = 0;
  let translationExistingFieldSkipCount = 0;
  let translationMissingContentSkipCount = 0;
  let translationFailureCacheSkipCount = 0;
  let translationFailedCount = 0;
  let translationUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let llmHighlightScoredCount = 0;
  let llmHighlightCacheHitCount = 0;
  let llmHighlightRequestedCount = 0;
  let llmHighlightRequestBatchCount = 0;
  let llmHighlightUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  if (sources.length === 0) {
    throw new Error("No sources matched the requested filters.");
  }

  if (verbose) {
    console.log(colorize(`[1/4] \u5df2\u52a0\u8f7d ${sources.length} \u4e2a\u4fe1\u606f\u6e90`, "bold"));
    console.log(colorize(`[1/4] \u5f53\u524d\u672c\u5730\u5e93\u5b58\u6761\u76ee: ${existingEntries.length}`, "dim"));
    if (sourceStatus.disabledSources.length > 0) {
      console.log(
        colorize(
          `[1/4] \u5df2\u5173\u95ed\u4fe1\u606f\u6e90: ${sourceStatus.disabledSources.map((source) => source.name).join(" | ")}`,
          "yellow"
        )
      );
    }
    console.log(
      colorize(
        `[1/4] \u4e2d\u6587\u7ffb\u8bd1: ${
          translationConfig.enabled ? `\u5df2\u542f\u7528 (${translationConfig.model})` : "\u672a\u542f\u7528"
        }`,
        translationConfig.enabled ? "green" : "dim"
      )
    );
    console.log(
      colorize(
        `[1/4] LLM \u91cd\u70b9\u6392\u5e8f: ${
          highlightScoringConfig.enabled ? `\u5df2\u542f\u7528 (${highlightScoringConfig.model})` : "\u672a\u542f\u7528"
        }`,
        highlightScoringConfig.enabled ? "green" : "dim"
      )
    );
  }

  for (const [index, source] of sources.entries()) {
    const sourceStartedAtMs = Date.now();
    if (verbose) {
      console.log("");
      console.log(colorize(`[2/4] \u4fe1\u606f\u6e90 ${index + 1}/${sources.length}: ${source.name}`, "blue"));
      console.log(colorize(`       \u7c7b\u578b: ${source.type}`, "dim"));
      console.log(colorize(`       URL: ${source.url}`, "dim"));
      console.log(colorize(`       \u6293\u53d6\u4e0a\u9650: ${source.limit ?? 20}`, "dim"));
      console.log(colorize("       \u72b6\u6001: \u6b63\u5728\u6293\u53d6...", "cyan"));
    }

    try {
      const { items, attempts } = await fetchSourceWithRetry(source, { verbose });
      const normalized = items.map((item) => normalizeEntry(item, source, fetchedAt, existingEntriesById.get(item.link)));
      const newEntriesForSource = normalized.filter((entry) => !existingIds.has(entry.id));
      const newCount = newEntriesForSource.length;
      const updatedSourceCount = normalized.length - newCount;
      const previewTitles = normalized.slice(0, 3).map((entry) => entry.title);

      createdCount += newCount;
      updatedCount += updatedSourceCount;
      createdEntries.push(...newEntriesForSource);
      incomingEntries.push(...normalized);

      if (verbose) {
        const elapsedMs = Date.now() - sourceStartedAtMs;
        console.log(colorize("       \u72b6\u6001: \u5b8c\u6210", "green"));
        console.log(colorize(`       \u5c1d\u8bd5\u6b21\u6570: ${attempts}`, "dim"));
        console.log(`       \u6293\u53d6\u6761\u6570: ${items.length} \u6761\uff0c\u8017\u65f6 ${formatDuration(elapsedMs)}`);
        console.log(`       \u89e3\u6790\u6761\u6570: ${normalized.length} \u6761`);
        console.log(
          colorize(
            `       \u65b0\u589e: ${newCount} | \u5237\u65b0: ${updatedSourceCount}`,
            newCount > 0 ? "green" : "dim"
          )
        );
        if (previewTitles.length > 0) {
          console.log(colorize("       \u9884\u89c8:", "dim"));
          for (const [previewIndex, title] of previewTitles.entries()) {
            console.log(`         ${previewIndex + 1}. ${truncate(title, 95)}`);
          }
        } else {
          console.log(colorize("       \u9884\u89c8: \u6ca1\u6709\u6761\u76ee", "dim"));
        }
      }
    } catch (error) {
      const category = classifyFetchError(error);
      failures.push({
        source: source.name,
        message: error.message,
        attempts: MAX_FETCH_ATTEMPTS,
        category
      });
      if (verbose) {
        const elapsedMs = Date.now() - sourceStartedAtMs;
        console.log(colorize(`       \u72b6\u6001: \u5931\u8d25\uff0c\u8017\u65f6 ${formatDuration(elapsedMs)}`, "red"));
        console.log(colorize(`       \u9519\u8bef\u7c7b\u578b: ${translateErrorCategory(category)}`, "red"));
        console.log(colorize(`       \u9519\u8bef\u4fe1\u606f: ${error.message}`, "red"));
        console.log(colorize(`       \u5df2\u5c1d\u8bd5\u6b21\u6570: ${MAX_FETCH_ATTEMPTS}`, "yellow"));
      }
    }
  }

  if (verbose) {
    console.log("");
    console.log(colorize("[3/4] \u6b63\u5728\u5408\u5e76\u6761\u76ee\u5e76\u5199\u5165\u672c\u5730\u5b58\u50a8...", "bold"));
  }

  if (translationConfig.enabled) {
    if (verbose) {
      console.log(colorize("[3/4] \u6b63\u5728\u628a\u6807\u9898\u548c\u6458\u8981\u7ffb\u8bd1\u6210\u7b80\u4f53\u4e2d\u6587...", "bold"));
    }
    const translationResult = await translateEntries(incomingEntries, {
      config: translationConfig,
      verbose,
      cache: {
        getTranslation: (entryId) => getCachedTranslation(llmCache, entryId),
        setTranslation: (entryId, value) => setCachedTranslation(llmCache, entryId, value),
        getTranslationFailure: (entryId) => getCachedTranslationFailure(llmCache, entryId),
        setTranslationFailure: (entryId, value) => setCachedTranslationFailure(llmCache, entryId, value),
        clearTranslationFailure: (entryId) => clearCachedTranslationFailure(llmCache, entryId)
      }
    });
    translatedCount = translationResult.translatedCount;
    translationSkippedCount = translationResult.skippedCount;
    translationCacheHitCount = translationResult.cacheHitCount;
    translationRequestedCount = translationResult.requestedEntries;
    translationRequestBatchCount = translationResult.requestBatchCount;
    translationExistingFieldSkipCount = translationResult.existingTranslationSkippedCount;
    translationMissingContentSkipCount = translationResult.missingContentSkippedCount;
    translationFailureCacheSkipCount = translationResult.failureCacheSkippedCount;
    translationFailedCount = translationResult.failedCount;
    translationUsage = translationResult.usage;
    if (verbose) {
      console.log(
        colorize(
          `[3/4] \u7ffb\u8bd1\u5b8c\u6210: ${translatedCount} \u6761\u5df2\u7ffb\u8bd1\uff0c${translationSkippedCount} \u6761\u8df3\u8fc7`,
          translatedCount > 0 ? "green" : "dim"
        )
      );
      console.log(
        colorize(
          `[3/4] \u5b9e\u9645\u8c03\u7528\u7ffb\u8bd1 LLM: ${translationRequestedCount} \u6761\uff0c${translationRequestBatchCount} \u6279`,
          translationRequestedCount > 0 ? "green" : "dim"
        )
      );
      if (translationExistingFieldSkipCount > 0) {
        console.log(
          colorize(
            `[3/4] \u5df2\u6709\u4e2d\u6587\u5b57\u6bb5\u76f4\u63a5\u8df3\u8fc7: ${translationExistingFieldSkipCount} \u6761`,
            "dim"
          )
        );
      }
      if (translationCacheHitCount > 0) {
        console.log(colorize(`[3/4] \u7ffb\u8bd1\u7f13\u5b58\u547d\u4e2d: ${translationCacheHitCount} \u6761`, "green"));
      }
      if (translationFailureCacheSkipCount > 0) {
        console.log(
          colorize(
            `[3/4] 当天翻译失败缓存跳过: ${translationFailureCacheSkipCount} 条`,
            "yellow"
          )
        );
      }
      if (translationMissingContentSkipCount > 0) {
        console.log(
          colorize(
            `[3/4] \u7f3a\u5c11\u6807\u9898\u6216\u6458\u8981\u8df3\u8fc7: ${translationMissingContentSkipCount} \u6761`,
            "yellow"
          )
        );
      }
      if (translationFailedCount > 0) {
        console.log(colorize(`[3/4] 本轮翻译失败: ${translationFailedCount} 条`, "yellow"));
      }
      if (translationUsage.totalTokens > 0) {
        console.log(
          colorize(
            `[3/4] \u7ffb\u8bd1 Token \u6d88\u8017: \u8f93\u5165 ${translationUsage.inputTokens} | \u8f93\u51fa ${translationUsage.outputTokens} | \u5408\u8ba1 ${translationUsage.totalTokens}`,
            "dim"
          )
        );
      }
    }
  }

  const mergedEntries = mergeEntries(existingEntries, incomingEntries);
  await saveStore({ updatedAt: fetchedAt, entries: mergedEntries });

  if (verbose) {
    console.log(colorize(`[3/4] \u5b58\u50a8\u5df2\u66f4\u65b0: \u5f53\u524d\u5171 ${mergedEntries.length} \u6761`, "dim"));
    console.log(
      colorize(
        `[3/4] \u672c\u8f6e\u53d8\u5316: \u65b0\u589e ${createdCount} \u6761\uff0c\u5237\u65b0 ${updatedCount} \u6761`,
        createdCount > 0 ? "green" : "dim"
      )
    );
    if (highlightScoringConfig.enabled) {
      console.log(colorize("[3/4] \u6b63\u5728\u7528 LLM \u4e3a Highlights \u5019\u9009\u6761\u76ee\u6253\u5206...", "bold"));
    }
    console.log(colorize("[4/4] \u6b63\u5728\u5199\u5165\u4eca\u65e5\u65e5\u62a5...", "bold"));
  }

  const reportOutput = await writeDailyReport(mergedEntries, failures, {
    highlightScoringConfig,
    verbose,
    highlightCache: {
      getHighlight: (entryId) => getCachedHighlight(llmCache, entryId),
      setHighlight: (entryId, value) => setCachedHighlight(llmCache, entryId, value)
    }
  });
  llmHighlightScoredCount = reportOutput.llmHighlightScoredCount;
  llmHighlightCacheHitCount = reportOutput.llmHighlightCacheHitCount;
  llmHighlightRequestedCount = reportOutput.llmHighlightRequestedCount;
  llmHighlightRequestBatchCount = reportOutput.llmHighlightRequestBatchCount;
  llmHighlightUsage = reportOutput.llmHighlightUsage;
  await saveLlmCache(llmCache);

  if (verbose) {
    console.log(colorize(`[4/4] \u65e5\u62a5\u5df2\u5199\u5165: ${reportOutput.reportPath}`, "green"));
    if (createdEntries.length > 0) {
      console.log(colorize("[4/4] \u672c\u6b21\u771f\u65b0\u589e\u6761\u76ee:", "green"));
      for (const [createdIndex, entry] of createdEntries.slice(0, 5).entries()) {
        console.log(`       ${createdIndex + 1}. ${truncate(entry.title, 95)} [${entry.source}]`);
      }
    } else {
      console.log(colorize("[4/4] \u672c\u6b21\u771f\u65b0\u589e\u6761\u76ee: \u65e0", "dim"));
    }
    if (reportOutput.nonGithubTopEntries.length > 0) {
      console.log(colorize("[4/4] \u975e GitHub \u4eca\u65e5\u91cd\u70b9:", "bold"));
      for (const [highlightIndex, entry] of reportOutput.nonGithubTopEntries.entries()) {
        console.log(`       ${highlightIndex + 1}. ${truncate(entry.titleZh ?? entry.title, 95)} [${entry.category}]`);
      }
    } else {
      console.log(colorize("[4/4] \u975e GitHub \u4eca\u65e5\u91cd\u70b9: \u65e0", "dim"));
    }
    if (reportOutput.githubTopEntries.length > 0) {
      console.log(colorize("[4/4] GitHub \u4eca\u65e5\u91cd\u70b9:", "bold"));
      for (const [highlightIndex, entry] of reportOutput.githubTopEntries.entries()) {
        console.log(
          `       ${highlightIndex + 1}. ${truncate(entry.titleZh ?? entry.title, 95)} [${entry.category}] | \u70ed\u5ea6\u5206 ${getGitHubPopularityScore(entry)}`
        );
      }
    } else {
      console.log(colorize("[4/4] GitHub \u4eca\u65e5\u91cd\u70b9: \u65e0", "dim"));
    }
    if (llmHighlightCacheHitCount > 0) {
      console.log(colorize(`[4/4] Highlights \u7f13\u5b58\u547d\u4e2d: ${llmHighlightCacheHitCount} \u6761`, "green"));
    }
    if (highlightScoringConfig.enabled) {
      console.log(
        colorize(
          `[4/4] \u5b9e\u9645\u8c03\u7528 Highlights LLM: ${llmHighlightRequestedCount} \u6761\uff0c${llmHighlightRequestBatchCount} \u6279`,
          llmHighlightRequestedCount > 0 ? "green" : "dim"
        )
      );
      if (llmHighlightUsage.totalTokens > 0) {
        console.log(
          colorize(
            `[4/4] Highlights Token \u6d88\u8017: \u8f93\u5165 ${llmHighlightUsage.inputTokens} | \u8f93\u51fa ${llmHighlightUsage.outputTokens} | \u5408\u8ba1 ${llmHighlightUsage.totalTokens}`,
            "dim"
          )
        );
      }
    }
    console.log(colorize(`\u603b\u8017\u65f6: ${formatDuration(Date.now() - startedAtMs)}`, "bold"));
  }

  return {
    fetchedAt,
    sources: sources.length,
    selectedSourceNames: sources.map((source) => source.name),
    newEntries: incomingEntries.length,
    createdEntries: createdCount,
    refreshedEntries: updatedCount,
    totalEntries: mergedEntries.length,
    createdEntryPreview: createdEntries.slice(0, 5),
    githubCreatedEntryPreview: createdEntries.filter((entry) => isGitHubEntry(entry)).sort(compareGitHubEntries).slice(0, 5),
    translationEnabled: translationConfig.enabled,
    translationModel: translationConfig.enabled ? translationConfig.model : null,
    translatedEntries: translatedCount,
    translationSkippedEntries: translationSkippedCount,
    translationCacheHits: translationCacheHitCount,
    translationRequestedEntries: translationRequestedCount,
    translationRequestBatchCount,
    translationExistingFieldSkips: translationExistingFieldSkipCount,
    translationMissingContentSkips: translationMissingContentSkipCount,
    translationFailureCacheSkips: translationFailureCacheSkipCount,
    translationFailedEntries: translationFailedCount,
    translationUsage,
    llmHighlightScoringEnabled: highlightScoringConfig.enabled,
    llmHighlightModel: highlightScoringConfig.enabled ? highlightScoringConfig.model : null,
    llmHighlightScoredCount,
    llmHighlightCacheHits: llmHighlightCacheHitCount,
    llmHighlightRequestedEntries: llmHighlightRequestedCount,
    llmHighlightRequestBatchCount,
    llmHighlightUsage,
    failures,
    reportPath: reportOutput.reportPath,
    reportHighlights: reportOutput.nonGithubTopEntries,
    reportHighlightsNonGithub: reportOutput.nonGithubTopEntries,
    reportHighlightsGithub: reportOutput.githubTopEntries
  };
}

function filterSources(sources, { sourceFilters = [], tagFilters = [] } = {}) {
  if (sourceFilters.length === 0 && tagFilters.length === 0) {
    return sources;
  }

  const normalizedSourceFilters = sourceFilters.map((value) => value.toLowerCase());
  const normalizedTagFilters = tagFilters.map((value) => value.toLowerCase());

  return sources.filter((source) => {
    const sourceName = source.name.toLowerCase();
    const sourceTags = (source.tags ?? []).map((tag) => String(tag).toLowerCase());
    const sourceMatches =
      normalizedSourceFilters.length === 0 ||
      normalizedSourceFilters.some((filter) => sourceName.includes(filter));
    const tagMatches =
      normalizedTagFilters.length === 0 ||
      normalizedTagFilters.some((filter) => sourceTags.includes(filter));

    return sourceMatches && tagMatches;
  });
}

function formatDuration(durationMs) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatBeijingTime(value) {
  if (!value) {
    return "unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("zh-CN", {
    hour12: false,
    timeZone: APP_CONFIG.timeZone
  });
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function classifyFetchError(error) {
  const message = String(error?.message ?? "").toLowerCase();

  if (message.includes("404") || message.includes("403") || message.includes("500") || message.includes("failed to fetch")) {
    return "http";
  }
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) {
    return "timeout";
  }
  if (message.includes("enotfound") || message.includes("eai_again") || message.includes("getaddrinfo") || message.includes("dns")) {
    return "dns";
  }
  if (message.includes("xml") || message.includes("parse") || message.includes("unexpected token")) {
    return "parse";
  }

  return "unknown";
}

function translateErrorCategory(category) {
  switch (category) {
    case "http":
      return "HTTP";
    case "timeout":
      return "\u8d85\u65f6";
    case "dns":
      return "DNS";
    case "parse":
      return "\u89e3\u6790";
    default:
      return "\u672a\u77e5";
  }
}

function colorize(value, color) {
  if (process.env.NO_COLOR === "1" || process.env.NO_COLOR === "true") {
    return value;
  }
  const code = ANSI[color];
  if (!code) {
    return value;
  }
  return `${code}${value}${ANSI.reset}`;
}

export async function writeDailyReport(entries, failures = [], options = {}) {
  await ensureDir(REPORTS_DIR);
  const dateSlug = slugDate();
  const reportId = slugHour();
  const reportDir = path.join(REPORTS_DIR, reportId);
  await ensureDir(reportDir);
  const reportPath = path.join(reportDir, "overview.md");
  const recentEntries = entries.filter((entry) => (entry.fetchedAt || "").startsWith(dateSlug));
  const nonGithubEntries = recentEntries.filter((entry) => !isGitHubEntry(entry));
  const githubEntries = recentEntries.filter((entry) => isGitHubEntry(entry));
  const sourceGroups = groupEntriesBySource(recentEntries);
  const nonGithubHighlightCandidates = pickHighlightCandidates(nonGithubEntries, Math.max(NON_GITHUB_HIGHLIGHT_LIMIT, 10));
  const scoredNonGithubHighlights = await scoreHighlightCandidates(nonGithubHighlightCandidates, {
    config: options.highlightScoringConfig,
    verbose: options.verbose,
    cache: options.highlightCache
  });
  const nonGithubTopEntries = scoredNonGithubHighlights.scoredEntries.slice(0, NON_GITHUB_HIGHLIGHT_LIMIT);
  const githubRisingTopEntries = githubEntries
    .filter((entry) => entry.source === "GitHub Rising AI")
    .slice()
    .sort(compareGitHubEntries)
    .slice(0, GITHUB_HIGHLIGHT_LIMIT);
  const githubTopicTopEntries = githubEntries
    .filter((entry) => entry.source === "GitHub AI Topic")
    .slice()
    .sort(compareGitHubEntries)
    .slice(0, GITHUB_HIGHLIGHT_LIMIT);
  const githubTopEntries = [...githubRisingTopEntries, ...githubTopicTopEntries];
  const sourceReports = await writeSourceReports(sourceGroups, { reportDir, dateSlug });

  const lines = [
    `# AI 日报 - ${dateSlug}`,
    "",
    `- 生成时间: ${new Date().toLocaleString("zh-CN", { hour12: false, timeZone: APP_CONFIG.timeZone })}`,
    `- 今日抓取条目: ${recentEntries.length}`,
    `- 失败源数: ${failures.length}`,
    "",
    "## 今日重点",
    ""
  ];

  if (nonGithubTopEntries.length === 0 && githubRisingTopEntries.length === 0 && githubTopicTopEntries.length === 0) {
    lines.push("今天没有采集到新条目。");
    lines.push("");
  } else {
    const nonGithubSummary = summarizeNonGithubHighlights(nonGithubTopEntries);
    const githubRisingSummary = summarizeGithubSourceHighlights("GitHub Rising AI", githubRisingTopEntries);
    const githubTopicSummary = summarizeGithubSourceHighlights("GitHub AI Topic", githubTopicTopEntries);

    lines.push(`### 非 GitHub 来源 Top ${NON_GITHUB_HIGHLIGHT_LIMIT}`);
    lines.push("");
    lines.push(nonGithubSummary.headline);
    if (nonGithubSummary.stats) {
      lines.push(nonGithubSummary.stats);
    }
    lines.push("");
    if (nonGithubTopEntries.length === 0) {
    } else {
      for (const [index, entry] of nonGithubTopEntries.entries()) {
        appendNonGithubHighlight(lines, entry, index + 1);
      }
    }

    lines.push(`### GitHub Rising AI Top ${GITHUB_HIGHLIGHT_LIMIT}`);
    lines.push("");
    lines.push(githubRisingSummary.headline);
    if (githubRisingSummary.stats) {
      lines.push(githubRisingSummary.stats);
    }
    lines.push("");
    if (githubRisingTopEntries.length === 0) {
    } else {
      for (const [index, entry] of githubRisingTopEntries.entries()) {
        appendGithubHighlight(lines, entry, index + 1);
      }
    }

    lines.push(`### GitHub AI Topic Top ${GITHUB_HIGHLIGHT_LIMIT}`);
    lines.push("");
    lines.push(githubTopicSummary.headline);
    if (githubTopicSummary.stats) {
      lines.push(githubTopicSummary.stats);
    }
    lines.push("");
    if (githubTopicTopEntries.length === 0) {
    } else {
      for (const [index, entry] of githubTopicTopEntries.entries()) {
        appendGithubHighlight(lines, entry, index + 1);
      }
    }
  }

  lines.push("## 来源概览");
  lines.push("");
  if (sourceReports.length === 0) {
    lines.push("今天没有来源明细。");
    lines.push("");
  } else {
    for (const sourceReport of sourceReports) {
      lines.push(`### [${sourceReport.source}](${sourceReport.relativePath})`);
      lines.push(`- 条目数: ${sourceReport.count}`);
      lines.push(`- 最新时间: ${sourceReport.latestTime}`);
      lines.push(`- 类型: ${sourceReport.isGitHub ? "GitHub / Open Source" : "资讯源"}`);
      lines.push("");
    }
  }

  if (failures.length > 0) {
    lines.push("## 失败信息");
    lines.push("");
    for (const failure of failures) {
      lines.push(
        `- ${failure.source}: ${failure.message} (类型: ${failure.category ?? "unknown"}, 尝试次数: ${failure.attempts ?? 1})`
      );
    }
    lines.push("");
  }

  await writeFile(reportPath, `${lines.join("\n")}\n`, "utf8");
  return {
    reportPath,
    sourceReports,
    nonGithubTopEntries,
    githubTopEntries,
    llmHighlightScoredCount: scoredNonGithubHighlights.scoredCount,
    llmHighlightCacheHitCount: scoredNonGithubHighlights.cacheHitCount,
    llmHighlightRequestedCount: scoredNonGithubHighlights.requestedEntries,
    llmHighlightRequestBatchCount: scoredNonGithubHighlights.requestBatchCount,
    llmHighlightUsage: scoredNonGithubHighlights.usage
  };
}

