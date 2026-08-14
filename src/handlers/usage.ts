import { z } from 'zod';
import type { KwjmClient } from '../core/client.js';
import { OPERATIONS } from '../core/operations.js';
import { asToolError, toTextContent, type ToolRegistrar } from './result.js';

const reportDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export function registerUsage(
  server: { tool: ToolRegistrar },
  client: () => KwjmClient,
  currentApiKeyId: () => string
) {
  server.tool(
    'get_current_key_daily_cost',
    '查询当前 KWJM_API_KEY_ID 绑定成员的日结成本；日期缺省时由平台查询前一天。',
    { report_date: reportDate },
    async (args) => {
      const apiKeyId = currentApiKeyId().trim();
      if (!/^\d+$/.test(apiKeyId)) {
        return toTextContent({
          error: '查询当前 Key 日结成本需要配置数字型 KWJM_API_KEY_ID；系统不会根据名称或费用猜测当前 Key。',
        }, true);
      }
      try {
        const rows = await fetchDailyKeyRows(client(), args.report_date);
        const currentRows = rows.filter((row) => String(row.api_key_id) === apiKeyId);
        return toTextContent({
          scope: 'current_key',
          apiKeyId,
          reportDate: args.report_date ?? 'provider_previous_day_default',
          settled: currentRows.length > 0,
          rows: currentRows,
          totals: sumRows(currentRows),
          note: currentRows.length === 0 ? '该日期暂无当前 Key 的日结行；可能无消费或平台尚未完成日结。' : undefined,
        });
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.tool(
    'get_account_daily_costs',
    '显式查询同一账户全部 API Key 的日结成本。',
    { report_date: reportDate, all_keys: z.literal(true) },
    async (args) => {
      if (args.all_keys !== true) {
        return toTextContent({ error: '跨 Key 查询必须显式传入 all_keys=true。' }, true);
      }
      try {
        const rows = await fetchDailyKeyRows(client(), args.report_date);
        return toTextContent({
          scope: 'account_all_keys',
          reportDate: args.report_date ?? 'provider_previous_day_default',
          rows,
          totals: sumRows(rows),
        });
      } catch (error) {
        return asToolError(error);
      }
    }
  );

  server.tool(
    'get_wallet_balance',
    '查询当前 KWJM 账户钱包余额。',
    {},
    async () => {
      try {
        return toTextContent({ wallet: await client().get(OPERATIONS.wallet) });
      } catch (error) {
        return asToolError(error);
      }
    }
  );
}

async function fetchDailyKeyRows(client: KwjmClient, reportDate?: string): Promise<Record<string, unknown>[]> {
  const query = reportDate ? `?report_date=${encodeURIComponent(reportDate)}` : '';
  const data = await client.get(`${OPERATIONS.dailyCostsByKey}${query}`);
  if (!data || typeof data !== 'object') return [];
  const list = (data as { list?: unknown }).list;
  return Array.isArray(list) ? list.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : [];
}

interface DailyTotals {
  requestCount: number;
  amountOrigin: number;
  amount: number;
}

function sumRows(rows: Record<string, unknown>[]): DailyTotals {
  return rows.reduce<DailyTotals>(
    (total, row) => ({
      requestCount: total.requestCount + numberValue(row.request_count),
      amountOrigin: total.amountOrigin + numberValue(row.amount_origin),
      amount: total.amount + numberValue(row.amount),
    }),
    { requestCount: 0, amountOrigin: 0, amount: 0 }
  );
}

function numberValue(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}
