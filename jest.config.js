module.exports = {
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testMatch: [
    '<rootDir>/tests/**/*.test.js',
    '<rootDir>/**/*.test.js'
  ],
  collectCoverageFrom: [
    'server.js',
    'ai-helpers.js',
    'knowledge-loader.js',
    'master-prompt.js',
    'logger.js'
  ],
  testTimeout: 10000
};