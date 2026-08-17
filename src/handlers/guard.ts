import type { ModelRegistry } from '../core/registry.js';
import type { ModelCapability } from '../core/types.js';
import { toTextContent, type ToolResult } from './result.js';

export type GuardResult =
  | { ok: true; model: ModelCapability; resolvedFrom?: string }
  | { ok: false; payload: ToolResult };

/**
 * 生成类工具共用守卫：在调用前校验模型并强制执行「防误判」规则。
 * - 未命中 → not-found 错误。
 * - 歧义（多候选）→ 返回候选清单（问询）。
 * - 命中 off-by-default（非指明不调用）且未显式 allow → 提示不可用。
 */
export function guardModel(
  registry: ModelRegistry,
  modelInput: string,
  opts: { explicit?: boolean } = {}
): GuardResult {
  const r = registry.resolve(modelInput);
  if (r.status === 'not-found') {
    return {
      ok: false,
      payload: toTextContent(
        { error: `未找到模型「${modelInput}」。可用 list_models 查看全部，或 refresh_models 拉取实时列表。` },
        true
      ),
    };
  }
  if (r.status === 'ambiguous') {
    return {
      ok: false,
      payload: toTextContent(
        {
          ambiguous: true,
          keyword: r.keyword,
          candidates: r.candidates.map((c) => ({
            id: c.id,
            family: c.family,
            modality: c.modality,
            selectionLevel: c.selectionLevel,
          })),
          recommended: r.recommended
            ? {
                id: r.recommended.id,
                family: r.recommended.family,
                modality: r.recommended.modality,
                selectionLevel: r.recommended.selectionLevel,
              }
            : undefined,
          requiresUserConfirmation: r.requiresUserConfirmation,
          message: r.message,
        },
        true
      ),
    };
  }
  const model = r.model;
  // 非指明不调用：除非用户确指（explicit），否则不触碰。
  if (model.selectionLevel === 'off-by-default' && !opts.explicit) {
    return {
      ok: false,
      payload: toTextContent(
        {
          error: `模型「${model.id}」（${model.selectionLevel}）属于「非指明不调用」类别，未获显式指名，不自动调用。`,
          hint: `如确需使用，请在入参中显式指定该模型 id，或改选默认/备选模型（${registry.defaultForModality(model.modality)?.id}）。`,
        },
        true
      ),
    };
  }
  return { ok: true, model, resolvedFrom: r.resolvedFrom };
}
