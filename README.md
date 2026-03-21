# AI 信息自动收集管线 V1

这个项目提供一个最小可运行版本，用来定时抓取 AI 相关 RSS 信息源，做基础去重和分类，并生成每日 Markdown 日报。

## 当前能力

- 从 `sources/sources.json` 读取信息源
- 抓取 RSS/Atom 内容
- 用链接去重，累计保存到 `data/entries.json`
- 为每条内容生成摘要、分类和简单分数
- 生成 `reports/YYYY-MM-DD.md` 日报
- 可选接入 OpenAI，把标题和摘要翻译成中文

## 使用方式

```bash
npm run run:pipeline
```

如果想看更详细的抓取过程：

```bash
npm run run:pipeline:verbose
```

## 中文翻译

推荐做法是使用本地私密配置文件：

1. 复制 [.env.example](F:\CodexProject\.env.example) 为 `.env.local`
2. 只填写你要用的那一种 provider
3. 直接双击 [run_pipeline.bat](F:\CodexProject\run_pipeline.bat)

`.env.local` 已经被 [.gitignore](F:\CodexProject\.gitignore) 忽略，不会进 Git。

### 方案一：OpenAI

```env
OPENAI_API_KEY=your_api_key
OPENAI_TRANSLATION_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

### 方案二：MiniMax

```env
MINIMAX_API_KEY=your_api_key
MINIMAX_TRANSLATION_MODEL=MiniMax-M2.5
MINIMAX_BASE_URL=https://api.minimax.io/v1
```

如果两个都配置了，当前会优先使用 `OpenAI`。

启用后：

- 新抓到的标题会写入 `titleZh`
- 新抓到的摘要会写入 `summaryZh`
- 日报优先显示中文，下面保留原始英文标题

## 信息源配置

编辑 [sources.json](F:\CodexProject\sources\sources.json)：

- `name`: 信息源名称
- `type`: 当前只支持 `rss`
- `url`: RSS 或 Atom 地址
- `limit`: 每次最多读取多少条
- `priority`: 0 到 3，用于简单排序
- `tags`: 输出到日报里的标签

## 目录说明

- [src/main.mjs](F:\CodexProject\src\main.mjs): 管线入口
- [src/lib/pipeline.mjs](F:\CodexProject\src\lib\pipeline.mjs): 抓取、去重、日报生成
- [src/lib/rss.mjs](F:\CodexProject\src\lib\rss.mjs): 轻量 RSS/Atom 解析
- [src/lib/text-utils.mjs](F:\CodexProject\src\lib\text-utils.mjs): 摘要、分类、评分规则
- [data/entries.json](F:\CodexProject\data\entries.json): 本地累计数据
- [reports](F:\CodexProject\reports): 每日输出目录

## 下一步建议

这个 V1 还比较轻量，后续适合逐步加：

- 标题相似度去重
- 网页正文抽取
- LLM 摘要与标签增强
- 定时任务接入 Windows 任务计划或云服务器
- 推送到飞书、邮箱或知识库
