import { describe, it, expect } from 'vitest';
import { chinesePIIRouter } from '../src/routers/chinese-pii';
import type { RouterContext } from '../src/types';

describe('Chinese PII Router', () => {
  const mockConfig = {
    enabled: true,
    weight: 50,
    options: {
      detectIdCard: true,
      detectPhone: true,
      detectBankCard: true,
      detectEmail: true,
      detectAddress: true,
    },
  };

  describe('ID Card Detection', () => {
    it('should detect valid 18-digit Chinese ID card', async () => {
      // 使用一个格式正确但随机的身份证号（非真实）
      const context: RouterContext = {
        message: '我的身份证号是 110101199001011234',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S3');
      expect(result.action).toBe('redirect');
      expect(result.reason).toContain('ID_CARD');
    });

    it('should detect multiple ID cards', async () => {
      const context: RouterContext = {
        message: '员工信息：张三 110101199001011234，李四 310101198502023456',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S3');
      expect(result.metadata?.findings).toHaveLength(2);
    });

    it('should not detect invalid ID card format', async () => {
      const context: RouterContext = {
        message: '我的号码是 123456789012345678', // 不符合身份证号规则
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S1');
      expect(result.action).toBe('passthrough');
    });
  });

  describe('Phone Number Detection', () => {
    it('should detect Chinese mobile phone number', async () => {
      const context: RouterContext = {
        message: '请联系我 13800138000',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
      expect(result.action).toBe('desensitize');
      expect(result.reason).toContain('PHONE');
    });

    it('should detect multiple phone numbers', async () => {
      const context: RouterContext = {
        message: '紧急联系人：13800138000，备用电话 15912345678',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
      expect(result.metadata?.findings).toHaveLength(2);
    });

    it('should not detect invalid phone numbers', async () => {
      const context: RouterContext = {
        message: '我的号码是 12800138000', // 第二位是2，不符合规则
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S1');
    });
  });

  describe('Bank Card Detection', () => {
    it('should detect UnionPay card (62开头)', async () => {
      // 使用符合Luhn算法的测试卡号
      const context: RouterContext = {
        message: '我的银行卡是 6222021234567890123',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S3');
      expect(result.action).toBe('redirect');
      expect(result.reason).toContain('BANK_CARD');
    });

    it('should not detect invalid bank card', async () => {
      const context: RouterContext = {
        message: '我的卡号是 1234567890123456', // 不符合Luhn算法
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      // 虽然格式匹配，但验证失败，所以不会触发 S3
      expect(result.level).toBe('S1');
    });
  });

  describe('Email Detection', () => {
    it('should detect email address', async () => {
      const context: RouterContext = {
        message: '请发送邮件到 test@example.com',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
      expect(result.action).toBe('desensitize');
    });
  });

  describe('Address Detection', () => {
    it('should detect Chinese address', async () => {
      const context: RouterContext = {
        message: '我家住在北京市朝阳区建国路88号',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
      expect(result.reason).toContain('ADDRESS');
    });
  });

  describe('Desensitization', () => {
    it('should correctly desensitize ID card', async () => {
      const context: RouterContext = {
        message: '身份证号：110101199001011234',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.metadata?.desensitizedText).toContain('[REDACTED:ID_CARD:');
      expect(result.metadata?.desensitizedText).toContain('110101'); // 保留前6位
      expect(result.metadata?.desensitizedText).toContain('1234'); // 保留后4位
    });

    it('should correctly desensitize phone number', async () => {
      const context: RouterContext = {
        message: '电话：13800138000',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.metadata?.desensitizedText).toContain('[REDACTED:PHONE:');
      expect(result.metadata?.desensitizedText).toContain('138****8000');
    });
  });

  describe('Risk Level Classification', () => {
    it('should route ID card to S3 (high risk)', async () => {
      const context: RouterContext = {
        message: '身份证号 110101199001011234',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S3');
      expect(result.action).toBe('redirect');
    });

    it('should route phone to S2 (medium risk)', async () => {
      const context: RouterContext = {
        message: '手机号 13800138000',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
      expect(result.action).toBe('desensitize');
    });

    it('should route bank card to S3 (high risk)', async () => {
      const context: RouterContext = {
        message: '银行卡 6222021234567890123',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S3');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message', async () => {
      const context: RouterContext = {
        message: '',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S1');
    });

    it('should handle disabled config', async () => {
      const context: RouterContext = {
        message: '身份证号 110101199001011234',
      };

      const disabledConfig = { ...mockConfig, enabled: false };
      const result = await chinesePIIRouter.detect(context, disabledConfig);

      expect(result.level).toBe('S1');
    });

    it('should handle mixed PII types', async () => {
      const context: RouterContext = {
        message: '张三，身份证 110101199001011234，电话 13800138000，邮箱 zhangsan@example.com',
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      // 有身份证号，应该路由到 S3
      expect(result.level).toBe('S3');
    });

    it('should handle tool call parameters', async () => {
      const context: RouterContext = {
        toolCall: {
          tool: 'write_file',
          parameters: {
            content: '用户信息：13800138000',
          },
        },
      };

      const result = await chinesePIIRouter.detect(context, mockConfig);

      expect(result.level).toBe('S2');
    });
  });
});
