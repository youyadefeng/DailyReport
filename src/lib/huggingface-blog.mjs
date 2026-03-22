import { decodeHtmlEntities, stripHtml } from "./text-utils.mjs";

const HUGGING_FACE_ROOT = "https://huggingface.co";

export function parseHuggingFaceBlog(html, source = {}) {
  const payload = extractArticlesPayload(html);
  const blogs = Array.isArray(payload?.allBlogs) ? payload.allBlogs : [];

  return blogs
    .map((blog) => normalizeBlog(blog))
    .filter(Boolean)
    .slice(0, source.limit ?? 20);
}

function extractArticlesPayload(html) {
  const match = html.match(/data-target="Articles"\s+data-props="(?<props>[\s\S]*?)"/i);
  if (!match?.groups?.props) {
    throw new Error("Unable to locate Hugging Face blog data payload.");
  }

  const decoded = decodeHtmlEntities(match.groups.props);
  return JSON.parse(decoded);
}

function normalizeBlog(blog) {
  const title = normalizeText(blog?.title);
  const href = String(blog?.url ?? "").trim();

  if (!title || !href) {
    return null;
  }

  const authorNames = Array.isArray(blog?.authorsData)
    ? blog.authorsData
        .map((author) => normalizeText(author?.fullname || author?.name))
        .filter(Boolean)
    : [];

  const descriptionParts = [];
  if (authorNames.length > 0) {
    descriptionParts.push(`Authors: ${authorNames.join(", ")}`);
  }
  if (typeof blog?.upvotes === "number") {
    descriptionParts.push(`Upvotes: ${blog.upvotes}`);
  }
  if (blog?.isHFChangelog) {
    descriptionParts.push("Type: HF changelog");
  }

  const description = descriptionParts.join(" | ");

  return {
    title,
    link: href.startsWith("http") ? href : `${HUGGING_FACE_ROOT}${href}`,
    publishedAt: normalizeDate(blog?.publishedAt),
    description,
    rawContent: description || title
  };
}

function normalizeText(value) {
  return stripHtml(decodeHtmlEntities(String(value || ""))).replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    return null;
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return cleaned;
  }

  return parsed.toISOString();
}
