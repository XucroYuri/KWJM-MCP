/** 模型可承载的能力（可多值） */
export type Modality = 'text' | 'image' | 'video' | 'audio' | 'asset' | 'enhance';

/** 选择层级：默认 / 备选 / 非指明不调用 */
export type SelectionLevel = 'default' | 'fallback' | 'off-by-default';

/**
 * 端点规范：承载实际请求路径 + 方法 + 异步查询路径 + 状态语义。
 * 替代早期笼统的 EndpointKind 枚举，支持真实端点体系（含 /v3、/v1beta、DashScope 等）。
 */
export interface EndpointSpec {
  /** 提交端点，如 /v1/chat/completions（不含 base_url，client 负责拼接） */
  path: string;
  /** HTTP 方法 */
  method: 'POST' | 'GET';
  /** 异步任务的查询端点（若任务型），如 /v1/videos/generations/{id} 或 /v3/contents/generations/tasks/{id} */
  queryPath?: string;
  /** 是否异步任务型（需提交后轮询结果） */
  async: boolean;
  /** 异步状态枚举（用于展示给 Agent 判断进度） */
  statusEnum?: string[];
  /** 关键返回字段（用于能力发现） */
  returnFields?: string[];
  /** 额外说明（如 DashScope 等效、必填头等） */
  note?: string;
}

/**
 * 模型硬约束（能力边界），用于调用前前置校验：
 * 预判用户输入是否必然报错，供 Agent 主动提醒/引导/拦截。
 */
export interface Constraints {
  /** 参考图数量上限（如 gpt-image-2-gp ≤16、gemini-2.5-flash-image-gp ≤3） */
  maxReferenceImages?: number;
  /** 参考视频数量上限 */
  maxReferenceVideos?: number;
  /** 参考音频数量上限 */
  maxReferenceAudios?: number;
  /** 可同时维持主体一致性的数量上限 */
  maxSubjectConsistency?: number;
  /** 尺寸枚举，或 {pattern} 自由约束（如「宽高需 16 整倍」） */
  size?: string[] | { pattern?: string; note?: string };
  /** 分辨率枚举 */
  resolution?: string[];
  /** 比例枚举 */
  ratio?: string[];
  /** 时长（秒）枚举或 {min,max} 范围 */
  duration?: string[] | { min?: number; max?: number; note?: string };
  /** 质量枚举 */
  quality?: string[];
  /** 输出格式枚举 */
  outputFormat?: string[];
  /** 必现错误说明（如「不可单独输入音频」） */
  hardFail?: string[];
}

/** 单个模型的完整能力描述 */
export interface ModelCapability {
  id: string;
  /** 模型族：openai / seed / seedance / dreamina / deepseek / qwen / google / anthropic / kling / minimax / ... */
  family: string;
  /** 功能大类，如 text / image / video */
  modality: Modality;
  /** 该模型经由的端点（真实路径） */
  endpoints: EndpointSpec[];
  /** 选择层级：default 优先，fallback 备选，off-by-default 仅显式指名 */
  selectionLevel: SelectionLevel;
  /** 同类型任务的默认首选（指引 Agent 上下文决策），可为多个功能大类 */
  defaultFor?: string[];
  /** 是否版本歧义（多版本需问询确认） */
  ambiguous?: boolean;
  /**
   * 别名映射：本模型承载的「别名 → 真实模型 ID」。
   * 仅在没有同名精确模型 ID 时使用；不得覆盖 /v1/models 返回的 exact ID。
   * 键为用户可能输入的别名，值为最终落到 registry 的真实模型 id。
   */
  aliases?: Record<string, string>;
  contextWindow?: number;
  costTier?: 'low' | 'medium' | 'high';
  notes?: string;
  /** 关键请求参数（含枚举）用于能力发现 */
  params?: { name: string; required?: boolean; enum?: string[]; note?: string }[];
  /** 模型硬约束（能力边界），用于前置校验 */
  constraints?: Constraints;
}

/** /v1/models 返回的实时条目（通常只有 id，可能含能力提示） */
export interface LiveModelEntry {
  id: string;
  object?: string;
  owned_by?: string;
  [k: string]: unknown;
}

/** 解析结果：已唯一命中 / 歧义需问询 / 未命中 */
export type Resolution =
  | { status: 'resolved'; model: ModelCapability; resolvedFrom?: string }
  | { status: 'ambiguous'; keyword: string; candidates: ModelCapability[]; message: string }
  | { status: 'not-found'; input: string };
