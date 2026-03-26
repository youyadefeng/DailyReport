# AI 日报管线

这个项目会定时或手动收集 AI 相关信息，进行清洗、翻译、排序、精读生成，并输出中文日报。

## 当前能力

- 多源采集
  - 官方新闻 / 工程实践 / 研究 / GitHub / 社区
- 本地库存按天存储
  - `data/entries/`
- LLM 缓存按天存储
  - `data/llm-cache/`
- 中文翻译
  - 标题、摘要
- 榜单生成
  - `实践类型 Top 10`
  - `新闻资讯 Top 20`
  - `GitHub Rising AI Top 10`
  - `GitHub AI Topic Top 10`
- 榜单增强
  - 排名变化
  - 老条目轻微降权，帮助新条目上榜
  - 实践类额外加权
- 工程实践精读
  - 每次最多生成 2 篇未精读过的文章
  - 可生成多张解释图
  - 增加 `我该学什么`、`可落地在哪`
- 收藏功能
  - 可把条目永久收藏到本地
  - 收藏数据可提交到 Git，同步到其他设备

## 运行方式

最常用的入口：

- 双击运行
  - `run_pipeline.bat`
- 命令行运行

```bash
npm run run:pipeline
```

看更详细输出：

```bash
npm run run:pipeline:verbose
```

只跑 GitHub 相关源：

```bash
npm run run:pipeline:github
```

```bash
npm run run:pipeline:github:verbose
```

## 收藏功能

收藏使用本地库存做匹配，不需要重新抓取。

收藏一条：

```bash
node src/main.mjs --favorite "完整链接"
```

或者：

```bash
node src/main.mjs --favorite "标题关键词"
```

查看收藏：

```bash
node src/main.mjs --favorites
```

取消收藏：

```bash
node src/main.mjs --unfavorite "完整链接或标题"
```

收藏数据位置：

- `data/favorites/favorites.json`
- `data/favorites/index.md`

说明：
- `data/favorites/` 已放行进入 Git
- 这样可以在设备 A 收藏后提交到 GitHub，设备 B 拉取后继续使用

## 中文翻译

推荐使用本地私密配置文件：

1. 复制 `config/.env.example`
2. 新建为 `config/.env.local`
3. 填入你自己的 key

支持：

- OpenAI
- MiniMax

如果两个都配置，当前优先走 OpenAI。

## 配置文件

所有主要配置集中在：

- `config/`

最常改的几个文件：

- `config/project.config.mjs`
  - 全局默认配置
  - 路径
  - 超时
  - 重试
  - 缓存保留天数
  - 榜单重复上榜降权参数
- `config/sources.json`
  - 信息源列表
  - `enabled` 开关
- `config/sources.example.json`
  - 信息源模板
- `config/.env.local`
  - 私密 key
  - 模型覆盖配置

## 当前信息源类型

支持的类型：

- `rss`
- `github-api-search`
- `anthropic-news-html`
- `huggingface-blog-html`
- `google-cloud-blog-html`

当前重点源包括：

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

## 报告结构

每小时生成一个独立目录：

- `reports/YYYY-MM-DD_HH/overview.md`
- `reports/YYYY-MM-DD_HH/sources/*.md`
- `reports/YYYY-MM-DD_HH/practice-reads/*.md`

主日报只保留：

- 今日重点
- 来源概览
- 工程实践精读入口

来源明细和精读单独拆开，避免主日报过长。

## 排名与权重

当前榜单会综合这些因素：

- 基础规则分
- LLM 重排分
- 排名变化
- 老条目轻微降权
- 实践类额外加权

已收藏条目会在日报中标记：

- `收藏状态：★ 已收藏`

## 工程实践精读

工程实践精读会从实践榜里挑选最多 2 篇之前没有精读过的文章，生成：

- 人类更容易理解的中文精读
- 多张解释图
- `我该学什么`
- `可落地在哪`

历史防重文件：

- `data/practice-reads/history.json`

只要文章 `id/url` 不变，默认不会跨天重复精读。

## 数据存储

本地库存：

- `data/entries/`

LLM 缓存：

- `data/llm-cache/`

收藏：

- `data/favorites/`

日志：

- `logs/`

## 开发偏好

这个项目有一个明确偏好：

- 修改功能时，尽量只做最小范围验证
- 尽量不要为了小改动就全量跑整条管线

例如：

- 改 GitHub 逻辑时优先只测 GitHub
- 改实践精读时优先只测实践模块

## 后续可继续做的方向

- 更强的去噪和事件合并
- 更好的摘要与推荐理由
- 分发到飞书 / 邮件 / Obsidian
- 服务器部署与自动化
- 更细的个人关注权重
