import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores([
    'dist',
    'tmp_deploy_bundle.js',
    'tmp_ads_insights_repo/**',
    'tmp_market_lens_ai_repo/**',
  ]),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // These legacy screens intentionally hydrate or reset local UI state when
    // an external case, URL, or credential source changes. Keep the stricter
    // React 19 rule enabled for every new file while the state machines below
    // are migrated incrementally.
    files: [
      'src/components/InviteModal.jsx',
      'src/contexts/ReportHistoryContext.jsx',
      'src/pages/AiExplorer.jsx',
      'src/pages/AnalysisGraphs.jsx',
      'src/pages/EssentialPack.jsx',
      'src/pages/Settings.jsx',
      'src/pages/SetupWizard.jsx',
    ],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
