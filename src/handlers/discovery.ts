import { z } from 'zod';
import type { ModelRegistry } from '../core/registry.js';
import type { KwjmClient } from '../core/client.js';
import { toTextContent, type ToolRegistrar } from './result.js';
import { validateForModel } from './validate.js';
import { OPERATIONS } from '../core/operations.js';

const listModelsSchema = {
  modality: z.enum(['text', 'image', 'video']).optional().describe('按功能大类过滤'),
  family: z.string().optional().describe('按模型族过滤，如 openai / seedance / deepseek / qwen / kling'),
};

const capSchema = {
  model: z.string().describe('模型 id 或别名，如 gpt-5.2-pro-2025-12-11 或 kw-video-v2'),
};

const refreshSchema = {};

const suggestSchema = {
  task: z.string().optional().describe('任务描述，如「帮我生成一段产品宣传视频」「写一段文案」「画一张图」'),
  modality: z.enum(['text', 'image', 'video']).optional().describe('显式指定功能大类，缺省则由 task 关键词推断'),
};

/** 发现类工具：list_models / get_model_capabilities / refresh_models */
export function registerDiscovery(server: { tool: ToolRegistrar }, registry: ModelRegistry, client: () => KwjmClient) {
  server.tool(
    'list_models',
    '列出平台全部模型及其能力元数据（modality/家族/选择层级/别名），便于 Agent 先看能力边界再选用。',
    listModelsSchema,
    async (args: { modality?: string; family?: string }) => {
      let list = registry.all();
      if (args.modality) list = list.filter((c) => c.modality === args.modality);
      if (args.family) list = list.filter((c) => c.family === args.family);
      list.sort((a, b) => {
        const mod = a.modality.localeCompare(b.modality);
        return mod !== 0 ? mod : a.id.localeCompare(b.id);
      });

      const summary = list.map((c) => ({
        id: c.id,
        family: c.family,
        modality: c.modality,
        endpoints: c.endpoints.map((e) => ({
          path: e.path,
          method: e.method,
          async: e.async,
          queryPath: e.queryPath,
          statusEnum: e.statusEnum,
        })),
        selectionLevel: c.selectionLevel,
        defaultFor: c.defaultFor,
        aliases: registry.aliasesOfReal(c.id),
        ambiguous: c.ambiguous ?? false,
        costTier: c.costTier,
        contextWindow: c.contextWindow,
        params: c.params,
        notes: c.notes,
      }));

      const counts = {
        text: registry.byModality('text').length,
        image: registry.byModality('image').length,
        video: registry.byModality('video').length,
      };

      const hints: string[] = [];
      hints.push(`默认首选：文本=${registry.defaultForModality('text')?.id ?? '-'}，图像=${registry.defaultForModality('image')?.id ?? '-'}，视频=${registry.defaultForModality('video')?.id ?? '-'}`);
      hints.push('选择层级：default=同类任务优先；fallback=备选；off-by-default=非指明不调用（仅显式指名）。');
      hints.push('歧义提示：对应 ambiguous=true 的模型，调用时若入参未唯一确定会返回候选清单，请确认后再调用。');

      return toTextContent({
        total: summary.length,
        counts,
        selection: hints,
        models: summary,
      });
    }
  );

  server.tool(
    'get_model_capabilities',
    '查看单个模型的完整能力边界：端点、层级、别名指向、上下文与备注。',
    capSchema,
    async (args: { model: string }) => {
      const r = registry.resolve(args.model);
      if (r.status === 'not-found') {
        return toTextContent({ error: `未找到模型「${args.model}」。可用 list_models 查看全部；或 refresh_models 拉取实时列表。` }, r.status === 'not-found');
      }
      if (r.status === 'ambiguous') {
        return toTextContent({
          ambiguous: true,
          keyword: r.keyword,
          candidates: r.candidates.map((c) => ({ id: c.id, family: c.family, selectionLevel: c.selectionLevel, aliases: registry.aliasesOfReal(c.id) })),
          recommended: r.recommended
            ? { id: r.recommended.id, family: r.recommended.family, selectionLevel: r.recommended.selectionLevel, aliases: registry.aliasesOfReal(r.recommended.id) }
            : undefined,
          requiresUserConfirmation: r.requiresUserConfirmation,
          message: r.message,
        });
      }
      const c = r.model;
      return toTextContent({
        id: c.id,
        resolvedFrom: r.resolvedFrom,
        family: c.family,
        modality: c.modality,
        endpoints: c.endpoints.map((e) => ({
          path: e.path,
          method: e.method,
          async: e.async,
          queryPath: e.queryPath,
          statusEnum: e.statusEnum,
          returnFields: e.returnFields,
        })),
        selectionLevel: c.selectionLevel,
        defaultFor: c.defaultFor,
        aliases: registry.aliasesOfReal(c.id),
        ambiguous: c.ambiguous ?? false,
        contextWindow: c.contextWindow,
        costTier: c.costTier,
        params: c.params,
        notes: c.notes,
      });
    }
  );

  server.tool(
    'refresh_models',
    '调用平台 /v1/models 拉取当前可用模型，实时合并进能力表；未知模型标记为非指明不调用。',
    refreshSchema,
    async () => {
      const live = (await client().get(OPERATIONS.models)) as { data?: { id: string; object?: string; owned_by?: string }[] };
      const entries = Array.isArray(live) ? live : live?.data ?? [];
      const { added, known } = registry.mergeLive(entries);
      return toTextContent({
        refreshed: true,
        known,
        newlyAdded: added,
        count: entries.length,
      });
    }
  );

  server.tool(
    'suggest_model',
    '按任务/模态给出模型选择建议：默认首选 + 备选 + 非指明不调用，并按优先级规律（文本能力补位、图像只推最新、视频可选能力）给出引导，供 Agent 决策。',
    suggestSchema,
    async (args: { task?: string; modality?: string }) => {
      const modality = inferModality(args.modality, args.task);
      const def = registry.defaultForModality(modality);
      const fallback = registry.fallbackForModality(modality);
      const offByDefault = registry.offByDefaultForModality(modality);
      const ambiguous = registry.byModality(modality).filter((c) => c.ambiguous);

      // 各模态差异化引导
      const guidance: string[] = [];
      if (modality === 'text') {
        guidance.push('【先判断是否需要】Agent 自身通常已有默认文本模型驱动工作；只有当当前模型缺失必要能力（如图片识别、视频理解等多模态）时，才用 MCP 换模型补上。');
        guidance.push('如需多模态能力：从下方 fallback 里选带多模态的模型接手；任务完成后请恢复到 Agent 默认模型，不长期占用。');
      } else if (modality === 'image') {
        guidance.push('【只推最新版】版本越高能力越强，原则上只推荐最新版本；下方 fallback 已按此过滤旧版。');
        guidance.push('【首次使用需用户选择】首次生图时请让用户选择模型，而非直接默认（不同分支差异见各自 notes/constraints）。');
      } else if (modality === 'video') {
        guidance.push('【视频是可选能力】视频生成并非核心路径，属于可选增强，按需使用。');
        guidance.push('【只留最新两版】同家族只保留最新两版，太旧的已排除。');
        guidance.push('【Seedance 2.0 语义】用户要求 Seedance 2.0 时，候选是 kw-video-v2 / kw-video-v2-fast / kw-video-v2-mini；最匹配 kw-video-v2，但需让用户确认后再调用。');
        guidance.push('【Seedance 2.5 语义】用户要求 Seedance 2.5 时，即映射为 kw-video-v2.5。');
        guidance.push('【MiniMax-H3 可平替】MiniMax-H3 在部分场景可平替 Seedance 2.0，可作为备选。');
      }
      guidance.push(`同类「${modality}」任务：优先使用默认首选 ${def?.id ?? '（无默认）'}，无需每次问询。`);
      guidance.push('非指明不调用：以下模型仅当用户明确指名（explicit: true）才可调用，绝不默认触碰。');

      return toTextContent({
        inferredModality: modality,
        guidance,
        recommended: {
          default: brief(def),
          fallback: fallback.map(brief),
        },
        doNotCallUnlessExplicit: offByDefault.map(brief),
        ambiguous: ambiguous.length
          ? {
              hint: '以下模型存在版本/同名歧义，命名不唯一时需先确认候选后再调用。',
              models: ambiguous.map((c) => ({
                id: c.id,
                aliases: registry.aliasesOfReal(c.id),
                family: c.family,
              })),
            }
          : undefined,
      });
    }
  );

  server.tool(
    'validate_request',
    '调用前前置校验：检查用户输入是否超出模型能力边界（参考图数量、尺寸/分辨率/比例/时长枚举、必现错误），返回越界明细与修正建议，供 Agent 主动提醒/引导/拦截。',
    {
      model: z.string().describe('目标模型 id 或别名'),
      args: z.record(z.string(), z.any()).describe('即将提交的请求参数（content/images/size/resolution/ratio/duration/quality 等）'),
    },
    async (a: { model: string; args: Record<string, unknown> }) => {
      const res = validateForModel(registry, a.model, a.args ?? {});
      return toTextContent(res, !res.pass);
    }
  );
}

/** 从任务描述推断功能大类 */
function inferModality(modality?: string, task?: string): 'text' | 'image' | 'video' {
  if (modality === 'text' || modality === 'image' || modality === 'video') return modality;
  const t = (task ?? '').toLowerCase();
  if (/视频|video|动画|生成片|宣传片|短片/.test(t)) return 'video';
  if (/图|image|画|插画|海报|照片|图片/.test(t)) return 'image';
  if (/视频/.test(t)) return 'video';
  return 'text'; // 缺省视为文本
}

function brief(c?: { id: string; family: string; notes?: string; costTier?: string }): unknown {
  if (!c) return null;
  return { id: c.id, family: c.family, costTier: c.costTier, notes: c.notes };
}
