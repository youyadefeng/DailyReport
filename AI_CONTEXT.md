# AI Context

This file is the current AI-oriented handoff document for the `DailyReport` project.
It is meant for future coding agents, automation tools, or other models that need fast onboarding.

## 1. Project purpose

This project builds a local AI information pipeline with Chinese report output.

It currently does all of the following:

- Collects AI-related content from configured sources
- Normalizes and stores entries locally by day
- Translates title and summary to Chinese
- Re-ranks highlights with LLM scoring
- Generates split hourly reports
- Generates practice deep reads with images
- Supports local favorites that can be synced through Git

Primary user goal:
- Use the project locally with low friction
- Keep extending it gradually
- Prefer practical output over architectural complexity

## 2. Runtime and entrypoints

Tech stack:
- Node.js
- ESM modules (`.mjs`)
- Local JSON + Markdown files

Main entrypoints:
- `src/bootstrap.mjs`
  - Loads `.env.local`, then enters the app
- `src/main.mjs`
  - CLI entry
  - Supports pipeline and favorites commands
- `run_pipeline.bat`
  - Main double-click launcher
- `run_pipeline.ps1`
  - Real Windows runner with log capture

Useful scripts:
- `npm run run:pipeline`
- `npm run run:pipeline:verbose`
- `npm run run:pipeline:github`
- `npm run run:pipeline:github:verbose`

## 3. Current CLI features

Pipeline:
- normal run
- verbose run
- source filtering
- tag filtering

Favorites:
- `node src/main.mjs --favorite "link or title"`
- `node src/main.mjs --favorites`
- `node src/main.mjs --unfavorite "link or title"`

Favorites are intentionally stored in a Git-trackable path so they can sync across devices.

## 4. Config layout

All user-facing config lives under:
- `config/`

Important files:
- `config/project.config.mjs`
  - paths
  - network defaults
  - retry counts
  - cache retention
  - highlight repeat-entry penalties
  - practice read defaults
- `config/sources.json`
  - real source list
- `config/sources.example.json`
  - source template and supported source types
- `config/.env.local`
  - private secrets and model overrides
- `config/.env.example`
  - safe template

Important note:
- `config/.env.local` must not be committed

## 5. Supported source types

Currently supported:
- `rss`
- `github-api-search`
- `anthropic-news-html`
- `huggingface-blog-html`
- `google-cloud-blog-html`

Representative production sources:
- OpenAI News
- Anthropic News
- Anthropic Engineering
- Anthropic Research
- Google AI Blog
- Google Developers AI
- Google Cloud Developers
- Hugging Face Blog
- Hacker News AI
- arXiv cs.AI
- GitHub Rising AI
- GitHub AI Topic

## 6. Storage layout

Daily entries:
- `data/entries/`
  - one JSON file per day

Daily LLM cache:
- `data/llm-cache/`
  - one JSON file per day
  - stores translation cache
  - stores highlight scoring cache
  - stores same-day translation failure cache

Practice deep-read history:
- `data/practice-reads/history.json`

Favorites:
- `data/favorites/favorites.json`
- `data/favorites/index.md`

Reports:
- `reports/`
  - one folder per hour
  - example:
    - `reports/YYYY-MM-DD_HH/overview.md`
    - `reports/YYYY-MM-DD_HH/sources/*.md`
    - `reports/YYYY-MM-DD_HH/practice-reads/*.md`

Logs:
- `logs/`

## 7. Core modules

Main modules:
- `src/lib/pipeline.mjs`
  - source loading
  - fetch loop
  - merge/store
  - report generation
  - ranking
  - ranking change tracking
  - favorite flag projection into reports
- `src/lib/translator.mjs`
  - translation provider selection
  - translation batching
  - translation cache integration
  - same-day failure skip behavior
- `src/lib/highlight-scorer.mjs`
  - highlight candidate selection
  - LLM scoring
  - highlight cache integration
- `src/lib/practice-reads.mjs`
  - practice deep-read generation
  - image generation
  - explanatory visuals
  - sections like:
    - one-sentence takeaway
    - what problem it solves
    - plain explanation
    - what they actually built
    - workflow
    - what to learn
    - where to apply
    - when to use
- `src/lib/favorites.mjs`
  - favorite load/save
  - favorite index generation
  - matching by link/title
- `src/lib/llm-cache.mjs`
  - daily cache read/write
  - pruning by retention days
- `src/lib/github-api.mjs`
  - GitHub repository parsing and enrichment
- `src/lib/google-cloud-blog.mjs`
  - Google Cloud Developers & Practitioners page parsing
- `src/lib/anthropic-news.mjs`
  - Anthropic HTML parsing
- `src/lib/text-utils.mjs`
  - summaries
  - date/hour slugs
  - scoring helpers
  - categorization
  - text cleanup

## 8. Report structure

Main overview report currently contains:
- header
- `实践类型 Top 10`
- `新闻资讯 Top 20`
- `GitHub Rising AI Top 10`
- `GitHub AI Topic Top 10`
- source overview
- practice deep-read entry
- failures if any

Source details are split into per-source files.

Practice deep reads live in a sibling folder under the same hourly report.

## 9. Ranking behavior

### General entries

Base rule score is created in:
- `src/lib/text-utils.mjs`

Signals include:
- source priority
- product/release keywords
- research keywords
- open-source keywords
- extra practice-oriented signals

### Highlight ranking

Highlights are selected in two phases:
1. rule-based preselection
2. LLM reranking

Display score blends:
- rule score
- LLM score

### Freshness bias

To prevent old items from dominating every run:
- repeated entries from the previous leaderboard receive a small penalty
- this is configurable in:
  - `config/project.config.mjs`

Current knobs:
- `highlights.repeatEntryScorePenalty`
- `highlights.repeatGithubScorePenaltyRatio`

### Rank-change labels

Current report items may show:
- `NEW`
- `=`
- `↑N`
- `↓N`

These compare the current leaderboard with the previous hourly report’s same section.

## 10. GitHub-specific behavior

GitHub is intentionally treated separately.

Current split:
- `GitHub Rising AI`
  - recently updated AI repos with minimum quality threshold
- `GitHub AI Topic`
  - high-star long-term AI repos

GitHub ranking uses weighted popularity:
- `stars * 5 + forks * 3 + watchers`

Reports also show:
- stars
- forks
- watchers
- contributors
- recent update time
- popularity score

## 11. Translation behavior

Supported providers:
- OpenAI
- MiniMax

Translation behavior:
- only translates entries missing Chinese fields
- same-day translation cache is reused
- same-day failures are cached and skipped
- MiniMax is tuned for smaller, more stable batch sizes

## 12. Practice deep reads

Practice deep reads are an important feature now.

Behavior:
- choose up to 2 unseen practice articles per run
- avoid repeating already-read articles using persistent history
- generate Chinese deep-read markdown
- generate 0-3 explanatory visuals
- avoid decorative cover-only visuals
- place visuals near relevant sections

Important deep-read sections now include:
- first takeaway
- what problem it solves
- plain explanation
- analogy
- why it matters
- what they actually built
- workflow
- concrete example
- what to learn
- where to apply
- when to use
- key points
- takeaways
- glossary

## 13. Favorites

Favorites are now a first-class feature.

Purpose:
- allow the user to permanently keep important items
- make favorites portable across devices through Git

Behavior:
- favorites are saved as snapshots, independent of daily reports
- reports mark favorited items as:
  - `收藏状态：★ 已收藏`
- `data/favorites/` is intentionally allowed through `.gitignore`

## 14. Important project decisions

Current stable design choices:
- config files live under `config/`
- entries are stored by day
- LLM cache is stored by day
- reports are stored by hour folder
- source detail pages are split from overview
- practice reads are split from overview
- favorites are tracked separately from daily entries
- terminal output is Chinese-first
- prefer local JSON/Markdown over database complexity for now

Do not casually change:
- hourly report folder structure
- favorite storage path semantics
- entry id behavior based on URL
- same-day cache behavior
- Windows double-click launcher flow

## 15. Testing preference

Strong user preference:
- avoid full pipeline runs unless genuinely necessary
- prefer the smallest relevant validation scope

Examples:
- GitHub change -> only test GitHub
- practice-read change -> only test practice-read module
- report rendering change -> use offline regeneration if possible

Reason:
- save runtime
- save token usage
- reduce noise

## 16. Current rough edges

Known rough edges:
- some legacy files still show historical encoding artifacts
- MiniMax can still produce malformed JSON occasionally
- README used to be outdated; this file and the new README are now the preferred references
- OpenAI developer/research pages are harder to collect programmatically due to anti-bot protection

## 17. Good next extension points

Likely future improvements:
- stronger event deduplication and event merging
- more personalized ranking preferences
- delivery to Feishu / email / Obsidian
- server deployment automation
- better quality filters for weak summaries and low-signal GitHub repos

## 18. Best onboarding order for another model

If another model is dropped into this repo, the fastest read order is:
1. `AI_CONTEXT.md`
2. `config/project.config.mjs`
3. `config/sources.json`
4. `src/lib/pipeline.mjs`
5. `src/lib/practice-reads.mjs`
6. `src/lib/translator.mjs`
7. `src/lib/highlight-scorer.mjs`
8. Then run the smallest possible verification command
