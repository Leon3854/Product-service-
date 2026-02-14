// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'eslint.config.mjs',
      'eslint.config.ts',
      'dist',
      'node_modules',
      'coverage',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Запрещаем плавающие Promise. В сервисе сбора данных это критично:
      // если запрос к API WB не "дождаться", данные не сохранятся.
      '@typescript-eslint/no-floating-promises': 'error',

      // Запрещаем использование any там, где это критично.
      // Для работы с тарифами лучше использовать interface или unknown + Type Guard.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Требуем явного возвращаемого типа у методов контроллеров и сервисов.
      // Это упрощает поддержку и мониторинг (ТЗ 1.2).
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',
      // Контроль работы с Prisma и внешними данными
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      // --- Общие настройки ---
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }], // Логи важны для мониторинга

      '@typescript-eslint/interface-name-prefix': 'off',

      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
