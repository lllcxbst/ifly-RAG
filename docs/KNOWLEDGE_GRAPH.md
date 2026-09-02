# 知识图谱方案与开源选型

## 选型结论

系统选择 LightRAG 1.5.6（MIT）作为图谱引擎，并以 SDK 方式嵌入现有
FastAPI 服务。每个产品使用独立 workspace，图谱文件持久化在专用 Docker
卷中；原有 PostgreSQL/pgvector 继续保存权威文档元数据、原文片段和语义向量。

候选方案对比：

| 方案 | 优点 | 本项目结论 |
|---|---|---|
| LightRAG | 轻量、增量更新、支持图谱/向量混合模式、支持 PostgreSQL 和 BAAI/bge-m3 | 采用；最适合 2 核 4GB 单机和现有栈 |
| Microsoft GraphRAG | 社区成熟，擅长全局社区摘要 | 未采用；索引成本高，官方已说明项目处于维护模式 |
| OpenSPG/KAG | Schema 约束和多跳逻辑推理完整 | 未采用；依赖 OpenSPG 引擎，部署明显更重 |
| Neo4j GraphRAG | 图数据库生态和可视化成熟 | 未采用；知识构建部分仍在 experimental 命名空间，并要求 Neo4j/APOC |

## 入库链路

1. 文档完成解析、按 Markdown 标题切分并生成 BAAI/bge-m3 语义向量。
2. 返回上传结果，不阻塞控制台；图谱任务进入 `pending / processing` 状态。
3. LightRAG 从同一文档抽取产品、能力、场景、API、参数、步骤、错误码、
   现象、原因、解决方案、限制和支持渠道等实体及其关系。
4. 图谱实体/关系保留到原文的 chunk/file 映射。文档删除时先删除对应图谱
   贡献，再级联删除 PostgreSQL 中的原文片段和向量。
5. 启动时自动补建未完成图谱；控制台也支持按产品重建。

## 自适应检索

路由器不会把所有问题都强制送入更慢的图谱链路：

- **语义检索**：接口路径、参数、错误码和单一事实问题；
- **图谱检索**：关系、依赖、影响链路和实体间比较问题；
- **并行检索**：同时含关系与具体事实，或包含多个子目标的问题。

并行模式同时执行现有 pgvector/pg_trgm 混合检索与 LightRAG 图谱检索，
再按原文 chunk 去重融合。图谱只用于发现关联，回答生成仍只能引用可追溯的
原文片段；图谱为空、构建中或调用失败时自动回退语义检索。

## 运行参数

```env
GRAPH_ENABLED=true
GRAPH_STORAGE_DIR=/app/graph_store
GRAPH_LLM_MODEL=Qwen/Qwen3.5-9B
GRAPH_TOP_K=8
GRAPH_MAX_NODES=180
GRAPH_INDEX_MAX_ATTEMPTS=2
```

图谱抽取复用 `LLM_*` 配置，实体和关系向量复用 `EMBEDDING_*` 配置。修改
embedding 模型或维度后，必须同时重建语义索引和知识图谱。
