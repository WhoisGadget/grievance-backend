// Test setup file for Jest
require('dotenv').config();

// Mock external dependencies for testing
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  auth: () => ({
    verifyIdToken: jest.fn().mockResolvedValue({ uid: 'test-user' })
  }),
  credential: {
    cert: jest.fn()
  }
}));

jest.mock('../ai-helpers', () => ({
  getEmbedding: jest.fn().mockResolvedValue({
    values: [0.1, 0.2, 0.3],
    provider: 'mock'
  }),
  getGeneration: jest.fn().mockResolvedValue({
    text: '{"test": "response"}',
    provider: 'mock'
  }),
  getGenerationWithSystem: jest.fn().mockResolvedValue({
    text: '{"test": "response"}',
    provider: 'mock'
  })
}));

jest.mock('../knowledge-loader', () => ({
  getSystemPrompt: jest.fn().mockReturnValue('Test system prompt'),
  getDefensePacketPrompt: jest.fn(),
  getQuickAnswerPrompt: jest.fn(),
  getAllKnowledgeContext: jest.fn().mockReturnValue('Test knowledge'),
  getGrievanceTypeContext: jest.fn().mockReturnValue({ type: 'test-type' })
}));

jest.mock('../master-prompt', () => ({
  getPersonaPrompt: jest.fn().mockReturnValue('Test persona prompt'),
  getUpdatePrompt: jest.fn()
}));

jest.mock('../logger', () => ({
  warn: jest.fn(),
  error: jest.fn(),
  audit: jest.fn()
}));

// Mock pg (PostgreSQL)
const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  connect: jest.fn(),
  end: jest.fn()
};

jest.mock('pg', () => ({
  Pool: jest.fn(() => mockPool)
}));

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

// Mock fs for Firebase service account loading
jest.mock('fs', () => ({
  readFileSync: jest.fn().mockReturnValue(JSON.stringify({
    type: "service_account",
    project_id: "test-project"
  }))
}));

// Mock csv-parser
jest.mock('csv-parser', () => jest.fn(() => ({
  on: jest.fn().mockReturnThis(),
  pipe: jest.fn().mockReturnThis()
})));

// Mock pdf-parse
jest.mock('pdf-parse', () => jest.fn().mockResolvedValue({
  text: 'Mock PDF text content'
}));

// Global test utilities
global.testPool = mockPool;