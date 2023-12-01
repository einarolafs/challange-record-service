module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: ['standard-with-typescript', 'plugin:prettier/recommended'],
  plugins: [
    // other plugins,
    'prettier',
  ],
  rules: {
    // other rules,
    'prettier/prettier': 'error',
  },
  overrides: [
    {
      files: ['.eslintrc.{js,cjs}'],
      env: {
        node: true,
      },
      parserOptions: {
        sourceType: 'script',
        project: null, // This ensures TypeScript checks don't apply to the config file
      },
      rules: {
        // You can disable specific rules or adjust them for this file here
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  rules: {},
};
