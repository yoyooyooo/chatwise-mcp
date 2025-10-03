# ChatWise MCP：意图驱动的工具集设计（Spec）

本规范将 ChatWise 的“跨会话检索/汇总/对齐/证据提取/导出”等需求抽象为一组意图驱动（Intent-first）、原子且正交（Mutually Exclusive）的 MCP 工具，并定义它们如何协同形成工作流。目标是与 App 内置功能形成互补，强调“面向意图”的入参与“面向工作流”的响应引导。

—

【业务场景描述（摘要）】
- 用户经常以模糊自然语言描述目标（如“最近两个月关于 Rust 的讨论”），希望快速找到相关会话；在定位后，需要拉取全文、做跨会话公共对齐与差异分析，抽取引用与附件，或导出/汇总指标。
- MCP 工具需返回“可读文本 + 供 LLM 消费的引导块”，支持多轮可控检索策略（扩展 → 召回 → 精排/收敛 → 拉取）。

—

第一步：核心意图分析（Intent）
1) 查找相关会话（Find）
   - 基于意图/主题/时间窗/模糊描述，召回候选会话，并给出“下一步”的搜索引导。
2) 拉取会话上下文（Retrieve）
   - 按会话 ID 获取全文时间线（含工具调用/结果等），用于理解与引用。
3) 跨会话对齐与洞察（Analyze）
   - 找出公共内容与差异项，便于综合结论与对比分析。
4) 证据与产物整理（Evidence）
   - 汇总引用来源、网页搜索结果、附件/生成产物，作为可复用“证据库”。
5) 成本与性能度量（Metrics）
   - 统计 tokens/延迟/推理耗时，支持治理与优化。
6) 导出与数据集（Export）
   - 导出为 markdown/json(l)，或对齐成微调样本对。
7) 导航与解析（Navigate）
   - 浏览会话清单、按条件过滤、ID 前缀解析。

—

第二步：建议的 MCP 工具集（精简、接地气、聚焦检索）

仅保留“检索与拉取”相关、且与 App 内功能形成互补的工具集合：

1) Tool Name: search_conversations（核心，一体化“扩展→召回→聚合→引导”）
   - Description: Intent-based search for relevant chats with built-in fuzzy expansion, time window filtering, and LLM guidance. Returns results aggregated by chat (with title and ID) plus snippets.
   - Core value: 解决“ChatWise 现有检索仅关键词命中不够”的痛点，支持“最近 N 月 + 模糊主题”的实际需求。
   - Request（关键入参，面向意图，尽量精简）：
    - intent_query: string | string[]（自然语言意图或关键词数组；如 ["idea","想法"]，用于一次性并行检索多个关键词/短语）
     - time_window?: '7d'|'30d'|'60d'|'90d'|'all' | { start:number; end:number }（默认 'all'）
     - precision_mode?: 'basic'|'fuzzy'（默认 'basic'；'fuzzy' 由 LLM 视需要发起）
     - expand?: 'auto'|'off'（默认 'off'，不做自动扩展；由 LLM 判断后再次调用时可改为 'auto' 或切换 'fuzzy'）
     - include_tools_in_search?: boolean（默认 true；解析并纳入工具产出文本，如 meta.toolResult.content[].text 等）
     - scope?: 'content'|'title'|'both'（默认 'both'）
     - role_filter?: string[]（如 ['user','assistant']）
     - exclude_terms?: string[]（默认 []；负向过滤词，大小写不敏感；对选定 scope 全部生效，若 include_tools_in_search=true 亦作用于工具文本）
     - match?: 'any'|'all'（默认 'any'）
     - limit_chats?: number（默认 10）
     - limit_snippets_per_chat?: number（默认 3）
     - snippet_window?: number（默认 64）
     - response_mode?: 'json'|'text'（默认 'json'；text 模式返回人读文本 + guidance）
   - 语义范围（重要）：
     - 按“会话（chat）”为检索与返回的落点。默认聚合会话内的全部信息：消息正文（message.content）、会话标题（chat.title）与工具产出（message.meta.toolResult 文本），以实现“会话级”检索的一致性。

   - Response（契约，JSON 输出，专为 LLM 消费）：
     {
       "status": "ok" | "error",
        "iterations_used": 1,
        "confidence": number,
        "topChatIds": string[],
        "results": [
         {
           "chatId": string,
           "title": string,
           "hits": number,
           "timeRange": { "from": number, "to": number },
           "snippets": [
             { "messageId": string, "role": string, "createdAt": number, "text": string, "source": "content"|"title"|"tool" }
           ]
         }
       ],
         "guidance": {
           "stopIf": string,
           "nextActions": [{"tool": "search_conversations"|"gather_chats", "args": object, "why": string}],
           "state": {"expandedTerms": object, "excludes": string[], "iteration": number}
         }
     }

2) Tool Name: gather_chats（已实现，保留）
   - Description: Retrieve full timelines for one or multiple chats with optional tool call/result blocks and common alignment for merged view.
   - Key params:
     - chatIds: string[]
     - includeTools?: boolean = true
   - JSON Response（单会话）：
     {
       "chat": { "id": string, "title": string, "messageCount": number, "timeRange": { "from": number, "to": number } },
       "messages": [
         {
           "messageId": string,
           "createdAt": number,
           "role": string,
           "content": string,
           "tools"?: {
             "calls"?: [ { "server": string, "tool": string, "args": any } ],
             "results"?: [ { "text": string } | { "json": any } ]
           }
         }
       ]
     }
   - JSON Response（多会话）：
     {
       "meta": [ { "chatIdx": number, "id": string, "title": string, "timeRange": { "from": number, "to": number } } ],
       "narrative": [
         { "chatIdx": number, "index": number, "messageId": string, "createdAt": number, "role": string, "content": string,
           "tools"?: { "calls"?: [...], "results"?: [...] } }
       ],
       "commonAlignment": [
         { "role": string, "content": string, "refs": [ { "chatIdx": number, "index": number, "messageIdPrefix": string } ] }
       ]
     }

可选（按需再评估是否实现）：
3) Tool Name: resolve_ids（辅助）
   - Description: Resolve chat/message ID by prefix（便于从前缀引用补齐完整 ID）。
   - Key params: { chatIdPrefix?: string; messageIdPrefix?: string }

—

第三步：设计示例工作流（Workflow，聚焦检索）

场景 A：最近 2 个月关于 Rust 的讨论
- 工具链：
  1) search_conversations({ intent_query: "rust", time_window: '60d', precision_mode: 'basic', scope: 'both' })
  2) gather_chats({ chatIds: <topChatIds>.slice(0,2), includeTools: true })
- 解释：先用意图检索得到候选会话与引导；若置信度足够或候选很少，直接拉取前 1~2 个会话全文用于阅读与引用。

场景 B：最近 1 个月是否有“生活类”话题的讨论（无预设主题，仅意图检索）
- 工具链：
  1) search_conversations({ intent_query: '生活 / 日常 / life / travel / shopping', time_window: '30d', precision_mode: 'basic' })
  2) gather_chats({ chatIds: <topChatIds>, includeTools: false })
- 解释：通过主题预设+时间窗召回生活类对话；若召回过多，可根据 guidance 收紧到 ALL/短语 must 后再拉取。
  - 解释：直接用自然语言或若干关键词表达“生活类”意图，配合 fuzzy 扩展与时间窗实现召回；若召回过多，可根据 guidance 收紧到 ALL/短语 must 后再拉取。

场景 C：模糊描述的多轮可控检索（单工具闭环）
- 工具链：
  1) search_conversations({ intent_query: "虚拟列表滚动很卡", precision_mode: 'basic', include_guidance: true })
  2) 若 guidance.confidence 低：LLM 依据 guidance.nextActions 再次调用 search_conversations（例如切换 precision_mode:'fuzzy' 或设置 expand:'auto'），或直接调用 gather_chats 进行验证。
  3) 收敛后：gather_chats({ chatIds: <topChatIds>.slice(0,3), includeTools: true })
- 解释：单工具即可完成“扩展→召回→指引”的闭环，最终收敛到少量会话并拉取全文。

—

第四步：默认策略与待定事项（无需用户配置）
1) 返回条数与片段长度：采用默认值 limit_chats=10、limit_snippets_per_chat=3、snippet_window=64，可在实现中按需微调。
2) 工具产出解析深度：仅提取 toolResult 的纯文本（content[].text），不做更深层 JSON 展平。
3) 去重策略：不启用额外去重，按原始命中返回。
4) fuzzy 强度：默认不做自动转换，由 LLM 依据结果自行决定是否切换到 'fuzzy' 或开启 'expand:auto' 并再次调用。
5) JSON 体量控制：采用 topK 返回，不分页；如超长再评估分页策略。

—

响应约定（通用）
- 所有工具默认返回 JSON 结构化输出（专为 LLM 消费）。
- `search_conversations` 返回按会话聚合的结果（含 Title 与 ID），并附带 guidance；`gather_chats` 返回单/多会话的结构化时间线与对齐信息。
