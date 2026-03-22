import path from "node:path";

const ROOT_DIR = process.cwd();

export const APP_CONFIG = {
  // 项目根目录。通常不需要手动修改。
  rootDir: ROOT_DIR,

  // 所有日期、日报文件名、时间显示都使用这个时区。
  timeZone: "Asia/Shanghai",

  // 管线用到的主要文件路径。
  paths: {
    rootDir: ROOT_DIR,
    // 信息源配置文件。
    sources: path.join(ROOT_DIR, "config", "sources.json"),
    // 本地条目库存目录，按天存储。
    storeDir: path.join(ROOT_DIR, "data", "entries"),
    // 旧版单文件库存，保留给迁移兼容使用。
    storeLegacyFile: path.join(ROOT_DIR, "data", "entries.json"),
    // 日报输出目录。
    reportsDir: path.join(ROOT_DIR, "reports"),
    // 工程实践精读历史记录，避免重复精读同一篇文章。
    practiceReadHistoryFile: path.join(ROOT_DIR, "data", "practice-reads", "history.json"),
    // 本地 LLM 缓存目录，按天存储。
    llmCacheDir: path.join(ROOT_DIR, "data", "llm-cache"),
    // 旧版单文件 LLM 缓存，保留给迁移兼容使用。
    llmCacheLegacyFile: path.join(ROOT_DIR, "data", "llm-cache.json"),
    // 本地私密环境变量文件。
    localEnv: path.join(ROOT_DIR, "config", ".env.local")
  },

  // 网络请求默认配置。
  network: {
    defaultTimeoutMs: 30000,
    defaultMaxRedirects: 5,
    rssTimeoutMs: 20000,
    sourceTimeoutMs: 45000,
    githubContributorTimeoutMs: 15000
  },

  // 抓取失败时的重试次数。
  pipeline: {
    maxFetchAttempts: 3
  },

  // 本地缓存保留策略。
  cache: {
    // 只影响 data/llm-cache，不影响日报和 entries 库存。
    retentionDays: getEnvNumber("LLM_CACHE_RETENTION_DAYS", 30)
  },

  // 翻译相关配置。
  translation: {
    chunkSize: {
      openai: 8,
      // MiniMax 当前折中为 2 条一批，兼顾速度和 JSON 稳定性。
      minimax: 2
    },
    openai: {
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini"
    },
    minimax: {
      // 中国大陆账号通常会在 .env.local 里覆盖成 https://api.minimaxi.com/v1
      defaultBaseUrl: "https://api.minimax.io/v1",
      defaultModel: "MiniMax-M2.5"
    }
  },

  // Highlights 排序相关配置。
  highlights: {
    // 送给大模型重排的候选数。
    maxCandidates: 10,
    openai: {
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4o-mini"
    },
    minimax: {
      defaultBaseUrl: "https://api.minimax.io/v1",
      defaultModel: "MiniMax-M2.7-highspeed"
    }
  },

  // 工程实践精读配置。
  practiceReads: {
    // 每次运行最多生成几篇新的精读。
    maxPerRun: 2,
    // 只从实践榜前几名里挑，避免范围太散。
    candidatePoolSize: 10,
    // 抓正文后最多送多少字符给大模型。
    maxArticleChars: 12000,
    // 在 hourly 报告目录下输出到这个子目录。
    outputDirName: "practice-reads",
    // 配图比例。
    imageAspectRatio: "16:9",
    minimax: {
      defaultBaseUrl: "https://api.minimax.io/v1",
      textModel: "MiniMax-M2.7-highspeed",
      imageModel: "image-01"
    }
  },

  // GitHub 相关默认配置。
  github: {
    apiAccept: "application/vnd.github+json",
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

  // 规则分类，用于日报分区和基础打分。
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
