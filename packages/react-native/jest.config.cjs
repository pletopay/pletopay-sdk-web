/** @type {import('jest').Config} */
module.exports = {
  preset: '@react-native/jest-preset',
  rootDir: __dirname,
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts', '**/*.spec.tsx'],
  transform: { '^.+\\.[jt]sx?$': ['babel-jest', { configFile: `${__dirname}/babel.config.cjs` }] },
  // pnpm nests packages as node_modules/.pnpm/<name@version>/node_modules/<name>: keep React Native's packages transpiled.
  transformIgnorePatterns: ['node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(react-native|@react-native|react-native-webview)/)'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  testTimeout: 15000,
};
