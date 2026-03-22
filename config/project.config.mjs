import path from "node:path";

const ROOT_DIR = process.cwd();

export const APP_CONFIG = {
  // 项目根目录。通常不需要手动修改。
  rootDir: ROOT_DIR,

  // 所有日期、日报文件名、时间显示都使用这个时区。
  timeZone: "Asia/Shanghai",

  // 管线使用到的主要文件路径。
  // 如果你以后想调整配置文件、数据文件、日报输出目录，可以改这里。
  paths: {
    rootDir: ROOT_DIR,
    // 主信息源列表，管线会从这里读取要抓哪些源。
    sources: path.join(ROOT_DIR, "config", "sources.json"),
    // 本地条目数据库，保存累计抓到的所有内容。
    store: path.join(ROOT_DIR, "data", "entries.json"),
    // Markdown 日报输出目录。
    reportsDir: path.join(ROOT_DIR, "reports"),
    // 当天翻译/Highlights 打分缓存，用来减少重复调用大模型。
    llmCacheDir: path.join(ROOT_DIR, "data", "llm-cache"),
    llmCacheLegacyFile: path.join(ROOT_DIR, "data", "llm-cache.json"),
    // 本地私密环境变量文件，放 API key 和本地覆盖配置。
    localEnv: path.join(ROOT_DIR, "config", ".env.local")
  },

  // 网络请求相关默认值。
  // 如果某些信息源很慢，可以适当调大；如果你想更快失败，可以调小。
  network: {
    // 通用请求超时，供共享 HTTP 工具使用。
    defaultTimeoutMs: 30000,
    // 最多允许跟随多少次 HTTP 重定向。
    defaultMaxRedirects: 5,
    // RSS 通常更轻，超时可以设得短一点。
    rssTimeoutMs: 20000,
    // 非 RSS 源，比如 GitHub API，通常会更慢一些。
    sourceTimeoutMs: 45000,
    // GitHub 额外请求贡献者数量时使用的超时。
    githubContributorTimeoutMs: 15000
  },

  // 管线抓取重试策略。
  pipeline: {
    // 单个信息源最多重试几次，超过后记为失败。
    maxFetchAttempts: 3
  },

  // 本地缓存策略。
  cache: {
    // 本地 LLM 缓存保留多少天。
    // 也可以在 .env.local 里用 LLM_CACHE_RETENTION_DAYS 覆盖。
    retentionDays: getEnvNumber("LLM_CACHE_RETENTION_DAYS", 7)
  },

  // 翻译步骤相关设置。
  translation: {
    chunkSize: {
      // OpenAI 通常可以一次处理多条。
      openai: 8,
      // MiniMax 目前单条翻译更稳，所以默认 1 条一批。
      minimax: 1
    },
    openai: {
      // 使用 OpenAI 翻译时的默认 API 地址。
      defaultBaseUrl: "https://api.openai.com/v1",
      // 如果没有在 .env.local 里设置 OPENAI_TRANSLATION_MODEL，就用这个默认模型。
      defaultModel: "gpt-4o-mini"
    },
    minimax: {
      // MiniMax 国际版默认地址。中国大陆账号通常会在 .env.local 里改成国内地址。
      defaultBaseUrl: "https://api.minimax.io/v1",
      // 如果没有在 .env.local 里设置 MINIMAX_TRANSLATION_MODEL，就用这个默认模型。
      defaultModel: "MiniMax-M2.5"
    }
  },

  // Highlights 重点排序相关设置。
  highlights: {
    // 送给大模型做重点重排的候选条目数。
    // 调大可能会稍微提升质量，但会增加耗时和 token 消耗。
    maxCandidates: 10,
    openai: {
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini"
    },
    minimax: {
      defaultBaseUrl: "https://api.minimax.io/v1",
      // 如果没有在 .env.local 里设置 MINIMAX_HIGHLIGHT_MODEL，就用这个默认模型。
      defaultModel: "MiniMax-M2.7-highspeed"
    }
  },

  // GitHub 相关解析设置。
  github: {
    // GitHub API 请求头里的 accept。
    apiAccept: "application/vnd.github+json",
    // 用于 GitHub HTML 解析器和后续关键词过滤，
    // 帮助判断一个仓库是不是 AI 相关。
    defaultAiKeywords: [
      "ai",
      "artificial intelligence",
      "llm",
      "gpt",
      "agent",
      "agents",
      "rag",
      "diffusion",
      "embedding",
      "inference",
      "reasoning",
      "transformer",
      "vision-language",
      "multimodal",
      "prompt"
    ]
  },

  // 在进入 LLM 排序前，先做一层基础规则分类。
  // 除非你想调整日报分区，否则通常不需要改这里。
  categorization: {
    rules: [
      { category: "Models", keywords: ["model", "llm", "gpt", "claude", "gemini", "reasoning"] },
      { category: "Products", keywords: ["api", "app", "agent", "assistant", "launch", "release"] },
      { category: "Open Source", keywords: ["open source", "github", "weights", "repo", "repository"] },
      { category: "Research", keywords: ["paper", "research", "benchmark", "arxiv", "study"] },
      { category: "Industry", keywords: ["funding", "policy", "enterprise", "regulation", "market"] },
      { category: "Guides", keywords: ["guide", "tutorial", "how to", "cookbook", "example"] }
    ]
  }
};

function getEnvNumber(name, fallback) {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return raw;
}
