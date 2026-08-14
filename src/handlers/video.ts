import { z } from 'zod';
import type { ModelRegistry } from '../core/registry.js';
import type { KwjmClient } from '../core/client.js';
import type { EndpointSpec, ModelCapability } from '../core/types.js';
import { asToolError, toTextContent, type ToolRegistrar } from './result.js';
import { guardModel } from './guard.js';
import { checkConstraints } from './validate.js';

/**
 * 视频提交：按模型能力表分派到其真实端点（seedance/dreamina→/v3 或 /v1、kling→/text2video|image2video|video2video|reference、
 * wan→/v1/videos/generations 或 DashScope、MiniMax→/v2/video_generation、veo/sora-sp→/v1/videos/create、sora2→/v1/videos）。
 */

const generateVideoSchema = {
  model: z.string().describe('生视频模型 id 或别名，如 dreamina-seedance-2-0 / kw-video-v2 / kling-v3-pro / veo3.1-fast-sp'),
  content: z.array(z.any()).max(16).describe('文生视频/图生视频内容数组（可含 text、image_url、video_url、image 等条目）').optional(),
  prompt: z.string().max(100_000).describe('文本提示词（kling/veo/sora 家族用 prompt；wan/dashscope 用 input.prompt）').optional(),
  input: z.any().describe('DashScope 风格 input 对象（wan2.7 等）').optional(),
  ratio: z.string().optional().describe('如 16:9、9:16、adaptive'),
  duration: z.number().int().min(1).max(60).optional().describe('秒'),
  resolution: z.string().optional().describe('如 480p/720p/1080p/4k'),
  watermark: z.boolean().optional(),
  generate_audio: z.boolean().optional(),
  explicit: z.boolean().optional(),
};

const getVideoSchema = {
  id: z.string().describe('视频/任务 id'),
  model: z.string().optional().describe('提交时的模型 id（用于确定用哪个查询端点轮询）'),
};

export function registerVideo(
  server: { tool: ToolRegistrar },
  registry: ModelRegistry,
  client: () => KwjmClient
) {
  server.tool(
    'generate_video',
    '文/图/参考生视频：提交异步任务并返回任务 id（真实端点随模型族分派）。',
    generateVideoSchema,
    async (args) => {
      const guard = guardModel(registry, args.model, { explicit: args.explicit });
      if (!guard.ok) return guard.payload;
      const { model } = guard;
      if (model.modality !== 'video') {
        return toTextContent({ error: `「${model.id}」是 ${model.modality} 模型，不适用视频生成。` }, true);
      }
      const ep = pickSubmitEndpoint(model, args);
      const payload = buildVideoPayload(model, args, ep);

      // 前置校验能力边界：越界时主动拦截并给修正建议
      const chk = checkConstraints(model, payload);
      if (!chk.pass) {
        return toTextContent({
          blocked: true,
          model: model.id,
          message: '请求超出模型能力边界，已拦截。请按 violations 修正后再调用（或改用 suggest_model 推荐模型）。',
          violations: chk.violations,
        }, true);
      }

      try {
        const data = await client().post(ep.path, payload);
        // 提取任务 id：不同端点返回结构不同
        const taskId = extractTaskId(data);
        return toTextContent({
          id: model.id,
          resolvedFrom: guard.resolvedFrom,
          endpoint: ep.path,
          queryPath: ep.queryPath,
          taskId,
          task: data,
          note: ep.async && ep.queryPath
            ? `请用 get_video_result 传入 model=${model.id} 与 task id 轮询生成结果。`
            : '请查看返回中的结果或进度。',
        });
      } catch (err) {
        return asToolError(err);
      }
    }
  );

  server.tool(
    'get_video_result',
    '轮询视频/图像任务结果。queryPath 随模型族不同（seedance/dreamina/kling/wan/MiniMax/veo 各有专属查询端点）。',
    getVideoSchema,
    async (args) => {
      let queryPath = `/v1/videos/generations/${encodeURIComponent(args.id)}`;
      if (args.model) {
        const cap = registry.byRealId(args.model);
        if (cap) {
          const qp = findQueryPath(cap);
          if (qp) queryPath = qp.replace('{id}', encodeURIComponent(args.id)).replace('{task_id}', encodeURIComponent(args.id)).replace('{taskId}', encodeURIComponent(args.id));
        }
      }
      try {
        const data = await client().get(queryPath);
        return toTextContent({ taskId: args.id, queryPath, result: data });
      } catch (err) {
        return asToolError(err);
      }
    }
  );
}

/** 选取提交端点：取模型首个异步 POST 端点，否则首个端点 */
function pickSubmitEndpoint(model: ModelCapability, args?: any): EndpointSpec {
  if (model.family === 'kling' && Array.isArray(args?.content)) {
    const hasVideo = args.content.some((item: any) => item?.video_url || item?.video);
    if (hasVideo) {
      const video = model.endpoints.find((endpoint) => endpoint.path.includes('/video2video'));
      if (video) return video;
    }
    const hasImage = args.content.some((item: any) => item?.image_url || item?.image);
    if (hasImage) {
      const image = model.endpoints.find((endpoint) => endpoint.path.includes('/image2video'));
      if (image) return image;
    }
  }
  const asyncEp = model.endpoints.find((e) => e.async && e.method === 'POST');
  return asyncEp ?? model.endpoints.find((e) => e.method === 'POST') ?? model.endpoints[0];
}

function findQueryPath(model: ModelCapability): string | undefined {
  for (const e of model.endpoints) {
    if (e.queryPath) return e.queryPath;
  }
  return undefined;
}

/** 按模型族构造请求体（不同端点协议不同） */
function buildVideoPayload(model: ModelCapability, args: any, ep: EndpointSpec): Record<string, unknown> {
  const family = model.family;

  // kling 家族：prompt + image/video 等扁平参数
  if (family === 'kling') {
    const p: Record<string, unknown> = { model: model.id, prompt: args.prompt ?? '' };
    if (args.ratio) p.aspect_ratio = args.ratio;
    if (args.duration) p.duration = args.duration;
    if (args.content) {
      for (const item of args.content) {
        if (item?.image_url) p.image = item.image_url.url ?? item.image_url;
        if (item?.video_url) p.video = item.video_url.url ?? item.video_url;
        if (item?.image) p.image = item.image;
      }
    }
    return p;
  }

  // veo / sora-sp / sora2：prompt + images + size/duration
  if (family === 'google' && (model.family === 'google')) {
    const p: Record<string, unknown> = { model: model.id, prompt: args.prompt ?? args.content?.[0]?.text ?? '' };
    if (args.duration) p.duration = args.duration; else if (args.duration) p.seconds = args.duration;
    if (args.ratio) p.aspect_ratio = args.ratio;
    if (args.content) {
      const imgs = args.content.filter((c: any) => c?.image_url || c?.image).map((c: any) => c?.image_url?.url ?? c?.image);
      if (imgs.length) p.images = imgs;
    }
    return p;
  }

  // wan / dashscope 原生：input + parameters 结构
  if (ep.path.includes('/api/v1/services/aigc/')) {
    const p: Record<string, unknown> = { model: model.id, input: args.input ?? { prompt: args.prompt } };
    const parameters: Record<string, unknown> = {};
    if (args.resolution) parameters.resolution = args.resolution;
    if (args.ratio) parameters.ratio = args.ratio;
    if (args.duration) parameters.duration = args.duration;
    if (Object.keys(parameters).length) p.parameters = parameters;
    return p;
  }

  // 默认（seedance/dreamina/MiniMax）：content 数组 + ratio/duration/resolution
  const p: Record<string, unknown> = { model: model.id, content: args.content ?? [{ type: 'text', text: args.prompt ?? '' }] };
  if (args.ratio) p.ratio = args.ratio;
  if (args.duration) p.duration = args.duration;
  if (args.resolution) p.resolution = args.resolution;
  if (args.watermark !== undefined) p.watermark = args.watermark;
  if (args.generate_audio !== undefined) p.generate_audio = args.generate_audio;
  return p;
}

/** 从各种返回结构中提取任务 id */
function extractTaskId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, any>;
  if (typeof d.id === 'string') return d.id;
  if (typeof d.task_id === 'string') return d.task_id;
  if (d.task && typeof d.task === 'object' && typeof d.task.id === 'string') return d.task.id;
  if (d.data && typeof d.data === 'object' && typeof d.data.id === 'string') return d.data.id;
  if (d.output && typeof d.output === 'object' && typeof d.output.task_id === 'string') return d.output.task_id;
  return undefined;
}
