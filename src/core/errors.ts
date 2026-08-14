/**
 * 错误码 → 问题性质 / 解释 / 下一步引导 的映射。
 * 内化自开物基模 API 文档「公共错误代码」段（401/403/429/500/503）与各端点补充的错误码。
 *
 * 目标：让 Agent 不只回传冰冷的状态码，而是能「说人话」——用普通人能听懂的话，
 * 向用户解释「现在到底发生了什么、为什么会这样、该怎么解决」。
 * 每个错误同时给出：原版错误码/含义（保留技术准确性）+ plain（通俗翻译，避免技术腔）。
 */

export interface ErrorExplanation {
  /** 问题性质（简短标签，如「认证失败」「余额不足」「限流」） */
  nature: string;
  /** 原版技术含义（保留平台文档口径） */
  explanation: string;
  /** 说人话：普通人能听懂的通俗解释 */
  plain: string;
  /** 下一步操作引导（讲人话） */
  nextStep: string;
  /** 是否可重试 */
  retryable: boolean;
}

const CODE_MAP: Record<string, ErrorExplanation> = {
  invalid_api_key: {
    nature: '密钥无效',
    explanation: 'API Key 错误或已过期。',
    plain: '你填的那串密钥（相当于登录密码）不对，要么复制少了，要么已经过期了。',
    nextStep: '去平台「控制台 → API令牌」重新复制一份最新密钥，替换掉原来的 KWJM_API_KEY 就行。',
    retryable: false,
  },
  unauthorized: {
    nature: '密钥无效',
    explanation: 'API key 缺失或无效。',
    plain: '系统没认出来你是谁——密钥没填，或者填错了。',
    nextStep: '确认已经填写 KWJM_API_KEY，并且内容是完整正确的。',
    retryable: false,
  },
  rate_limit_exceeded: {
    nature: '请求太快了',
    explanation: '请求频率过高，被限流。',
    plain: '你发得太频繁，服务端暂时挡了一下，让它喘口气。',
    nextStep: '稍等一会儿再重试，或者放慢一点节奏、别一口气发太多。',
    retryable: true,
  },
  insufficient_quota: {
    nature: '额度花完了',
    explanation: '账户余额不足或无可用资源包。',
    plain: '账户里的钱（或赠送额度）用光了，暂时没得用了。',
    nextStep: '去平台充值或买一个资源包，充完就能继续用。',
    retryable: false,
  },
  server_error: {
    nature: '服务端出错',
    explanation: '服务器内部错误。',
    plain: '是平台那边自己出了点问题，不是你的操作不对。',
    nextStep: '稍后重试；如果一直这样，找平台客服帮忙看看。',
    retryable: true,
  },
};

const STATUS_MAP: Record<number, ErrorExplanation> = {
  400: {
    nature: '请求格式不对',
    explanation: '请求参数或内容不符合要求。',
    plain: '你给的信息有地方不符合要求（比如尺寸、时长、图片数量超了上限）。',
    nextStep: '可以用 validate_request 先检查参数是否在允许范围，改对了再发。',
    retryable: false,
  },
  401: {
    nature: '密钥无效',
    explanation: 'API key 缺失或无效（未授权）。',
    plain: '系统没认出来你是谁——密钥没填、填错、或过期了。',
    nextStep: '去平台「控制台 → API令牌」复制最新密钥，更新 KWJM_API_KEY 再试。',
    retryable: false,
  },
  403: {
    nature: '没权限或没钱了',
    explanation: 'API key 没有权限访问此资源，或账户余额不足。',
    plain: '要么你这个密钥没开通这个模型的权限，要么账户里没钱（额度用完了）。',
    nextStep: '确认密钥有对应模型权限；如果是余额问题，去充值或买资源包。',
    retryable: false,
  },
  429: {
    nature: '请求太快了',
    explanation: '请求频率/速率超过限制。',
    plain: '你发得太频繁，服务端暂时挡了一下，等它缓缓。',
    nextStep: '稍等一会儿再重试，别一口气发太多。',
    retryable: true,
  },
  500: {
    nature: '服务端出错',
    explanation: '服务器内部错误。',
    plain: '是平台那边的问题，不是你的错。',
    nextStep: '稍后重试；还不行就联系平台支持。',
    retryable: true,
  },
  503: {
    nature: '内容被拦了',
    explanation: '内容因安全原因被阻止（平台实际返回 400）。',
    plain: '你提交的内容触发了安全规则，被平台拦下来了，不是报错 bug。',
    nextStep: '改一下提示词或输入内容，避开敏感/不安全的内容再试。',
    retryable: false,
  },
};

/** 根据 HTTP 状态码 + 可选业务 code 解析出结构化解释 */
export function resolveError(status: number, code?: string): ErrorExplanation {
  if (code) {
    const c = CODE_MAP[String(code).toLowerCase()];
    if (c) return c;
  }
  const s = STATUS_MAP[status];
  if (s) return s;
  if (status >= 500) {
    return { nature: '服务端出错', explanation: `服务端错误（HTTP ${status}）。`, plain: '平台那边出了问题，不是你的错。', nextStep: '稍后重试；还不行就联系平台支持。', retryable: true };
  }
  if (status >= 400) {
    return { nature: '请求被拒绝', explanation: `请求被拒绝（HTTP ${status}）。`, plain: '你的请求有地方不对，被服务端拒绝了。', nextStep: '检查参数或输入内容后重试。', retryable: false };
  }
  return { nature: '未知错误', explanation: `未知错误（HTTP ${status}）。`, plain: '遇到一个没预料到的错误。', nextStep: '查看原始错误信息，或联系平台支持。', retryable: false };
}
