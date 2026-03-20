/**
 * Chinese PII Detector Router
 * 
 * Detects Chinese-specific PII patterns:
 * - 身份证号 (18位)
 * - 手机号 (11位)
 * - 银行卡号 (16-19位)
 * - 邮箱地址
 * - 中文地址
 * 
 * @author Contributor
 * @since 1.0.0
 */

import type { GuardClawRouter, RouterDecision, RouterContext } from '../types';

interface ChinesePIIRouterConfig {
  enabled: boolean;
  weight: number;
  options?: {
    detectIdCard?: boolean;
    detectPhone?: boolean;
    detectBankCard?: boolean;
    detectEmail?: boolean;
    detectAddress?: boolean;
  };
}

// 中国身份证号正则 (18位，含校验位)
const ID_CARD_PATTERN = /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g;

// 中国手机号正则 (11位，1开头，第2位3-9)
const PHONE_PATTERN = /(?<![\d])1[3-9]\d{9}(?![\d])/g;

// 银行卡号正则 (16-19位，常见银行前缀)
const BANK_CARD_PATTERN = /(?:62\d{14,17}|5[1-5]\d{14,17}|4\d{15,18}|3[47]\d{13,16}|\d{16,19})/g;

// 邮箱正则
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// 中文地址关键词
const ADDRESS_KEYWORDS = [
  '省', '市', '区', '县', '镇', '乡', '村', '街道', '路', '号',
  '楼', '单元', '室', '栋', '幢', '层', '邮编', '邮政编码'
];

// 中文地址正则 (包含上述关键词的连续文本)
const ADDRESS_PATTERN = new RegExp(
  `[${ADDRESS_KEYWORDS.join('')}]{2,}[^\\n]{5,50}`,
  'g'
);

/**
 * 验证身份证号校验位
 * @param idCard 18位身份证号
 * @returns 是否有效
 */
function validateIdCard(idCard: string): boolean {
  if (idCard.length !== 18) return false;
  
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
  
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    sum += parseInt(idCard[i]) * weights[i];
  }
  
  const checkCode = checkCodes[sum % 11];
  return idCard[17].toUpperCase() === checkCode;
}

/**
 * 验证银行卡号 (Luhn算法)
 * @param cardNo 银行卡号
 * @returns 是否可能有效
 */
function validateBankCard(cardNo: string): boolean {
  if (cardNo.length < 16 || cardNo.length > 19) return false;
  
  let sum = 0;
  let isEven = false;
  
  for (let i = cardNo.length - 1; i >= 0; i--) {
    let digit = parseInt(cardNo[i]);
    
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    
    sum += digit;
    isEven = !isEven;
  }
  
  return sum % 10 === 0;
}

/**
 * 检测文本中的中文 PII
 * @param text 输入文本
 * @param config 配置选项
 * @returns 检测到的 PII 列表
 */
function detectChinesePII(
  text: string,
  config: ChinesePIIRouterConfig['options'] = {}
): Array<{ type: string; value: string; validated: boolean }> {
  const {
    detectIdCard = true,
    detectPhone = true,
    detectBankCard = true,
    detectEmail = true,
    detectAddress = true,
  } = config;

  const findings: Array<{ type: string; value: string; validated: boolean }> = [];

  // 身份证号检测
  if (detectIdCard) {
    const idCards = text.match(ID_CARD_PATTERN) || [];
    for (const idCard of idCards) {
      findings.push({
        type: 'ID_CARD',
        value: idCard,
        validated: validateIdCard(idCard),
      });
    }
  }

  // 手机号检测
  if (detectPhone) {
    const phones = text.match(PHONE_PATTERN) || [];
    for (const phone of phones) {
      findings.push({
        type: 'PHONE',
        value: phone,
        validated: true,
      });
    }
  }

  // 银行卡号检测
  if (detectBankCard) {
    const bankCards = text.match(BANK_CARD_PATTERN) || [];
    for (const card of bankCards) {
      findings.push({
        type: 'BANK_CARD',
        value: card,
        validated: validateBankCard(card),
      });
    }
  }

  // 邮箱检测
  if (detectEmail) {
    const emails = text.match(EMAIL_PATTERN) || [];
    for (const email of emails) {
      findings.push({
        type: 'EMAIL',
        value: email,
        validated: true,
      });
    }
  }

  // 地址检测
  if (detectAddress) {
    const addresses = text.match(ADDRESS_PATTERN) || [];
    for (const address of addresses) {
      findings.push({
        type: 'ADDRESS',
        value: address,
        validated: false, // 地址无法简单验证
      });
    }
  }

  return findings;
}

/**
 * 脱敏处理
 * @param text 原始文本
 * @param findings 检测到的 PII
 * @returns 脱敏后的文本
 */
function desensitize(text: string, findings: Array<{ type: string; value: string }>): string {
  let result = text;
  
  // 按长度降序排序，避免短匹配干扰长匹配
  const sortedFindings = [...findings].sort((a, b) => b.value.length - a.value.length);
  
  for (const finding of sortedFindings) {
    let replacement: string;
    
    switch (finding.type) {
      case 'ID_CARD':
        // 身份证号：保留前6位和后4位
        replacement = finding.value.slice(0, 6) + '********' + finding.value.slice(-4);
        break;
      case 'PHONE':
        // 手机号：保留前3位和后4位
        replacement = finding.value.slice(0, 3) + '****' + finding.value.slice(-4);
        break;
      case 'BANK_CARD':
        // 银行卡号：保留前4位和后4位
        replacement = finding.value.slice(0, 4) + '************' + finding.value.slice(-4);
        break;
      case 'EMAIL':
        // 邮箱：保留首字母和域名
        const [localPart, domain] = finding.value.split('@');
        replacement = localPart[0] + '***@' + domain;
        break;
      case 'ADDRESS':
        // 地址：保留省市区，脱敏详细地址
        replacement = finding.value.slice(0, 6) + '****';
        break;
      default:
        replacement = '***';
    }
    
    result = result.replace(finding.value, `[REDACTED:${finding.type}:${replacement}]`);
  }
  
  return result;
}

/**
 * Chinese PII Router
 * 
 * 专门检测中文场景下的个人隐私信息
 */
export const chinesePIIRouter: GuardClawRouter = {
  id: 'chinese-pii',
  
  async detect(
    context: RouterContext,
    pluginConfig: ChinesePIIRouterConfig
  ): Promise<RouterDecision> {
    const { message, toolCall, toolResult } = context;
    
    // 只在启用时运行
    if (!pluginConfig.enabled) {
      return { level: 'S1', action: 'passthrough' };
    }
    
    // 收集待检测文本
    const textsToCheck: string[] = [];
    
    if (message) {
      textsToCheck.push(message);
    }
    
    if (toolCall?.parameters) {
      textsToCheck.push(JSON.stringify(toolCall.parameters));
    }
    
    if (toolResult?.content) {
      textsToCheck.push(JSON.stringify(toolResult.content));
    }
    
    const fullText = textsToCheck.join(' ');
    
    // 执行检测
    const findings = detectChinesePII(fullText, pluginConfig.options);
    
    // 过滤出验证通过的 PII（减少误报）
    const validatedFindings = findings.filter(f => f.validated);
    
    if (validatedFindings.length === 0) {
      return { level: 'S1', action: 'passthrough' };
    }
    
    // 检查是否有高风险 PII（身份证、银行卡）
    const highRiskTypes = ['ID_CARD', 'BANK_CARD'];
    const hasHighRisk = validatedFindings.some(f => highRiskTypes.includes(f.type));
    
    if (hasHighRisk) {
      // S3: 高风险 PII，本地处理
      return {
        level: 'S3',
        action: 'redirect',
        target: { agent: 'guard' },
        reason: `检测到高风险中文 PII: ${validatedFindings.map(f => f.type).join(', ')}`,
        metadata: {
          findings: validatedFindings.map(f => ({ type: f.type, validated: f.validated })),
        },
      };
    }
    
    // S2: 中低风险 PII，脱敏后上传
    const desensitizedText = desensitize(fullText, validatedFindings);
    
    return {
      level: 'S2',
      action: 'desensitize',
      reason: `检测到中文 PII: ${validatedFindings.map(f => f.type).join(', ')}`,
      metadata: {
        originalText: fullText,
        desensitizedText,
        findings: validatedFindings.map(f => ({ 
          type: f.type, 
          value: f.value.slice(0, 4) + '...',
          validated: f.validated 
        })),
      },
    };
  },
};

export default chinesePIIRouter;
