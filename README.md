# 航标 · 部门产品智能客服机器人

一套可直接部署的产品知识库客服：把部门文档、FAQ、导师访谈或故障复盘增量导入后，回答功能介绍、使用方法和问题排障三类问题；每个关键结论附原文证据，依据不足时拒绝猜测并引导人工支持。

> 仓库内的“星河 API 开放平台”是明确标注的虚构演示资料。部署真实环境前，请在管理台删除演示文档并导入部门正式资料。

## 已实现能力

- 公开客服：产品切换、多轮会话、三类问题识别、引用原文、置信度、建议追问、满意度反馈、人工升级。
- RAG：结构感知切分、向量检索 + 关键词融合、Top-K 证据、严格上下文提示、引用映射、低置信度阈值。
- 知识管理：TXT / Markdown / PDF / DOCX / HTML 导入、SHA-256 增量去重、版本与索引状态、来源类型和原文链接、删除即同步删除向量。
- 知识图谱：基于 LightRAG 自动抽取产品、能力、接口、参数、错误码和排障关系；按产品隔离、支持增量更新、可视化浏览和一键重建。
- 自适应检索：系统自动选择语义检索、图谱检索或双路并行检索，最终证据仍回落到可追溯原文。
- 运营管理：文档/片段/会话/消息指标、可回答率、好评率、最近问题、内置 30 题一键评测。
- 工程能力：会话与问答落库、结构化日志、请求 ID、匿名 IP 哈希、Redis 限流、异常降级、Docker 健康检查、环境变量密钥。
- 无密钥可运行：未设置大模型密钥时使用本地哈希向量与证据摘录模式；设置 OpenAI 兼容接口后启用生成式 RAG。

## 架构与选型

```text
浏览器（React + TypeScript）
          │ /api/v1
          ▼
FastAPI 统一问答服务 ── Redis（限流/短期状态）
   │ 文档解析      │ 模型适配器（OpenAI-compatible）
   │               ├─ Chat model
   ▼               └─ Embedding model
PostgreSQL 16 + pgvector
文档元数据 / 向量 / 会话 / 消息 / 反馈 / 评测
          │
          └─ LightRAG 产品隔离图谱工作区
```

选择 React + Vite 是为了轻量、成熟的交互与独立构建；FastAPI 适合 AI I/O、类型化 API 和流式能力扩展；PostgreSQL + pgvector 把业务元数据、问答记录与向量放在一个可靠事务边界内，当前部门级规模不需要额外引入复杂向量集群；Redis 只承担可丢失的限流/缓存职责，故障时客服仍可降级运行。

知识图谱选型与自适应路由细节见 [`docs/KNOWLEDGE_GRAPH.md`](docs/KNOWLEDGE_GRAPH.md)，第三方许可见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

RAG 相比微调更适合本场景：文档能随时增量更新、答案可追溯、无需重新训练。缺点是检索质量依赖文档结构和 embedding，且调用模型会增加时延；系统用混合检索、拒答阈值、引用约束和 30 题回归评测缓解这些风险。

## 快速启动

要求：Docker Engine / Docker Desktop 与 Docker Compose v2。

```bash
cp .env.example .env
# 编辑 .env，替换所有 CHANGE_ME；生产环境必须设置强随机密钥
./scripts/deploy.sh
```

默认访问：

- 客服页面：`http://localhost:8088`
- 管理台：页面右上角“知识控制台”，输入 `.env` 的 `ADMIN_API_KEY`
- 健康检查：`http://localhost:8088/api/v1/health`
- 开发环境 API 文档：`http://localhost:8088/api/docs`

如端口冲突，在 `.env` 设置 `APP_PORT=8090`。Compose 项目名、网络、数据卷和宿主端口均与其他知识库项目隔离。

## 模型配置

支持 OpenAI、Xinference、vLLM、OneAPI 等 OpenAI 兼容接口：

```dotenv
LLM_BASE_URL=https://your-gateway.example/v1
LLM_API_KEY=...
LLM_MODEL=your-chat-model
EMBEDDING_BASE_URL=https://your-gateway.example/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=your-embedding-model
EMBEDDING_DIMENSIONS=1536
```

`EMBEDDING_DIMENSIONS` 创建数据库后不可随意改变。更换维度需要新建数据卷或编写向量迁移并重新索引；不要直接修改生产库字段。

硅基流动 `BAAI/bge-m3` 的配置示例：

```dotenv
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
EMBEDDING_API_KEY=...
EMBEDDING_MODEL=BAAI/bge-m3
EMBEDDING_DIMENSIONS=1024
```

在模型或文档发生变化、且数据库向量维度已经匹配后，可重建全部知识向量：

```bash
docker compose exec app python -m app.cli.reindex_embeddings
```

## 本地开发与验证

```bash
# 前端
cd frontend && npm install && npm run dev

# 后端（Python 3.12）
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
.venv/bin/uvicorn app.main:app --app-dir backend --reload --port 8000

# 单元测试与离线评测
.venv/bin/pytest -q backend/tests
python3 scripts/evaluate_retrieval.py
```

离线评测结果写入 `docs/evaluation-results.json`；管理台评测会走实际数据库与当前模型，结果保存到 `evaluation_runs` 表。

## 知识入库规范

建议一份文档聚焦一个主题，使用清晰标题层级；错误码单独成节，并写明现象、原因、顺序化步骤、禁止事项和转人工条件。来源类型必须选择“官方文档 / FAQ / 导师访谈 / 故障复盘”等，能提供正式链接时填写原文 URL。扫描版 PDF 应先 OCR，入库后用评测集验证。

## 部署与运维

- 生产环境由现有 Nginx/Caddy 终止 TLS，再反向代理到仅内网暴露的 `APP_PORT`。
- 不要把 PostgreSQL 和 Redis 端口映射到公网；当前 Compose 默认不映射。
- 数据位于 `support_bot_pgdata`、`support_bot_redis`、`support_bot_uploads` 命名卷。升级前用 `pg_dump` 做数据库备份。
- 日志：`docker compose logs -f app`；状态：`docker compose ps`；停止但保留数据：`docker compose down`。
- `.env` 已被 Git 忽略；密钥不得写入文档、前端或提交记录。

更完整的设计、评测和交付说明见 [部门产品智能客服机器人研发—AI提效实践报告](docs/部门产品智能客服机器人研发—AI提效实践报告.md)、[3 分 20 秒系统演示录屏](docs/部门产品智能客服机器人研发-系统演示.webm) 与 [架构设计](docs/ARCHITECTURE.md)。
