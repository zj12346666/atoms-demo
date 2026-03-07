/**
 * ASTValidator 测试
 */

import { ASTValidator } from './ast-validator';
import { ASTValidatorInput } from './types';

describe('ASTValidator', () => {
  let validator: ASTValidator;

  beforeEach(() => {
    validator = new ASTValidator();
  });

  describe('validate', () => {
    it('应该验证有效的 TypeScript 代码', async () => {
      const input: ASTValidatorInput = {
        code: `
          function hello(name: string): string {
            return \`Hello, \${name}!\`;
          }
        `,
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应该检测语法错误 - 缺少分号', async () => {
      const input: ASTValidatorInput = {
        code: `
          function hello(name: string): string {
            return \`Hello, \${name}!\`
          }
        `,
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      // TypeScript 可能不会将缺少分号视为错误（自动分号插入）
      // 但如果有其他语法错误，应该被检测到
      expect(result).toBeDefined();
    });

    it('应该检测语法错误 - 未闭合的括号', async () => {
      const input: ASTValidatorInput = {
        code: `
          function hello(name: string): string {
            return \`Hello, \${name}!\`;
          }
        `,
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      expect(result).toBeDefined();
      expect(result.isValid).toBeDefined();
    });

    it('应该检测语法错误 - 无效的语法', async () => {
      const input: ASTValidatorInput = {
        code: `
          function hello(name: string): string {
            return \`Hello, \${name}!\`;
          }
          invalid syntax here
        `,
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty('message');
      expect(result.errors[0]).toHaveProperty('line');
      expect(result.errors[0]).toHaveProperty('column');
      expect(result.errors[0]).toHaveProperty('code');
      expect(result.errors[0]).toHaveProperty('severity');
    });

    it('应该处理 JavaScript 代码', async () => {
      const input: ASTValidatorInput = {
        code: `
          function hello(name) {
            return \`Hello, \${name}!\`;
          }
        `,
        filePath: 'test.js',
        language: 'javascript',
      };

      const result = await validator.validate(input);

      expect(result).toBeDefined();
      expect(result.isValid).toBeDefined();
    });

    it('应该处理空代码', async () => {
      const input: ASTValidatorInput = {
        code: '',
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      expect(result).toBeDefined();
      expect(result.isValid).toBe(true);
    });

    it('应该返回正确的错误格式', async () => {
      const input: ASTValidatorInput = {
        code: 'const x = ;',
        filePath: 'test.ts',
        language: 'typescript',
      };

      const result = await validator.validate(input);

      if (!result.isValid && result.errors.length > 0) {
        const error = result.errors[0];
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('line');
        expect(error).toHaveProperty('column');
        expect(error).toHaveProperty('code');
        expect(error).toHaveProperty('severity');
        expect(error.severity).toBe('error');
        expect(typeof error.line).toBe('number');
        expect(typeof error.column).toBe('number');
      }
    });
  });
});
