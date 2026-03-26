import path from "node:path";
import { writeFile } from "node:fs/promises";
import { APP_CONFIG } from "../../config/project.config.mjs";
import { ensureDir, readJson, writeJson } from "./fs-utils.mjs";
import { fetchText } from "./http-utils.mjs";
import { decodeHtmlEntities, prepareTranslationText, stripHtml } from "./text-utils.mjs";

const PRACTICE_CONFIG = APP_CONFIG.practiceReads;
const HISTORY_FILE = APP_CONFIG.paths.practiceReadHistoryFile;
const MAX_VISUALS_PER_ARTICLE = Number(process.env.MINIMAX_PRACTICE_MAX_IMAGES ?? 3);

const VISUAL_SECTION_KEYS = new Set([
  "problem",
  "explanation",
  "analogy",
  "built",
  "workflow",
  "example",
  "what_to_learn",
  "where_to_apply",
  "when_to_use",
  "takeaways"
]);

const DEEP_READ_SYSTEM_PROMPT = [
  "You help a Chinese reader deeply understand an AI engineering or research article.",
  "Write like a strong human teacher explaining the article to another human.",
  "Be concrete, intuitive, and practical.",
  "Do not sound like a press release, abstract, outline generator, or literal translation.",
  "If visuals are useful, propose explanatory diagrams instead of decorative cover art.",
  "Return JSON only."
].join(" ");

export async function generatePracticeReads(entries, { reportDir, verbose = false } = {}) {
  const config = getPracticeReadConfig();
  if (!config.enabled || !reportDir || !Array.isArray(entries) || entries.length === 0) {
    return emptyPracticeReadResult(config.enabled);
  }

  const history = await loadPracticeReadHistory();
  const outputDir = path.join(reportDir, PRACTICE_CONFIG.outputDirName);
  const imageDir = path.join(outputDir, "images");
  await ensureDir(outputDir);
  await ensureDir(imageDir);

  const candidates = entries
    .slice(0, PRACTICE_CONFIG.candidatePoolSize)
    .filter((entry) => !history.items[entry.id])
    .slice(0, PRACTICE_CONFIG.maxPerRun);

  if (candidates.length === 0) {
    await writePracticeReadIndex(outputDir, history);
    return {
      ...emptyPracticeReadResult(true),
      skippedExistingCount: Math.min(entries.length, PRACTICE_CONFIG.candidatePoolSize)
    };
  }

  const generatedItems = [];
  const usage = createEmptyUsage();

  for (const [index, entry] of candidates.entries()) {
    if (verbose) {
      console.log(`       正在生成工程实践精读 ${index + 1}/${candidates.length}: ${entry.titleZh ?? entry.title}`);
    }

    try {
      const article = await fetchArticleForDeepRead(entry.url);
      const deepRead = await requestMiniMaxDeepRead({ entry, article, config });
      mergeUsage(usage, deepRead.usage);

      const slug = slugify(entry.titleZh ?? entry.title);
      const markdownPath = path.join(outputDir, `${slug}.md`);
      const markdownRelativePath = path.posix.join(PRACTICE_CONFIG.outputDirName, `${slug}.md`);
      const renderedVisuals = [];

      for (const [visualIndex, visual] of deepRead.visuals.entries()) {
        try {
          const imageBuffer = await requestMiniMaxImage(visual.imagePrompt, config);
          const imageFileName = `${slug}-${visualIndex + 1}.jpg`;
          const imagePath = path.join(imageDir, imageFileName);
          await writeFile(imagePath, imageBuffer);
          renderedVisuals.push({
            ...visual,
            relativePath: path.posix.join("images", imageFileName)
          });
        } catch (error) {
          if (verbose) {
            console.log(`       实践精读配图失败，已跳过第 ${visualIndex + 1} 张图: ${error.message}`);
          }
        }
      }

      await writeFile(markdownPath, renderPracticeReadMarkdown(entry, deepRead, renderedVisuals), "utf8");

      generatedItems.push({
        id: entry.id,
        title: deepRead.titleZh || entry.titleZh || entry.title,
        source: entry.source,
        url: entry.url,
        path: markdownPath,
        relativePath: markdownRelativePath
      });

      history.items[entry.id] = {
        id: entry.id,
        title: entry.title,
        titleZh: deepRead.titleZh || entry.titleZh || null,
        source: entry.source,
        url: entry.url,
        generatedAt: new Date().toISOString(),
        outputPath: markdownPath
      };
      history.updatedAt = new Date().toISOString();
      await savePracticeReadHistory(history);
    } catch (error) {
      if (verbose) {
        console.log(`       实践精读失败，已跳过: ${error.message}`);
      }
    }
  }

  await writePracticeReadIndex(outputDir, history);

  return {
    enabled: true,
    generatedCount: generatedItems.length,
    generatedItems,
    skippedExistingCount: entries.length - candidates.length,
    usage
  };
}

function emptyPracticeReadResult(enabled) {
  return {
    enabled,
    generatedCount: 0,
    generatedItems: [],
    skippedExistingCount: 0,
    usage: createEmptyUsage()
  };
}

function getPracticeReadConfig() {
  const apiKey = process.env.MINIMAX_API_KEY?.trim();
  if (!apiKey) {
    return { enabled: false };
  }

  return {
    enabled: true,
    apiKey,
    baseUrl: normalizeBaseUrl(process.env.MINIMAX_BASE_URL || PRACTICE_CONFIG.minimax.defaultBaseUrl),
    textModel:
      process.env.MINIMAX_PRACTICE_TEXT_MODEL ||
      process.env.MINIMAX_TRANSLATION_MODEL ||
      PRACTICE_CONFIG.minimax.textModel,
    imageModel:
      process.env.MINIMAX_PRACTICE_IMAGE_MODEL ||
      process.env.MINIMAX_IMAGE_MODEL ||
      PRACTICE_CONFIG.minimax.imageModel
  };
}

async function fetchArticleForDeepRead(url) {
  const html = await fetchText(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "text/html,application/xhtml+xml"
    }
  });

  const title = extractTitle(html);
  const description = extractMetaDescription(html);
  const mainHtml = extractArticleHtml(html);
  const bodyText = prepareTranslationText(stripHtml(mainHtml || html), PRACTICE_CONFIG.maxArticleChars);

  return {
    title,
    description,
    bodyText
  };
}

async function requestMiniMaxDeepRead({ entry, article, config }) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.textModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: DEEP_READ_SYSTEM_PROMPT
        },
        {
          role: "user",
          content: JSON.stringify({
            article: {
              id: entry.id,
              source: entry.source,
              url: entry.url,
              title: entry.title,
              title_zh: entry.titleZh || "",
              summary: entry.summary,
              summary_zh: entry.summaryZh || "",
              page_title: article.title,
              page_description: article.description,
              body_text: article.bodyText
            },
            writing_style: {
              target_reader: "懂一点 AI，但不想读一篇又硬又绕的原文，希望有人把重点讲明白。",
              tone: "自然、清楚、有讲解感，像靠谱同事在解释一篇值得读的文章。",
              avoid: [
                "空洞套话",
                "机械罗列",
                "逐段复述原文",
                "营销腔",
                "论文摘要腔"
              ]
            },
            output_requirements: {
              title_zh: "自然中文标题，不要翻译腔。",
              one_sentence_takeaway: "1-2 句，先把最该知道的结论讲清楚。",
              problem_it_solves: "这篇文章到底想解决什么具体问题，为什么以前做法不够好。",
              plain_explanation: "把文章讲成人话，让读者快速抓住它的主线。",
              intuitive_analogy: "如果适合，给一个帮助理解的类比；不适合就留空。",
              why_it_matters: "1-3 句，说明为什么值得读、会影响谁。",
              what_they_actually_built: "作者到底做了什么，重点讲结构、关键组件、真实做法。",
              workflow_steps: "3-6 条步骤数组，按真实流程拆开。",
              concrete_example: "给一个具体、贴近真实使用的例子。",
              what_to_learn: "3-5 条数组。站在读者角度总结：我到底该学什么方法、习惯、判断标准或实践动作。尽量具体，可迁移，可执行，不要空话。",
              where_to_apply: "2-4 条数组。告诉读者这些方法、思路或设计模式可以落地到哪些具体工作场景里，尽量写得接地气。",
              when_to_use: "什么场景适合用，什么场景不适合用。",
              key_points: "3-5 条关键要点数组，像人类读完后的重点笔记。",
              takeaways: "2-4 条最值得记住的结论。",
              glossary: [
                {
                  term: "术语",
                  explanation: "通俗解释"
                }
              ],
              visuals: [
                {
                  section_key: "problem/explanation/analogy/built/workflow/example/what_to_learn/where_to_apply/when_to_use/takeaways",
                  title_zh: "这张图在解释什么",
                  purpose_zh: "一句中文说明，这张图会帮助读者理解哪件事",
                  image_prompt: "English prompt for the image model. Generate a clean explanatory diagram, workflow map, architecture diagram, or comparison graphic that matches the article. Prefer no words inside the image. Do not use paragraphs, code, UI screenshots, or small labels. Do not generate cover art, robot faces, neon brains, or generic sci-fi backgrounds. Use large simple shapes, arrows, and visual grouping so the picture is readable even without text."
                }
              ],
              visual_rules: [
                "只有在图片真的能帮助理解时才返回 visuals",
                `最多 ${MAX_VISUALS_PER_ARTICLE} 张图`,
                "每张图都必须对应正文里的一个具体概念、流程、结构或对比",
                "优先选择流程图、架构图、关系图、阶段对比图",
                "尽量不要在图里放小字",
                "如果必须出现文字，也只能是极少量、非常大的中性标签，但优先无字图",
                "如果没必要，就返回空数组"
              ]
            }
          })
        }
      ]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax deep read failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("MiniMax deep read returned empty content.");
  }

  const parsed = parseModelJson(content);
  return {
    titleZh: String(parsed.title_zh || "").trim(),
    oneSentenceTakeaway: String(parsed.one_sentence_takeaway || "").trim(),
    problemItSolves: String(parsed.problem_it_solves || "").trim(),
    plainExplanation: String(parsed.plain_explanation || "").trim(),
    intuitiveAnalogy: String(parsed.intuitive_analogy || "").trim(),
    whyItMatters: String(parsed.why_it_matters || "").trim(),
    whatTheyActuallyBuilt: String(parsed.what_they_actually_built || "").trim(),
    workflowSteps: normalizeStringArray(parsed.workflow_steps),
    concreteExample: String(parsed.concrete_example || "").trim(),
    whatToLearn: normalizeStringArray(parsed.what_to_learn),
    whereToApply: normalizeStringArray(parsed.where_to_apply),
    whenToUse: String(parsed.when_to_use || "").trim(),
    keyPoints: normalizeStringArray(parsed.key_points),
    takeaways: normalizeStringArray(parsed.takeaways),
    glossary: normalizeGlossary(parsed.glossary),
    visuals: normalizeVisuals(parsed.visuals),
    usage: normalizeUsage(payload?.usage)
  };
}

async function requestMiniMaxImage(prompt, config) {
  const response = await fetch(`${config.baseUrl}/image_generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: config.imageModel,
      prompt,
      aspect_ratio: PRACTICE_CONFIG.imageAspectRatio,
      response_format: "base64",
      n: 1,
      prompt_optimizer: true
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiniMax image generation failed: ${response.status} ${errorText.slice(0, 200)}`);
  }

  const payload = await response.json();
  const base64 = payload?.data?.image_base64?.[0];
  if (!base64) {
    throw new Error("MiniMax image generation returned no image data.");
  }

  return Buffer.from(base64, "base64");
}

function renderPracticeReadMarkdown(entry, deepRead, visuals) {
  const visualsBySection = groupVisualsBySection(visuals);
  const lines = [
    `# ${deepRead.titleZh || entry.titleZh || entry.title}`,
    "",
    `- 来源: ${entry.source}`,
    `- 原文: ${entry.url}`,
    `- 发布时间: ${entry.publishedAt ?? "unknown"}`,
    `- 生成时间: ${new Date().toISOString()}`,
    ""
  ];

  appendSection(lines, "先说结论", deepRead.oneSentenceTakeaway, null);
  appendSection(lines, "这篇文章到底在解决什么问题", deepRead.problemItSolves, visualsBySection.get("problem"));
  appendSection(lines, "把它讲成人话", deepRead.plainExplanation, visualsBySection.get("explanation"));
  appendSection(lines, "一个帮助理解的类比", deepRead.intuitiveAnalogy, visualsBySection.get("analogy"));
  appendSection(lines, "为什么值得你花时间看", deepRead.whyItMatters, null);
  appendSection(lines, "作者到底做了什么", deepRead.whatTheyActuallyBuilt, visualsBySection.get("built"));

  if (deepRead.workflowSteps.length > 0) {
    lines.push("## 它是怎么运转的");
    lines.push("");
    appendVisualBlock(lines, visualsBySection.get("workflow"));
    deepRead.workflowSteps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
    lines.push("");
  }

  appendSection(lines, "一个具体例子", deepRead.concreteExample, visualsBySection.get("example"));

  if (deepRead.whatToLearn.length > 0) {
    lines.push("## 我该学什么");
    lines.push("");
    appendVisualBlock(lines, visualsBySection.get("what_to_learn"));
    for (const item of deepRead.whatToLearn) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (deepRead.whereToApply.length > 0) {
    lines.push("## 可落地在哪");
    lines.push("");
    appendVisualBlock(lines, visualsBySection.get("where_to_apply"));
    for (const item of deepRead.whereToApply) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  appendSection(lines, "什么场景适合用，什么场景别急着用", deepRead.whenToUse, visualsBySection.get("when_to_use"));

  if (deepRead.keyPoints.length > 0) {
    lines.push("## 核心要点");
    lines.push("");
    for (const point of deepRead.keyPoints) {
      lines.push(`- ${point}`);
    }
    lines.push("");
  }

  if (deepRead.takeaways.length > 0) {
    lines.push("## 看完记住这几点");
    lines.push("");
    appendVisualBlock(lines, visualsBySection.get("takeaways"));
    for (const takeaway of deepRead.takeaways) {
      lines.push(`- ${takeaway}`);
    }
    lines.push("");
  }

  if (deepRead.glossary.length > 0) {
    lines.push("## 术语小抄");
    lines.push("");
    for (const item of deepRead.glossary) {
      lines.push(`- **${item.term}**: ${item.explanation}`);
    }
    lines.push("");
  }

  if (entry.titleZh) {
    lines.push("## 原文标题");
    lines.push("");
    lines.push(entry.title);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function appendSection(lines, title, body, visuals) {
  if (!body) {
    return;
  }
  lines.push(`## ${title}`);
  lines.push("");
  appendVisualBlock(lines, visuals);
  lines.push(body);
  lines.push("");
}

function appendVisualBlock(lines, visuals) {
  if (!Array.isArray(visuals) || visuals.length === 0) {
    return;
  }

  for (const visual of visuals) {
    if (!visual.relativePath) {
      continue;
    }
    lines.push(`![${visual.titleZh || "解释图"}](${visual.relativePath})`);
    if (visual.titleZh) {
      lines.push(`*图示：${visual.titleZh}*`);
    }
    if (visual.purposeZh) {
      lines.push(`*这张图在帮助你理解：${visual.purposeZh}*`);
    }
    lines.push("");
  }
}

async function writePracticeReadIndex(outputDir, history) {
  const lines = ["# 工程实践精读", ""];
  const items = collectHistoryItemsForOutputDir(history, outputDir);

  if (items.length === 0) {
    lines.push("本轮没有新的工程实践精读生成。");
    lines.push("");
  } else {
    for (const item of items) {
      lines.push(`- [${item.title}](${item.fileName})`);
    }
    lines.push("");
  }

  await writeFile(path.join(outputDir, "index.md"), `${lines.join("\n")}\n`, "utf8");
}

function collectHistoryItemsForOutputDir(history, outputDir) {
  const normalizedOutputDir = normalizeFilePath(outputDir);
  return Object.values(history?.items ?? {})
    .filter((item) => normalizeFilePath(path.dirname(item.outputPath || "")) === normalizedOutputDir)
    .sort((left, right) => String(right.generatedAt || "").localeCompare(String(left.generatedAt || "")))
    .map((item) => ({
      title: item.titleZh || item.title || path.basename(item.outputPath || "", ".md"),
      fileName: path.basename(item.outputPath || "")
    }));
}

function normalizeFilePath(value) {
  return String(value).replace(/\\/g, "/");
}

async function loadPracticeReadHistory() {
  const history = await readJson(HISTORY_FILE, null);
  if (history && history.items && typeof history.items === "object") {
    return history;
  }

  return {
    updatedAt: null,
    items: {}
  };
}

async function savePracticeReadHistory(history) {
  await ensureDir(path.dirname(HISTORY_FILE));
  await writeJson(HISTORY_FILE, history);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(decodeHtmlEntities(match[1])) : "";
}

function extractMetaDescription(html) {
  const match =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  return match ? decodeHtmlEntities(match[1]).trim() : "";
}

function extractArticleHtml(html) {
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return html;
}

function normalizeBaseUrl(value) {
  return String(value).replace(/\/$/, "");
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeGlossary(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      term: String(item?.term ?? "").trim(),
      explanation: String(item?.explanation ?? "").trim()
    }))
    .filter((item) => item.term && item.explanation);
}

function normalizeVisuals(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      sectionKey: normalizeSectionKey(item?.section_key),
      titleZh: String(item?.title_zh ?? "").trim(),
      purposeZh: String(item?.purpose_zh ?? "").trim(),
      imagePrompt: String(item?.image_prompt ?? "").trim()
    }))
    .filter((item) => item.sectionKey && item.imagePrompt)
    .slice(0, MAX_VISUALS_PER_ARTICLE);
}

function normalizeSectionKey(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (VISUAL_SECTION_KEYS.has(normalized)) {
    return normalized;
  }
  return "";
}

function groupVisualsBySection(visuals) {
  const grouped = new Map();
  for (const visual of visuals) {
    const bucket = grouped.get(visual.sectionKey) ?? [];
    bucket.push(visual);
    grouped.set(visual.sectionKey, bucket);
  }
  return grouped;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "practice-read";
}

function parseModelJson(value) {
  const start = value.indexOf("{");
  if (start === -1) {
    throw new Error("No JSON object found in model response.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(value.slice(start, index + 1));
      }
    }
  }

  throw new Error("No complete JSON object found in model response.");
}

function createEmptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0
  };
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") {
    return createEmptyUsage();
  }

  return {
    inputTokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    totalTokens: Number(usage.total_tokens ?? 0)
  };
}

function mergeUsage(target, usage) {
  target.inputTokens += Number(usage.inputTokens ?? 0);
  target.outputTokens += Number(usage.outputTokens ?? 0);
  target.totalTokens += Number(usage.totalTokens ?? 0);
}
