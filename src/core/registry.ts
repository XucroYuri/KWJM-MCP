import type { Constraints, EndpointSpec, LiveModelEntry, ModelCapability, Modality, Resolution, SelectionLevel } from './types.js';

export { DEFAULT_BASE_URL } from './config.js';

function norm(id: string): string {
  return id.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 端点快捷构造 */
function post(path: string, opts: Partial<EndpointSpec> = {}): EndpointSpec {
  return { path, method: 'POST', async: false, ...opts };
}
function get(path: string, opts: Partial<EndpointSpec> = {}): EndpointSpec {
  return { path, method: 'GET', async: false, ...opts };
}

/** 常见异步状态枚举 */
const VIDEO_STATUS = ['queued', 'running', 'succeeded', 'failed', 'expired'];
const TASK_STATUS_COMPLETED = ['queued', 'running', 'completed', 'failed'];
const IMAGE_ASYNC_STATUS = ['WAIT', 'RUN', 'DONE', 'FAIL'];
const SEEDANCE_2_0_INPUTS = new Set(['seedance 2.0', 'seedance-2.0', 'seedance2.0', 'seedance 2', 'seedance-2', 'seedance2', 'sd-2']);
const SEEDANCE_2_0_CANDIDATES = ['kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini'];
const SEEDANCE_2_5_INPUTS = new Set(['seedance 2.5', 'seedance-2.5', 'seedance2.5', 'seedance 2 5', 'seedance-2-5', 'sd-2.5']);

/** 内部种子类型：一组端点 + 元数据 + 别名 */
interface SeedModel {
  id: string;
  family: string;
  modality: Modality;
  endpoints: EndpointSpec[];
  selectionLevel?: SelectionLevel;
  defaultFor?: string[];
  ambiguous?: boolean;
  aliases?: string[];
  contextWindow?: number;
  costTier?: 'low' | 'medium' | 'high';
  notes?: string;
  params?: { name: string; required?: boolean; enum?: string[]; note?: string }[];
  constraints?: Constraints;
}

/**
 * 真实模型能力表 —— 基于开物基模 API 文档（62 个 modelhub 页面）逐条内化。
 *
 * 端点体系（base = https://kwjm.com）：
 * - 文本：/v1/chat/completions、/v1/responses、/v1/messages
 * - 图像：/v1/images/generations、/v1/images/edits、/v1/images/generations/tasks（异步，-gp 后缀）
 * - 视频：/v1/videos/generations(seedance/wan)、/v3/contents/generations/tasks(dreamina/kw-video)、
 *         /v1/videos/text2video|image2video|video2video|reference(kling)、/v1/videos/create(veo/sora-sp)、
 *         /v2/video_generation(MiniMax)、DashScope /api/v1/services/aigc/video-generation/video-synthesis(wan2.7)
 * - gemini 原生：/v1beta/models/{model}:generateContent
 * - 资产：/v3/open/*
 */

const SEED: SeedModel[] = [
  // ================= 文本 · OpenAI Chat =================
  {
    id: 'gpt-5.2-pro-2025-12-11',
    family: 'openai',
    modality: 'text',
    endpoints: [
      post('/v1/chat/completions'),
      post('/v1/responses'),
    ],
    selectionLevel: 'default',
    defaultFor: ['text'],
    contextWindow: 128000,
    costTier: 'high',
    notes: 'OpenAI 文本默认首选，通用与复杂推理（chat + responses）。',
    params: [
      { name: 'model', required: true },
      { name: 'messages', required: true },
      { name: 'reasoning.effort', enum: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
    ],
  },
  {
    id: 'gpt-5.2-2025-12-11',
    family: 'openai',
    modality: 'text',
    endpoints: [post('/v1/chat/completions'), post('/v1/responses')],
    selectionLevel: 'fallback',
    contextWindow: 128000,
    costTier: 'medium',
    notes: 'GPT-5.2 标准档，备选。',
    aliases: ['gpt-5.2'],
  },
  {
    id: 'gpt-5.4',
    family: 'openai',
    modality: 'text',
    endpoints: [post('/v1/chat/completions'), post('/v1/responses')],
    selectionLevel: 'fallback',
    notes: 'GPT-5.4 兼容入口。',
    aliases: ['gpt-5'],
    ambiguous: true,
  },
  {
    id: 'openai/gpt-5.5',
    family: 'openai',
    modality: 'text',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    costTier: 'high',
    notes: '第一阶段多模态文本模型；精确 ID 以 /v1/models 为准。',
  },
  ...['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol'].map((id): SeedModel => ({
    id,
    family: 'openai',
    modality: 'text',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    costTier: id.endsWith('-sol') ? 'high' : 'medium',
    notes: '第一阶段多模态文本模型；精确 ID 以 /v1/models 为准。',
  })),
  ...[
    ['kimi-k3', 'moonshot'],
    ['glm-5.2', 'zhipu'],
    ['grok-4.5', 'grok'],
  ].map(([id, family]): SeedModel => ({
    id,
    family,
    modality: 'text',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    costTier: 'medium',
    notes: '第一阶段多模态文本模型；精确 ID 以 /v1/models 为准。',
  })),
  // ================= 文本 · responses 通用 =================
  {
    id: 'gpt-4.1',
    family: 'openai',
    modality: 'text',
    endpoints: [post('/v1/responses')],
    selectionLevel: 'off-by-default',
    notes: 'responses 端点兼容模型（gpt-4.1/o3/o3-mini/gpt-4o）。',
    aliases: ['o3', 'o3-mini', 'gpt-4o'],
    ambiguous: true,
  },
  // ================= 文本 · Anthropic Messages =================
  {
    id: 'claude-sonnet-4-6',
    family: 'anthropic',
    modality: 'text',
    endpoints: [post('/v1/messages')],
    selectionLevel: 'fallback',
    contextWindow: 200000,
    costTier: 'medium',
    notes: 'Anthropic Messages 入口，Sonnet 系列。',
    aliases: ['claude-sonnet-4-5-20250929', 'aws/claude-sonnet-4-6'],
  },
  {
    id: 'claude-opus-4-8',
    family: 'anthropic',
    modality: 'text',
    endpoints: [post('/v1/messages')],
    selectionLevel: 'off-by-default',
    contextWindow: 200000,
    costTier: 'high',
    notes: 'Anthropic Opus 系列（含 aws/claude-opus-4-6/4-7/4-8），最贵档，非指明不调用。',
    aliases: ['claude-opus-4-6', 'claude-opus-4-7', 'aws/claude-opus-4-6', 'aws/claude-opus-4-7'],
    ambiguous: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    family: 'anthropic',
    modality: 'text',
    endpoints: [post('/v1/messages')],
    selectionLevel: 'fallback',
    contextWindow: 200000,
    costTier: 'low',
    notes: 'Anthropic Haiku 系列，轻量档。',
    aliases: ['claude-haiku-4-5', 'aws/claude-haiku-4-5'],
  },
  // ================= 文本 · DeepSeek =================
  {
    id: 'deepseek-v3-2',
    family: 'deepseek',
    modality: 'text',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    contextWindow: 128000,
    costTier: 'low',
    notes: 'DeepSeek V3.2（deepseek-v3.2 / deepseek-v3-2-251201）。',
    aliases: ['deepseek-v3-2-251201', 'deepseek'],
    ambiguous: true,
  },
  ...['deepseek-v4-flash', 'deepseek-v4-pro'].map((id): SeedModel => ({
    id,
    family: 'deepseek',
    modality: 'text',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    costTier: id.endsWith('-flash') ? 'low' : 'medium',
    notes: '第一阶段纯文本模型，支持普通对话、流式和工具调用。',
  })),
  // ================= 文本 · Qwen 生文 =================
  {
    id: 'qwen3-max',
    family: 'qwen',
    modality: 'text',
    endpoints: [post('/v1/responses'), post('/v1/chat/completions')],
    selectionLevel: 'fallback',
    contextWindow: 131072,
    costTier: 'medium',
    notes: 'Qwen 生文系列（qwen3.5-flash / qwen3.5-plus / qwen3-max）。',
    aliases: ['qwen3.5-flash', 'qwen3.5-plus', 'qwen'],
    ambiguous: true,
  },
  // ================= 文本 · doubao-seed（responses）=================
  {
    id: 'doubao-seed-2-0-pro',
    family: 'seed',
    modality: 'text',
    endpoints: [post('/v1/responses')],
    selectionLevel: 'fallback',
    contextWindow: 128000,
    costTier: 'medium',
    notes: '豆包 Seed 系列（doubao-seed-2-0-pro/lite/mini）。',
    aliases: ['doubao-seed-2-0-mini', 'doubao-seed-2-0-lite', 'doubao-seed-2-0-mini-260215'],
    ambiguous: true,
  },
  // ================= 图像 · OpenAI =================
  {
    id: 'gpt-image-2',
    family: 'openai',
    modality: 'image',
    endpoints: [post('/v1/images/generations'), post('/v1/images/edits')],
    selectionLevel: 'default',
    defaultFor: ['image'],
    notes: '生图默认首选。',
    constraints: {
      size: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'],
      quality: ['low', 'medium', 'high', 'auto'],
      maxReferenceImages: 16,
    },
    params: [
      { name: 'model', required: true },
      { name: 'prompt', required: true },
      { name: 'size', enum: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'] },
      { name: 'quality', enum: ['low', 'medium', 'high', 'auto'] },
    ],
  },
  ...['openai/gpt-image-2', 'gpt-image-2-hq', 'gpt-image-2-sp'].map((id): SeedModel => ({
    id,
    family: 'openai',
    modality: 'image',
    endpoints: [post('/v1/images/generations'), post('/v1/images/edits')],
    selectionLevel: 'fallback',
    costTier: id.endsWith('-hq') ? 'high' : 'medium',
    notes: '第一阶段 OpenAI 兼容图像模型；精确 ID 以 /v1/models 为准。',
    constraints: {
      size: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'],
      quality: ['low', 'medium', 'high', 'auto'],
      maxReferenceImages: 16,
    },
    params: [
      { name: 'model', required: true },
      { name: 'prompt', required: true },
      { name: 'size', enum: ['1024x1024', '1536x1024', '1024x1536', '2048x2048', '2048x1152', '3840x2160', '2160x3840', 'auto'] },
      { name: 'quality', enum: ['low', 'medium', 'high', 'auto'] },
    ],
  })),
  {
    id: 'gpt-image-1.5',
    family: 'openai',
    modality: 'image',
    endpoints: [post('/v1/images/generations'), post('/v1/images/edits')],
    selectionLevel: 'fallback',
    notes: 'GPT-Image-1.5 生图/编辑。',
    aliases: ['gpt-image'],
    params: [
      { name: 'quality', enum: ['auto', 'high', 'medium', 'low'] },
      { name: 'background', enum: ['auto', 'transparent', 'opaque'] },
    ],
  },
  {
    id: 'gpt-image-2-gp',
    family: 'openai',
    modality: 'image',
    endpoints: [
      post('/v1/images/generations/tasks', { async: true, queryPath: '/v1/images/generations/tasks/{task_id}', statusEnum: IMAGE_ASYNC_STATUS, returnFields: ['task_id', 'status', 'image_urls', 'usage'] }),
    ],
    selectionLevel: 'off-by-default',
    notes: '图像异步接口（-gp 后缀），参考图片最多 16 张，quality low/medium/high。',
    constraints: { maxReferenceImages: 16 },
    params: [
      { name: 'model', required: true },
      { name: 'prompt', required: true },
      { name: 'images', note: '参考图片列表' },
      { name: 'aspect_ratio', enum: ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', '21:9', '9:21'] },
      { name: 'quality', enum: ['low', 'medium', 'high'] },
    ],
  },
  // ================= 图像 · doubao-seedream =================
  {
    id: 'doubao-seedream-5-0-lite',
    family: 'seedream',
    modality: 'image',
    endpoints: [post('/v1/images/generations', {
      returnFields: ['model', 'created', 'data', 'usage'],
    })],
    selectionLevel: 'fallback',
    notes: '豆包 Seedream 生图系列（seedream-5-0-lite/4-5/4-0）。',
    aliases: ['doubao-seedream-4-5', 'doubao-seedream-4-0', 'doubao-seedream-5-0-260128'],
    params: [
      { name: 'size', enum: ['2K', '3K', '4K', '1K'] },
      { name: 'output_format', enum: ['png', 'jpeg'] },
      { name: 'response_format', enum: ['url', 'b64_json'] },
    ],
  },
  // ================= 图像 · Qwen / wan 生图 =================
  {
    id: 'qwen-image-2.7',
    family: 'qwen',
    modality: 'image',
    endpoints: [post('/v1/images/generations')],
    selectionLevel: 'fallback',
    notes: 'Qwen 生图系列（qwen-image-2.0/2.0-pro/2.6/2.7），DashScope 等效。',
    aliases: ['qwen-image-2.0', 'qwen-image-2.0-pro', 'qwen-image-2.6', 'qwen-image'],
    ambiguous: true,
  },
  {
    id: 'wan2.7-image',
    family: 'qwen',
    modality: 'image',
    endpoints: [post('/v1/images/generations')],
    selectionLevel: 'fallback',
    notes: 'wan 生图系列（wan2.6-image / wan2.7-image / wan2.7-image-pro）。',
    aliases: ['wan2.6-image', 'wan2.7-image-pro', 'wan-image'],
    ambiguous: true,
  },
  // ================= 视频 · doubao-seedance =================
  {
    id: 'doubao-seedance-1-5-pro',
    family: 'seedance',
    modality: 'video',
    endpoints: [
      post('/v1/videos/generations', {
        async: true,
        queryPath: '/v1/videos/generations/{id}',
        statusEnum: VIDEO_STATUS,
        returnFields: ['id', 'model', 'status', 'content.video_url', 'usage'],
      }),
    ],
    selectionLevel: 'fallback',
    notes: 'Seedance 1.5 文/图生视频。注意：用户说 Seedance 2.0 时应走 kw-video-v2 候选，不使用本模型。',
    params: [
      { name: 'ratio', enum: ['16:9', '9:16', '1:1', 'adaptive'] },
      { name: 'resolution', enum: ['480p', '720p', '1080p', '4k'] },
      { name: 'duration' },
      { name: 'generate_audio' },
    ],
  },
  // ================= 视频 · KWJM 精确 ID =================
  ...['kw-video-v2', 'kw-video-v2-fast', 'kw-video-v2-mini', 'kw-video-v2.5'].map((id): SeedModel => ({
    id,
    family: 'kw-video',
    modality: 'video',
    endpoints: [post('/v3/contents/generations/tasks', {
      async: true,
      queryPath: '/v3/contents/generations/tasks/{id}',
      statusEnum: VIDEO_STATUS,
      returnFields: ['id', 'model', 'status', 'content.video_url', 'usage'],
    })],
    selectionLevel: id === 'kw-video-v2' ? 'default' : 'fallback',
    defaultFor: id === 'kw-video-v2' ? ['video'] : undefined,
    costTier: id.endsWith('-mini') ? 'medium' : 'high',
    aliases: id === 'kw-video-v2-fast'
      ? ['seedance-2.0-fast', 'seedance 2.0 fast']
      : id === 'kw-video-v2-mini'
        ? ['seedance-2.0-mini', 'seedance 2.0 mini']
        : undefined,
    notes: id === 'kw-video-v2'
      ? 'KWJM /v1/models 返回的精确视频模型 ID；用户说 Seedance 2.0 时最匹配本模型，但需让用户在 kw-video-v2 / kw-video-v2-fast / kw-video-v2-mini 中确认。'
      : id === 'kw-video-v2.5'
        ? 'KWJM /v1/models 返回的精确视频模型 ID；用户说 Seedance 2.5 时即指向本模型。'
        : 'KWJM /v1/models 返回的精确视频模型 ID；用户说 Seedance 2.0 时可作为候选之一，需用户确认。',
    constraints: {
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
      resolution: ['480p', '720p', '1080p', '4k'],
      duration: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '-1'],
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      hardFail: ['不可单独输入音频：需至少包含 1 个参考视频或图片'],
    },
    params: [
      { name: 'ratio', enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] },
      { name: 'resolution', enum: ['480p', '720p', '1080p', '4k'] },
      { name: 'duration', enum: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '-1'] },
      { name: 'generate_audio', enum: ['true', 'false'] },
    ],
  })),
  // ================= 视频 · dreamina-seedance 兼容名 =================
  {
    id: 'dreamina-seedance-2-0',
    family: 'dreamina',
    modality: 'video',
    endpoints: [
      post('/v3/contents/generations/tasks', {
        async: true,
        queryPath: '/v3/contents/generations/tasks/{id}',
        statusEnum: VIDEO_STATUS,
        returnFields: ['id', 'model', 'status', 'content.video_url', 'usage'],
      }),
    ],
    selectionLevel: 'fallback',
    notes: 'Dreamina Seedance 2.0 兼容模型；不承接“Seedance 2.0”自然语言语义，用户说 Seedance 2.0 时应返回 kw-video-v2 / kw-video-v2-fast / kw-video-v2-mini 候选并让用户确认。',
    constraints: {
      ratio: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
      resolution: ['480p', '720p', '1080p', '4k'],
      duration: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '-1'],
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      hardFail: ['不可单独输入音频：需至少包含 1 个参考视频或图片'],
    },
    params: [
      { name: 'ratio', enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'] },
      { name: 'resolution', enum: ['480p', '720p', '1080p', '4k'] },
      { name: 'duration', enum: ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '-1'] },
      { name: 'generate_audio', enum: ['true', 'false'] },
    ],
  },
  {
    id: 'dreamina-seedance-2-0-fast',
    family: 'dreamina',
    modality: 'video',
    endpoints: [
      post('/v3/contents/generations/tasks', { async: true, queryPath: '/v3/contents/generations/tasks/{id}', statusEnum: VIDEO_STATUS }),
    ],
    selectionLevel: 'fallback',
    notes: 'Dreamina Seedance 2.0 快档兼容模型。',
  },
  {
    id: 'dreamina-seedance-2-0-mini',
    family: 'dreamina',
    modality: 'video',
    endpoints: [
      post('/v3/contents/generations/tasks', { async: true, queryPath: '/v3/contents/generations/tasks/{id}', statusEnum: VIDEO_STATUS }),
    ],
    selectionLevel: 'fallback',
    notes: 'Dreamina Seedance 2.0 轻量档兼容模型。',
  },
  // ================= 视频 · wan 系列（DashScope 等效）=================
  {
    id: 'wan2.6-t2v',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/v1/videos/generations', {
        async: true,
        queryPath: '/v1/videos/generations/{id}',
        statusEnum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'],
      }),
    ],
    selectionLevel: 'off-by-default',
    notes: 'Wan 生视频旧版：wan2.6-t2v（文生视频），已被 wan2.7-t2v 取代，仅显式指名时使用。',
    params: [{ name: 'input.prompt', required: true }, { name: 'parameters.size', enum: ['720P', '1080P'] }],
  },
  {
    id: 'wan2.6-r2v-flash',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/v1/videos/generations', { async: true, queryPath: '/v1/videos/generations/{id}', statusEnum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] }),
    ],
    selectionLevel: 'off-by-default',
    notes: 'Wan 参考生视频旧版（角色一致性），已被 wan2.7-r2v 取代，仅显式指名时使用。',
    params: [{ name: 'input.reference_urls', required: true }],
  },
  {
    id: 'wanx2.1-i2v-turbo',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/v1/videos/generations', { async: true, queryPath: '/v1/videos/generations/{id}' }),
    ],
    selectionLevel: 'off-by-default',
    notes: 'Wan 图生视频旧版（首帧/首尾帧 turbo），已被 wan2.7-i2v 取代，仅显式指名时使用。',
    aliases: ['wanx2.1-kf2v-plus'],
  },
  {
    id: 'wan2.7-t2v',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/api/v1/services/aigc/video-generation/video-synthesis', { async: true, queryPath: '/api/v1/tasks/{task_id}' }),
    ],
    selectionLevel: 'fallback',
    notes: 'Wan2.7 文生视频（DashScope 原生）。',
  },
  {
    id: 'wan2.7-i2v',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/api/v1/services/aigc/video-generation/video-synthesis', { async: true, queryPath: '/api/v1/tasks/{task_id}' }),
    ],
    selectionLevel: 'fallback',
    notes: 'Wan2.7 图生视频（DashScope 原生）。',
  },
  {
    id: 'wan2.7-r2v',
    family: 'qwen',
    modality: 'video',
    endpoints: [
      post('/api/v1/services/aigc/video-generation/video-synthesis', { async: true, queryPath: '/api/v1/tasks/{task_id}' }),
    ],
    selectionLevel: 'fallback',
    notes: 'Wan2.7 参考生视频（DashScope 原生）。',
  },
  // ================= 视频 · kling（专属端点）=================
  {
    id: 'kling-v3.0-pro',
    family: 'kling',
    modality: 'video',
    endpoints: [
      post('/v1/videos/text2video', { async: true, queryPath: '/v1/general/query/{id}', statusEnum: TASK_STATUS_COMPLETED }),
      post('/v1/videos/image2video', { async: true, queryPath: '/v1/general/query/{id}', statusEnum: TASK_STATUS_COMPLETED }),
    ],
    selectionLevel: 'fallback',
    notes: '快手可灵 v3.0-pro（-gp 后缀等同）。',
    aliases: ['kling-v3.0-pro-gp', 'kling-v3.0', 'kling-v3-pro'],
  },
  {
    id: 'kling-v3.0-std',
    family: 'kling',
    modality: 'video',
    endpoints: [
      post('/v1/videos/text2video', { async: true, queryPath: '/v1/general/query/{id}', statusEnum: TASK_STATUS_COMPLETED }),
      post('/v1/videos/image2video', { async: true, queryPath: '/v1/general/query/{id}', statusEnum: TASK_STATUS_COMPLETED }),
    ],
    selectionLevel: 'fallback',
    notes: '快手可灵 v3.0-standard。',
    aliases: ['kling-v3.0-std-gp', 'kling-v3-std'],
  },
  {
    id: 'kling-v2.6-std',
    family: 'kling',
    modality: 'video',
    endpoints: [
      post('/v1/videos/text2video', { async: true, queryPath: '/v1/general/query/{id}' }),
      post('/v1/videos/image2video', { async: true, queryPath: '/v1/general/query/{id}' }),
    ],
    selectionLevel: 'off-by-default',
    notes: '快手可灵 v2.6-standard（旧版，能力不足，仅在显式指名时使用；请优先用 v3.0-pro 或 video-o1-pro）。',
    aliases: ['kling-v2.6-std-gp', 'kling-v2.6-std'],
  },
  {
    id: 'kling-video-o1-pro',
    family: 'kling',
    modality: 'video',
    endpoints: [
      post('/v1/videos/text2video', { async: true, queryPath: '/v1/general/query/{id}' }),
      post('/v1/videos/image2video', { async: true, queryPath: '/v1/general/query/{id}' }),
      post('/v1/videos/video2video', { async: true, queryPath: '/v1/general/query/{id}' }),
      post('/v1/videos/reference', { async: true, queryPath: '/v1/general/query/{id}' }),
    ],
    selectionLevel: 'fallback',
    notes: '快手可灵 video-o1-pro（文/图/视频/参考四入口）。',
    aliases: ['kling-video-o1-pro-gp', 'kling-o1-pro'],
    params: [{ name: 'prompt', required: true }, { name: 'duration', enum: ['3', '4', '5', '6', '7', '8', '9', '10'] }],
  },
  {
    id: 'kling-v3-image-gp',
    family: 'kling',
    modality: 'image',
    endpoints: [
      post('/images/generations/tasks', { async: true, queryPath: '/images/generations/tasks/{task_id}', statusEnum: ['pending', 'succeeded'] }),
    ],
    selectionLevel: 'fallback',
    notes: '可灵生图（kling-v3-image-gp / kling-v3-omni-image-gp）。',
    aliases: ['kling-v3-omni-image-gp'],
  },
  // ================= 视频 · MiniMax =================
  {
    id: 'MiniMax-H3',
    family: 'minimax',
    modality: 'video',
    endpoints: [
      post('/v2/video_generation', { async: true, queryPath: '/v2/query/video_generation/{task_id}', statusEnum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired'] }),
      post('/v2/video_regeneration', { async: true, queryPath: '/v2/query/video_generation/{task_id}' }),
    ],
    selectionLevel: 'fallback',
    notes: 'MiniMax H3 生视频 + 超分（可平替 Seedance 2.0，作备选）。',
    aliases: ['minimax-h3'],
  },
  // ================= 视频 · Google sora / veo =================
  {
    id: 'sora-2',
    family: 'google',
    modality: 'video',
    endpoints: [
      post('/v1/videos', {
        returnFields: ['id', 'status', 'progress', 'videoUrl'],
      }),
    ],
    selectionLevel: 'fallback',
    notes: 'Sora-2 / sora-2-pro 生视频。',
    aliases: ['sora-2-pro', 'sora2'],
    params: [{ name: 'seconds', enum: ['4', '8', '12'] }],
  },
  {
    id: 'veo3.1-fast-sp',
    family: 'google',
    modality: 'video',
    endpoints: [
      post('/v1/videos/create', { async: true, queryPath: '/v1/videos/generations/{id}', statusEnum: ['pending', 'video_generating', 'video_generation_completed', 'completed', 'failed'] }),
    ],
    selectionLevel: 'fallback',
    notes: 'Veo3.1（veo3.1-fast-sp / veo3.1-sp / veo3.1-pro-4k-sp）。',
    aliases: ['veo3.1-sp', 'veo3.1-pro-4k-sp', 'veo3.1'],
  },
  {
    id: 'sora-2-sp',
    family: 'google',
    modality: 'video',
    endpoints: [
      post('/v1/videos/create', { async: true, queryPath: '/v1/videos/generations/{id}', statusEnum: ['pending', 'video_generating', 'completed', 'failed'] }),
    ],
    selectionLevel: 'fallback',
    notes: 'Sora-2-special（sora-2-sp / sora-2-hq / sora-2）。',
    aliases: ['sora-2-hq'],
  },
  // ================= gemini 原生（generateContent）=================
  {
    id: 'gemini-3-pro-preview',
    family: 'google',
    modality: 'text',
    endpoints: [post('/v1beta/models/{model}:generateContent')],
    selectionLevel: 'fallback',
    notes: 'Gemini 3 系列原生 generateContent（文本/图像多模态）。',
    aliases: ['gemini-3', 'gemini-3-flash-preview', 'gemini-3.1-pro-preview'],
    ambiguous: true,
  },
  {
    id: 'gemini-2.5-flash-image',
    family: 'google',
    modality: 'image',
    endpoints: [post('/v1beta/models/{model}:generateContent', { returnFields: ['candidates.content.parts.inlineData.data'] })],
    selectionLevel: 'fallback',
    notes: 'Gemini 2.5 flash 生图（原生 generateContent）。',
    aliases: ['gemini-2.5-flash-image'],
    constraints: { maxReferenceImages: 3, ratio: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'], resolution: ['1K', '2K', '4K'] },
  },
  {
    id: 'gemini-3-pro-image-preview',
    family: 'google',
    modality: 'image',
    endpoints: [post('/v1beta/models/{model}:generateContent')],
    selectionLevel: 'fallback',
    notes: 'Gemini 3 pro 生图（原生）。',
    aliases: ['gemini-3.1-flash-image-preview'],
    constraints: { maxReferenceImages: 14, ratio: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'], resolution: ['1K', '2K', '4K'] },
  },
  {
    id: 'gemini-3.1-flash-tts-preview',
    family: 'google',
    modality: 'audio',
    endpoints: [post('/v1beta/models/{model}:generateContent', { note: 'responseModalities=AUDIO, 语音合成' })],
    selectionLevel: 'off-by-default',
    notes: 'Gemini TTS（语音合成），非指明不调用。',
  },
  // ================= 视频 · grok =================
  {
    id: 'grok-imagine-1.0-video-sp',
    family: 'grok',
    modality: 'video',
    endpoints: [post('/v1/chat/completions')],
    selectionLevel: 'off-by-default',
    notes: 'Grok 视频生成（经 chat/completions 特殊协议），非指明不调用。',
    params: [
      { name: 'video_config.duration', enum: ['6', '10'] },
      { name: 'video_config.aspect_ratio', enum: ['16:9', '9:16', '1:1', '2:3', '3:2'] },
    ],
  },
  // ================= 增强/工具 =================
  {
    id: 'doubao-video-enhance',
    family: 'seedance',
    modality: 'enhance',
    endpoints: [
      post('/v3/tools/enhance-video-generative', { async: true, queryPath: '/v3/tools/enhance-video-generative/{task_id}', statusEnum: ['completed', 'failed'] }),
    ],
    selectionLevel: 'off-by-default',
    notes: '画质增强（doubao-video-enhance）。',
    aliases: ['sd-video-v2'],
  },
  {
    id: 'kw-video-v2-erase',
    family: 'dreamina',
    modality: 'enhance',
    endpoints: [
      post('/v3/tools/erase-video-subtitle', { async: true, queryPath: '/v3/tools/erase-video-subtitle/{task_id}', statusEnum: ['running', 'completed', 'failed'] }),
    ],
    selectionLevel: 'off-by-default',
    notes: '字幕擦除（kw-video-erase）。',
    aliases: ['kw-video-erase'],
  },
];

/** 能力注册表 */
export class ModelRegistry {
  private byId = new Map<string, ModelCapability>();
  private byAlias = new Map<string, string>();
  private aliasesOf = new Map<string, string[]>();

  constructor(seed: SeedModel[] = SEED) {
    for (const s of seed) {
      const cap: ModelCapability = {
        id: s.id,
        family: s.family,
        modality: s.modality,
        endpoints: s.endpoints,
        selectionLevel: s.selectionLevel ?? 'off-by-default',
        defaultFor: s.defaultFor,
        ambiguous: s.ambiguous,
        contextWindow: s.contextWindow,
        costTier: s.costTier,
        notes: s.notes,
        params: s.params,
      };
      if (s.constraints) cap.constraints = s.constraints;
      if (s.aliases && s.aliases.length) cap.aliases = Object.fromEntries(s.aliases.map((a) => [a, s.id]));
      this.byId.set(norm(s.id), cap);
      if (s.aliases) {
        this.aliasesOf.set(norm(s.id), s.aliases);
        for (const a of s.aliases) this.byAlias.set(norm(a), norm(s.id));
      }
    }
  }

  all(): ModelCapability[] {
    return [...this.byId.values()];
  }

  has(input: string): boolean {
    const k = norm(input);
    return this.byId.has(k) || this.byAlias.has(k) || SEEDANCE_2_0_INPUTS.has(k) || SEEDANCE_2_5_INPUTS.has(k);
  }

  byRealId(id: string): ModelCapability | undefined {
    return this.byId.get(norm(id));
  }

  aliasesOfReal(id: string): string[] {
    return this.aliasesOf.get(norm(id)) ?? [];
  }

  resolve(input: string): Resolution {
    const k = norm(input);
    if (SEEDANCE_2_0_INPUTS.has(k)) {
      const candidates = SEEDANCE_2_0_CANDIDATES
        .map((id) => this.byId.get(norm(id)))
        .filter((model): model is ModelCapability => Boolean(model));
      return {
        status: 'ambiguous',
        keyword: input,
        candidates,
        recommended: candidates.find((candidate) => candidate.id === 'kw-video-v2'),
        requiresUserConfirmation: true,
        message: `模型「${input}」在 KWJM 语义中对应 kw-video-v2 / kw-video-v2-fast / kw-video-v2-mini；最匹配的是 kw-video-v2，请确认其一后重试。`,
      };
    }
    if (SEEDANCE_2_5_INPUTS.has(k)) {
      const model = this.byId.get(norm('kw-video-v2.5'));
      if (model) return { status: 'resolved', model, resolvedFrom: input };
    }
    const direct = this.byId.get(k);
    if (direct) return { status: 'resolved', model: direct };
    const realId = this.byAlias.get(k);
    if (realId) {
      const model = this.byId.get(realId);
      if (model) return { status: 'resolved', model, resolvedFrom: input };
    }
    const candidates = this.matchCandidates(input);
    if (candidates.length === 1) {
      const model = candidates[0];
      return { status: 'resolved', model, resolvedFrom: model.id === k ? undefined : input };
    }
    if (candidates.length > 1) {
      return {
        status: 'ambiguous',
        keyword: input,
        candidates,
        message: `模型「${input}」存在多个候选，请确认其一后重试（或由 Agent 依据上下文选定）。`,
      };
    }
    return { status: 'not-found', input };
  }

  matchCandidates(keyword: string): ModelCapability[] {
    const kw = norm(keyword);
    if (!kw) return this.all();
    if (SEEDANCE_2_0_INPUTS.has(kw)) {
      return SEEDANCE_2_0_CANDIDATES
        .map((id) => this.byId.get(norm(id)))
        .filter((model): model is ModelCapability => Boolean(model));
    }
    if (SEEDANCE_2_5_INPUTS.has(kw)) {
      const model = this.byId.get(norm('kw-video-v2.5'));
      return model ? [model] : [];
    }
    const direct = this.byId.get(kw);
    if (direct) return [direct];
    const realId = this.byAlias.get(kw);
    if (realId) {
      const m = this.byId.get(realId);
      if (m) return [m];
    }
    if (kw.length < 2) return this.all();
    const hits = new Set<ModelCapability>();
    for (const cap of this.byId.values()) {
      const names = [cap.id, cap.family, ...this.aliasesOfReal(cap.id)];
      if (names.some((n) => n.toLowerCase().includes(kw))) hits.add(cap);
    }
    return [...hits];
  }

  mergeLive(live: LiveModelEntry[]): { added: string[]; known: number } {
    const added: string[] = [];
    let known = 0;
    for (const e of live) {
      if (!e.id) continue;
      const k = norm(e.id);
      if (this.byId.has(k)) {
        known += 1;
        continue;
      }
      // 平台实时 exact ID 是最高优先级真相。若它曾被当成别名，先解除别名再注册原 ID。
      this.byAlias.delete(k);
      this.byId.set(k, {
        id: e.id,
        family: e.owned_by || 'unknown',
        modality: 'text',
        endpoints: [post('/v1/chat/completions')],
        selectionLevel: 'off-by-default',
        notes: '由 /v1/models 实时发现，能力未策展；非指明不调用。',
      });
      added.push(e.id);
    }
    return { added, known };
  }

  byModality(modality: Modality): ModelCapability[] {
    return [...this.byId.values()].filter((c) => c.modality === modality);
  }

  defaultForModality(modality: Modality): ModelCapability | undefined {
    return [...this.byId.values()].find((c) => c.modality === modality && c.selectionLevel === 'default');
  }

  fallbackForModality(modality: Modality): ModelCapability[] {
    return [...this.byId.values()].filter((c) => c.modality === modality && c.selectionLevel === 'fallback');
  }

  /** 非指明不调用（off-by-default）清单，用于显式提示「不要默认触碰」 */
  offByDefaultForModality(modality: Modality): ModelCapability[] {
    return [...this.byId.values()].filter((c) => c.modality === modality && c.selectionLevel === 'off-by-default');
  }

  families(): string[] {
    return [...new Set([...this.byId.values()].map((c) => c.family))];
  }
}

/** 默认实例 */
export const registry = new ModelRegistry();
