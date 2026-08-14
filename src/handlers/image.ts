import { z } from 'zod';
import type { ModelRegistry } from '../core/registry.js';
import type { KwjmClient } from '../core/client.js';
import type { EndpointSpec, ModelCapability } from '../core/types.js';
import { asToolError, toTextContent, type ToolRegistrar } from './result.js';
import { guardModel } from './guard.js';
import { checkConstraints } from './validate.js';
import { OPERATIONS } from '../core/operations.js';

const MAX_IMAGE_EDIT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_EDIT_BASE64_CHARS = Math.ceil(MAX_IMAGE_EDIT_BYTES / 3) * 4;

const generateImageSchema = {
  model: z.string().describe('生图模型 id 或别名，如 gpt-image-2 / doubao-seedream-5-0-lite / qwen-image-2.7 / gpt-image-2-gp'),
  prompt: z.string().max(100_000).describe('生成提示词').optional(),
  input: z.any().describe('DashScope 风格 input（qwen/wan 生图）').optional(),
  size: z.string().optional().describe('如 1024x1024、2K、4K'),
  quality: z.string().optional().describe('如 low / medium / high / auto'),
  aspect_ratio: z.string().optional().describe('宽高比，如 1:1、16:9'),
  n: z.number().int().min(1).max(4).optional(),
  images: z.array(z.any()).max(32).optional().describe('参考图片列表（具体模型上限由能力预检进一步收紧）'),
  explicit: z.boolean().optional(),
};

const editImageSchema = {
  model: z.string().describe('生图模型 id 或别名'),
  prompt: z.string().max(100_000),
  image: z
    .string()
    .max(MAX_IMAGE_EDIT_BASE64_CHARS + 32)
    .describe('待编辑图片的 base64 data URL；最大解码后 10 MiB，官方端点要求 multipart 文件'),
  size: z.string().optional(),
  quality: z.string().optional(),
  n: z.number().int().min(1).max(10).optional(),
  explicit: z.boolean().optional(),
};

export function registerImage(
  server: { tool: ToolRegistrar },
  registry: ModelRegistry,
  client: () => KwjmClient
) {
  server.tool(
    'generate_image',
    '文生图/图生图（端点随模型族分派：openai→/v1/images/generations、-gp→/v1/images/generations/tasks 异步、qwen/wan→DashScope、gemini→generateContent）。',
    generateImageSchema,
    async (args) => {
      const guard = guardModel(registry, args.model, { explicit: args.explicit });
      if (!guard.ok) return guard.payload;
      const { model } = guard;
      if (model.modality !== 'image') {
        return toTextContent({ error: `「${model.id}」是 ${model.modality} 模型，不适用图像生成。` }, true);
      }
      const ep = pickImageEndpoint(model);
      const payload = buildImagePayload(model, args);

      // 前置校验能力边界：越界时主动拦截并给修正建议（不实际发起请求）
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
        const taskId = extractTaskId(data);
        return toTextContent({
          id: model.id,
          resolvedFrom: guard.resolvedFrom,
          endpoint: ep.path,
          queryPath: ep.queryPath,
          taskId,
          result: data,
          note: ep.async && ep.queryPath ? `请用 get_video_result（或按 queryPath）轮询任务 ${taskId}。` : undefined,
        });
      } catch (err) {
        return asToolError(err);
      }
    }
  );

  server.tool(
    'edit_image',
    '图生图 / 图像编辑（/v1/images/edits）。',
    editImageSchema,
    async (args) => {
      const guard = guardModel(registry, args.model, { explicit: args.explicit });
      if (!guard.ok) return guard.payload;
      const { model } = guard;
      if (model.modality !== 'image') {
        return toTextContent({ error: `「${model.id}」是 ${model.modality} 模型，不适用图像编辑。` }, true);
      }
      try {
        const form = buildImageEditForm({
          model: model.id,
          prompt: args.prompt,
          image: args.image,
          size: args.size,
          quality: args.quality,
          n: args.n,
        });
        const data = await client().postForm(OPERATIONS.imageEdits, form);
        return toTextContent({ id: model.id, resolvedFrom: guard.resolvedFrom, result: data });
      } catch (err) {
        return asToolError(err);
      }
    }
  );
}

function buildImageEditForm(args: {
  model: string;
  prompt: string;
  image: string;
  size?: string;
  quality?: string;
  n?: number;
}): FormData {
  const parsed = parseImageDataUrl(args.image);
  const form = new FormData();
  form.append('model', args.model);
  form.append('prompt', args.prompt);
  form.append('image[]', new Blob([parsed.bytes], { type: parsed.mime }), `input.${parsed.extension}`);
  if (args.size !== undefined) form.append('size', args.size);
  if (args.quality !== undefined) form.append('quality', args.quality);
  if (args.n !== undefined) form.append('n', String(args.n));
  return form;
}

function parseImageDataUrl(value: string): { bytes: Uint8Array; mime: string; extension: string } {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match) {
    throw new Error('图片编辑要求 image 为 png/jpeg/webp 的 base64 data URL；请先下载远程图片并转换后重试。');
  }
  if (match[2].length > MAX_IMAGE_EDIT_BASE64_CHARS) {
    throw new Error('图片 data URL 解码后不得超过 10 MiB。');
  }
  const mime = match[1].toLowerCase();
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0) throw new Error('图片 data URL 内容为空。');
  if (bytes.length > MAX_IMAGE_EDIT_BYTES) throw new Error('图片 data URL 解码后不得超过 10 MiB。');
  const extension = mime === 'image/jpeg' ? 'jpg' : mime.slice('image/'.length);
  return { bytes, mime, extension };
}

function pickImageEndpoint(model: ModelCapability): EndpointSpec {
  const asyncEp = model.endpoints.find((e) => e.async && e.method === 'POST');
  return asyncEp ?? model.endpoints.find((e) => e.method === 'POST') ?? model.endpoints[0];
}

function buildImagePayload(model: ModelCapability, args: any): Record<string, unknown> {
  const family = model.family;

  // qwen / wan 生图：DashScope input 结构
  if ((family === 'qwen') && model.id.startsWith('wan')) {
    return {
      model: model.id,
      input: args.input ?? { messages: [{ role: 'user', content: [{ text: args.prompt }] }] },
    };
  }
  if (family === 'qwen') {
    const p: Record<string, unknown> = { model: model.id };
    if (args.input) p.input = args.input;
    else p.input = { messages: [{ role: 'user', content: [{ text: args.prompt }] }] };
    if (args.size) p.size = args.size;
    return p;
  }

  // gemini 原生：contents 结构
  if (family === 'google') {
    return { contents: args.input ?? [{ parts: [{ text: args.prompt }] }] };
  }

  // openai / seedream / kling 等扁平结构
  const p: Record<string, unknown> = { model: model.id, prompt: args.prompt ?? '' };
  if (args.size !== undefined) p.size = args.size;
  if (args.quality !== undefined) p.quality = args.quality;
  if (args.aspect_ratio !== undefined) p.aspect_ratio = args.aspect_ratio;
  if (args.n !== undefined) p.n = args.n;
  if (args.images !== undefined) p.images = args.images;
  return p;
}

function extractTaskId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, any>;
  if (typeof d.task_id === 'string') return d.task_id;
  if (typeof d.id === 'string') return d.id;
  if (d.request_id && typeof d.request_id === 'string') return d.request_id;
  if (typeof d.requestId === 'string') return d.requestId;
  return undefined;
}
