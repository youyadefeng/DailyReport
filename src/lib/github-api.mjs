import { fetchResponse } from "./http-utils.mjs";
import { APP_CONFIG } from "../../config/project.config.mjs";

const GITHUB_API_ACCEPT = APP_CONFIG.github.apiAccept;
const CONTRIBUTOR_TIMEOUT_MS = APP_CONFIG.network.githubContributorTimeoutMs;

export async function parseGitHubSearchResponse(jsonText, source = {}) {
  const payload = JSON.parse(jsonText);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const repositories = items
    .map((item) => normalizeRepository(item, source))
    .filter(Boolean)
    .slice(0, source.limit ?? 20);

  await enrichContributorCounts(repositories);
  return repositories;
}

function normalizeRepository(item, source) {
  if (!item?.html_url || !item?.full_name) {
    return null;
  }

  const stars = Number(item.stargazers_count ?? 0);
  const watchers = Number(item.watchers_count ?? item.watchers ?? stars);
  const forks = Number(item.forks_count ?? 0);
  const openIssues = Number(item.open_issues_count ?? 0);
  const topics = Array.isArray(item.topics) ? item.topics.filter(Boolean) : [];
  const language = item.language || "";
  const description = item.description || `${item.full_name} on GitHub`;
  const updatedAt = item.updated_at || item.pushed_at || null;
  const updatedAtCn = formatBeijingTime(updatedAt);
  const rawParts = [
    description,
    language ? `Language: ${language}` : "",
    stars ? `Stars: ${stars}` : "",
    watchers ? `Watchers: ${watchers}` : "",
    forks ? `Forks: ${forks}` : "",
    openIssues ? `Open issues: ${openIssues}` : "",
    updatedAt ? `Updated: ${updatedAt}` : "",
    topics.length > 0 ? `Topics: ${topics.join(", ")}` : ""
  ].filter(Boolean);

  return {
    title: item.full_name,
    link: item.html_url,
    publishedAt: updatedAt,
    description,
    rawContent: rawParts.join(". "),
    sourceScoreBoost: source.sort === "stars" ? 8 : 5,
    github: {
      fullName: item.full_name,
      language,
      stars,
      watchers,
      forks,
      openIssues,
      contributors: null,
      updatedAt,
      updatedAtCn,
      topics
    },
    githubContributorsUrl: typeof item.contributors_url === "string" ? item.contributors_url : null
  };
}

async function enrichContributorCounts(repositories) {
  await Promise.all(
    repositories.map(async (repository) => {
      if (!repository.githubContributorsUrl) {
        return;
      }

      try {
        const contributorsUrl = repository.githubContributorsUrl.replace("{/anon}", "?per_page=1&anon=true");
        const response = await fetchResponse(contributorsUrl, {
          headers: {
            "user-agent": "ai-news-pipeline/1.0",
            accept: GITHUB_API_ACCEPT
          },
          timeoutMs: CONTRIBUTOR_TIMEOUT_MS
        });

        repository.github.contributors = parseContributorCount(response);
        repository.rawContent = appendContributorCount(repository.rawContent, repository.github.contributors);
      } catch {
        repository.github.contributors = null;
      } finally {
        delete repository.githubContributorsUrl;
      }
    })
  );
}

function parseContributorCount(response) {
  const linkHeader = response.headers.link;
  if (typeof linkHeader === "string") {
    const lastMatch = linkHeader.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/i);
    if (lastMatch) {
      return Number(lastMatch[1]);
    }
  }

  const parsed = JSON.parse(response.body);
  if (Array.isArray(parsed)) {
    return parsed.length;
  }

  return null;
}

function appendContributorCount(rawContent, contributorCount) {
  if (!Number.isFinite(contributorCount) || contributorCount <= 0) {
    return rawContent;
  }

  return `${rawContent}. Contributors: ${contributorCount}`;
}

function formatBeijingTime(value) {
  if (!value) {
    return null;
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
