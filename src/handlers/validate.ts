import type { ModelRegistry } from '../core/registry.js';
import type { Constraints, ModelCapability } from '../core/types.js';

/** 单条越界诊断 */
export interface Violation {
  field: string;
  message: string;
  /** 修正建议（枚举给出允许值等） */
  fix?: string;
}

/**
 * 前置校验：在真正调用前，检查用户输入是否超出模型能力边界（必然报错的失衡）。
 * 返回 violations（越界明细）与 pass（是否可放行）。
 * 供 Agent 主动提醒 / 引导选择 / 拦截。
 */
export function checkConstraints(model: ModelCapability, input: Record<string, unknown>): { pass: boolean; violations: Violation[] } {
  const c = model.constraints;
  if (!c) return { pass: true, violations: [] };
  const violations: Violation[] = [];

  // 1) 参考图数量上限
  const refCount = countReferences(input);
  if (c.maxReferenceImages !== undefined && refCount.images > c.maxReferenceImages) {
    violations.push({
      field: 'images',
      message: `参考图数量 ${refCount.images} 超出上限 ${c.maxReferenceImages}。`,
      fix: `请将参考图压缩到 ≤${c.maxReferenceImages} 张，或改用支持更多参考图的模型（如 gpt-image-2-gp ≤16）。`,
    });
  }
  if (c.maxReferenceVideos !== undefined && refCount.videos > c.maxReferenceVideos) {
    violations.push({
      field: 'videos',
      message: `参考视频数量 ${refCount.videos} 超出上限 ${c.maxReferenceVideos}。`,
      fix: `请将参考视频压缩到 ≤${c.maxReferenceVideos} 个。`,
    });
  }

  // 2) 枚举类约束：size / resolution / ratio / duration / quality / outputFormat
  const enumChecks: { field: string; allowed: Constraints[keyof Constraints] | undefined; value: unknown; map: (v: unknown) => string | undefined }[] = [
    { field: 'size', allowed: c.size, value: input.size ?? input.resolution ?? input.output_format, map: pickString },
    { field: 'resolution', allowed: c.resolution, value: input.resolution, map: pickString },
    { field: 'ratio', allowed: c.ratio, value: input.ratio ?? input.aspect_ratio, map: pickString },
    { field: 'duration', allowed: c.duration, value: input.duration ?? input.seconds, map: pickString },
    { field: 'quality', allowed: c.quality, value: input.quality, map: pickString },
    { field: 'output_format', allowed: c.outputFormat, value: input.output_format ?? input.outputFormat, map: pickString },
  ];
  for (const chk of enumChecks) {
    if (chk.allowed === undefined || !Array.isArray(chk.allowed)) continue;
    const v = chk.map(chk.value);
    if (v === undefined) continue;
    // normalization: 大小写不敏感比对，但保留原始词便于提示
    if (!chk.allowed.some((a) => String(a).toLowerCase() === v.toLowerCase())) {
      violations.push({
        field: chk.field,
        message: `「${chk.field}=${v}」不在允许范围内。`,
        fix: `允许值：${chk.allowed.join(' / ')}。`,
      });
    }
  }

  // 3) 时长范围（min/max）
  const durRange = c.duration && !Array.isArray(c.duration) ? c.duration : undefined;
  if (durRange && (durRange.min !== undefined || durRange.max !== undefined)) {
    const d = Number(input.duration ?? input.seconds);
    if (!Number.isNaN(d)) {
      if (durRange.min !== undefined && d < durRange.min) violations.push({ field: 'duration', message: `时长 ${d} 低于最小 ${durRange.min}s。`, fix: `最短 ${durRange.min}s。` });
      if (durRange.max !== undefined && d > durRange.max) violations.push({ field: 'duration', message: `时长 ${d} 超过最大 ${durRange.max}s。`, fix: `最长 ${durRange.max}s。` });
    }
  }

  // 4) 必现硬错误（如不可单独音频）
  if (c.hardFail && c.hardFail.length) {
    for (const h of c.hardFail) {
      if (h.includes('不可单独输入音频') && !(refCount.audios > 0 && refCount.images === 0 && refCount.videos === 0)) {
        continue;
      }
      violations.push({ field: 'hardFail', message: h, fix: '请按模型要求调整输入结构后再调用。' });
    }
  }

  return { pass: violations.length === 0, violations };
}

interface RefCount {
  images: number;
  videos: number;
  audios: number;
}

/** 从用户输入统计参考图/视频/音频数量 */
function countReferences(input: Record<string, unknown>): RefCount {
  let images = 0;
  let videos = 0;
  let audios = 0;

  const imagesArr = asArray(input.images);
  const content = asArray(input.content);
  const imageRef = asArray((input as any).image);

  images += imagesArr.length;
  images += imageRef.length;

  for (const item of content) {
    if (item && typeof item === 'object') {
      const t = (item as any).type ?? '';
      if (/image/.test(String(t))) images += 1;
      if (/video/.test(String(t))) videos += 1;
      if (/audio/.test(String(t))) audios += 1;
      if ((item as any).image_url) images += 1;
      if ((item as any).video_url) videos += 1;
    }
  }

  // 多模态 reference 结构（kw-video-v2 / dreamina：reference 组）
  const ref = (input as any).reference ?? (input as any).reference_images ?? (input as any).reference_videos;
  if (Array.isArray(ref)) {
    for (const r of ref) {
      if (r && typeof r === 'object') {
        if ((r as any).type === 'image' || (r as any).image_url) images += 1;
        if ((r as any).type === 'video' || (r as any).video_url) videos += 1;
        if ((r as any).type === 'audio' || (r as any).audio_url) audios += 1;
      }
    }
  }

  return { images, videos, audios };
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

function pickString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && typeof (v as any).url === 'string') return (v as any).url;
  return undefined;
}

/** 便捷：校验并产出对 Agent 友好的一次性结果 */
export function validateForModel(registry: ModelRegistry, modelInput: string, args: Record<string, unknown>): {
  pass: boolean;
  model?: string;
  resolvedFrom?: string;
  violations?: Violation[];
  hint?: string;
} {
  const r = registry.resolve(modelInput);
  if (r.status === 'not-found') return { pass: false, violations: [{ field: 'model', message: `未找到模型「${modelInput}」。`, fix: '请用 list_models 查看，或 refresh_models 拉取实时。' }] };
  if (r.status === 'ambiguous') {
    return {
      pass: false,
      violations: [{ field: 'model', message: `模型「${modelInput}」有歧义。`, fix: `候选：${r.candidates.map((c) => c.id).join(' / ')}` }],
    };
  }
  const model = r.model;
  const res = checkConstraints(model, args);
  return {
    pass: res.pass,
    model: model.id,
    resolvedFrom: r.resolvedFrom,
    violations: res.violations,
    hint: res.pass ? undefined : '调用前请先按 fix 修正输入；如无法满足，可改用 suggest_model 推荐的默认/备选模型。',
  };
}
