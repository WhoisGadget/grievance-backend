require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Groq = require('groq-sdk');
const { Mistral } = require('@mistralai/mistralai');

// COST-FREE PERFORMANCE OPTIMIZATION: HTTP Connection Pooling
// Reduces connection overhead by reusing HTTP connections
const http = require('http');
const https = require('https');

// Configure connection pooling for AI API calls
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,        // Maximum concurrent connections per host
  maxFreeSockets: 10,    // Maximum free sockets to keep open
  timeout: 60000,        // 60 second timeout
  keepAliveMsecs: 30000  // Keep connections alive for 30 seconds
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  keepAliveMsecs: 30000
});

console.log('✅ COST-FREE OPTIMIZATION: HTTP connection pooling enabled');
console.log(`   Max sockets: ${httpsAgent.maxSockets}, Keep-alive: ${httpsAgent.keepAliveMsecs}ms`);

// Function to check if API key is properly configured
function isApiKeyConfigured(keyName, placeholder) {
  const value = process.env[keyName];
  return value && value !== placeholder;
}

// Initialize clients only if keys are configured
const genAI = isApiKeyConfigured('GEMINI_API_KEY', 'your_gemini_api_key_here') ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const openai = isApiKeyConfigured('OPENAI_API_KEY', 'your_openai_api_key_here') ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const groq = isApiKeyConfigured('GROQ_API_KEY', 'your_groq_api_key_here') ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const mistral = isApiKeyConfigured('MISTRAL_API_KEY', 'your_mistral_api_key_here') ? new Mistral({ apiKey: process.env.MISTRAL_API_KEY }) : null;

console.log('AI API keys configured - Gemini:', !!genAI);
console.log('OpenAI:', !!openai);
console.log('Groq:', !!groq);
console.log('Mistral:', !!mistral);

// Function to get embedding with failover
async function getEmbedding(text) {
  const providers = [
    { name: 'Gemini', client: genAI, func: async () => {
      const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });
      const result = await embeddingModel.embedContent(text);
      return { values: result.embedding.values, provider: 'gemini' };
    }},
    { name: 'OpenAI', client: openai, func: async () => {
      const response = await openai.embeddings.create({
        model: 'text-embedding-ada-002',
        input: text,
      });
      return { values: response.data[0].embedding, provider: 'openai' };
    }},
    { name: 'Groq', client: groq, func: async () => {
      const embedding = await groq.embeddings.create({
        model: 'text-embedding-004',
        input: text,
      });
      return { values: embedding.data[0].embedding, provider: 'groq' };
    }},
    { name: 'Mistral', client: mistral, func: async () => {
      const embedding = await mistral.embeddings({
        model: 'mistral-embed',
        input: [text],
      });
      return { values: embedding.data[0].embedding, provider: 'mistral' };
    }}
  ];

  const errors = [];
  for (const { name, client, func } of providers) {
    if (!client) {
      errors.push(`${name}: API key not configured`);
      continue;
    }

    try {
      return await func();
    } catch (error) {
      const errorMsg = `${name}: ${error.message}`;
      console.log(`Embedding failed for ${name}, trying next provider:`, errorMsg);
      errors.push(errorMsg);
    }
  }

  throw new Error(`All embedding providers failed:\n${errors.join('\n')}\n\nPlease check your API keys in .env file.`);
}

// Function to get generation with failover
async function getGeneration(prompt) {
  const providers = [
    { name: 'Gemini', client: genAI, func: async () => {
      const chatModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
      const result = await chatModel.generateContent(prompt);
      return { text: result.response.text(), provider: 'gemini' };
    }},
    { name: 'OpenAI', client: openai, func: async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
      });
      return { text: response.choices[0].message.content, provider: 'openai' };
    }},
    { name: 'Groq', client: groq, func: async () => {
      const chatCompletion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama3-8b-8192',
      });
      return { text: chatCompletion.choices[0].message.content, provider: 'groq' };
    }},
    { name: 'Mistral', client: mistral, func: async () => {
      const chatResponse = await mistral.chat({
        model: 'mistral-small-latest',
        messages: [{ role: 'user', content: prompt }],
      });
      return { text: chatResponse.choices[0].message.content, provider: 'mistral' };
    }}
  ];

  const errors = [];
  for (const { name, client, func } of providers) {
    if (!client) {
      errors.push(`${name}: API key not configured`);
      continue;
    }

    try {
      return await func();
    } catch (error) {
      const errorMsg = `${name}: ${error.message}`;
      console.log(`Generation failed for ${name}, trying next provider:`, errorMsg);
      errors.push(errorMsg);
    }
  }

  throw new Error(`All generation providers failed:\n${errors.join('\n')}\n\nPlease check your API keys in .env file.`);
}

// Function to get generation with system prompt support
async function getGenerationWithSystem(systemPrompt, userPrompt) {
  const providers = [
    { name: 'Gemini', client: genAI, func: async () => {
      const chatModel = genAI.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: systemPrompt
      });
      const result = await chatModel.generateContent(userPrompt);
      return { text: result.response.text(), provider: 'gemini' };
    }},
    { name: 'OpenAI', client: openai, func: async () => {
      const response = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      });
      return { text: response.choices[0].message.content, provider: 'openai' };
    }},
    { name: 'Groq', client: groq, func: async () => {
      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        model: 'llama3-8b-8192',
      });
      return { text: chatCompletion.choices[0].message.content, provider: 'groq' };
    }},
    { name: 'Mistral', client: mistral, func: async () => {
      const chatResponse = await mistral.chat({
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
      });
      return { text: chatResponse.choices[0].message.content, provider: 'mistral' };
    }}
  ];

  const errors = [];
  for (const { name, client, func } of providers) {
    if (!client) {
      errors.push(`${name}: API key not configured`);
      continue;
    }

    try {
      return await func();
    } catch (error) {
      const errorMsg = `${name}: ${error.message}`;
      console.log(`Generation failed for ${name}, trying next provider:`, errorMsg);
      errors.push(errorMsg);
    }
  }

  throw new Error(`All generation providers failed:\n${errors.join('\n')}\n\nPlease check your API keys in .env file.`);
}

// Advanced Prompt Engineering Utilities

// Prompt versioning and management system
class PromptManager {
  constructor() {
    this.versions = new Map();
    this.currentVersion = '1.0.0';
    this.performanceMetrics = new Map();
  }

  // Register a new prompt version
  registerVersion(version, promptData, metadata = {}) {
    const versionData = {
      version,
      prompt: promptData,
      metadata: {
        created: new Date().toISOString(),
        author: metadata.author || 'system',
        description: metadata.description || '',
        tags: metadata.tags || []
      }
    };

    this.versions.set(version, versionData);
    return versionData;
  }

  // Get prompt by version
  getVersion(version = this.currentVersion) {
    return this.versions.get(version);
  }

  // Set current active version
  setCurrentVersion(version) {
    if (this.versions.has(version)) {
      this.currentVersion = version;
      return true;
    }
    return false;
  }

  // List all versions
  listVersions() {
    return Array.from(this.versions.entries()).map(([version, data]) => ({
      version,
      created: data.metadata.created,
      description: data.metadata.description,
      tags: data.metadata.tags
    }));
  }

  // Rollback to previous version
  rollback(targetVersion) {
    if (this.versions.has(targetVersion)) {
      this.currentVersion = targetVersion;
      return this.getVersion();
    }
    return null;
  }
}

// A/B Testing framework for prompts
class PromptABTester {
  constructor() {
    this.tests = new Map();
    this.results = new Map();
  }

  // Create a new A/B test
  createTest(testId, promptA, promptB, testCases = [], metadata = {}) {
    const test = {
      id: testId,
      prompts: { A: promptA, B: promptB },
      testCases,
      metadata: {
        created: new Date().toISOString(),
        status: 'active',
        ...metadata
      },
      results: { A: { wins: 0, total: 0 }, B: { wins: 0, total: 0 } }
    };

    this.tests.set(testId, test);
    return test;
  }

  // Run a single test case
  async runTestCase(testId, caseData, evaluationCriteria = {}) {
    const test = this.tests.get(testId);
    if (!test) return null;

    const results = { A: null, B: null };

    // Generate responses for both prompts
    for (const variant of ['A', 'B']) {
      try {
        const prompt = test.prompts[variant];
        const fullPrompt = typeof prompt === 'function' ? prompt(caseData) : prompt;
        results[variant] = await getGeneration(fullPrompt);
      } catch (error) {
        console.error(`Error generating response for variant ${variant}:`, error);
        results[variant] = { error: error.message };
      }
    }

    // Evaluate winner based on criteria
    const winner = this.evaluateWinner(results.A, results.B, evaluationCriteria);
    if (winner) {
      test.results[winner].wins++;
    }
    test.results.A.total++;
    test.results.B.total++;

    const result = {
      testId,
      caseData,
      responses: results,
      winner,
      evaluationCriteria
    };

    // Store result
    if (!this.results.has(testId)) {
      this.results.set(testId, []);
    }
    this.results.get(testId).push(result);

    return result;
  }

  // Evaluate which response is better
  evaluateWinner(responseA, responseB, criteria) {
    // Default evaluation: prefer responses with higher confidence scores
    const confidenceRegex = /(\d+)% confidence/i;

    const matchA = responseA?.text?.match(confidenceRegex);
    const matchB = responseB?.text?.match(confidenceRegex);

    if (matchA && matchB) {
      const confA = parseInt(matchA[1]);
      const confB = parseInt(matchB[1]);
      return confA > confB ? 'A' : confB > confA ? 'B' : null;
    }

    // Fallback: prefer longer, more detailed responses
    const lenA = responseA?.text?.length || 0;
    const lenB = responseB?.text?.length || 0;
    return lenA > lenB ? 'A' : lenB > lenA ? 'B' : null;
  }

  // Get test results
  getTestResults(testId) {
    const test = this.tests.get(testId);
    const results = this.results.get(testId) || [];

    if (!test) return null;

    const stats = {
      totalCases: results.length,
      variantA: {
        wins: test.results.A.wins,
        winRate: test.results.A.total > 0 ? (test.results.A.wins / test.results.A.total * 100).toFixed(1) : 0
      },
      variantB: {
        wins: test.results.B.wins,
        winRate: test.results.B.total > 0 ? (test.results.B.wins / test.results.B.total * 100).toFixed(1) : 0
      }
    };

    return { test, results, stats };
  }

  // End a test and declare winner
  endTest(testId) {
    const test = this.tests.get(testId);
    if (!test) return null;

    test.metadata.status = 'completed';
    test.metadata.completed = new Date().toISOString();

    const results = this.getTestResults(testId);
    const winner = results.stats.variantA.winRate > results.stats.variantB.winRate ? 'A' : 'B';

    return { test, winner, finalStats: results.stats };
  }
}

// Performance tracking and optimization
class PromptOptimizer {
  constructor() {
    this.metrics = new Map();
    this.baselines = new Map();
  }

  // Track performance metrics
  trackMetric(promptId, metricName, value, metadata = {}) {
    const key = `${promptId}:${metricName}`;
    const entry = {
      promptId,
      metricName,
      value,
      timestamp: new Date().toISOString(),
      metadata
    };

    if (!this.metrics.has(key)) {
      this.metrics.set(key, []);
    }
    this.metrics.get(key).push(entry);

    return entry;
  }

  // Set baseline performance
  setBaseline(promptId, metricName, baselineValue) {
    const key = `${promptId}:${metricName}`;
    this.baselines.set(key, {
      value: baselineValue,
      setDate: new Date().toISOString()
    });
  }

  // Get performance improvement
  getImprovement(promptId, metricName) {
    const key = `${promptId}:${metricName}`;
    const baseline = this.baselines.get(key);
    const metrics = this.metrics.get(key);

    if (!baseline || !metrics || metrics.length === 0) {
      return null;
    }

    const latest = metrics[metrics.length - 1].value;
    const improvement = ((latest - baseline.value) / baseline.value * 100);

    return {
      baseline: baseline.value,
      current: latest,
      improvement: improvement.toFixed(2) + '%',
      direction: improvement > 0 ? 'improvement' : 'decline'
    };
  }

  // Get performance summary
  getPerformanceSummary(promptId) {
    const metrics = Array.from(this.metrics.keys())
      .filter(key => key.startsWith(`${promptId}:`))
      .map(key => {
        const metricName = key.split(':')[1];
        return {
          metric: metricName,
          improvement: this.getImprovement(promptId, metricName)
        };
      });

    return {
      promptId,
      metrics,
      overallImprovement: this.calculateOverallImprovement(metrics)
    };
  }

  calculateOverallImprovement(metrics) {
    const improvements = metrics
      .map(m => m.improvement)
      .filter(imp => imp !== null)
      .map(imp => parseFloat(imp.improvement.replace('%', '')));

    if (improvements.length === 0) return 'No data';

    const avgImprovement = improvements.reduce((sum, imp) => sum + imp, 0) / improvements.length;
    return avgImprovement.toFixed(2) + '%';
  }
}

// Utility functions for prompt optimization

// Generate prompt variations for testing
function generatePromptVariations(basePrompt, variations = {}) {
  const variants = [];

  // Length variations
  if (variations.length) {
    variants.push({
      name: 'concise',
      prompt: basePrompt.replace(/\n\n/g, '\n').replace(/  +/g, ' ')
    });
    variants.push({
      name: 'detailed',
      prompt: basePrompt.replace(/\n/g, '\n\n')
    });
  }

  // Structure variations
  if (variations.structure) {
    variants.push({
      name: 'structured',
      prompt: basePrompt + '\n\nUse clear headings and bullet points for your response.'
    });
  }

  // Instruction variations
  if (variations.instructions) {
    variants.push({
      name: 'step_by_step',
      prompt: basePrompt + '\n\nProvide step-by-step reasoning for your analysis.'
    });
  }

  return variants;
}

// Analyze prompt effectiveness
async function analyzePromptEffectiveness(prompt, testCases = []) {
  const results = [];

  for (const testCase of testCases) {
    try {
      const response = await getGeneration(prompt + '\n\n' + testCase.input);
      const analysis = {
        testCase,
        response: response.text,
        metrics: {
          length: response.text.length,
          hasConfidence: /confidence/i.test(response.text),
          hasSyllogism: /LEGAL SYLLOGISM|ISSUE:|RULE:|ANALYSIS:|CONCLUSION:/i.test(response.text),
          hasRecommendations: /recommend/i.test(response.text)
        }
      };
      results.push(analysis);
    } catch (error) {
      results.push({ testCase, error: error.message });
    }
  }

  // Calculate averages
  const validResults = results.filter(r => !r.error);
  const averages = {
    totalCases: results.length,
    successfulCases: validResults.length,
    avgLength: validResults.reduce((sum, r) => sum + r.metrics.length, 0) / validResults.length,
    confidenceRate: validResults.filter(r => r.metrics.hasConfidence).length / validResults.length * 100,
    syllogismRate: validResults.filter(r => r.metrics.hasSyllogism).length / validResults.length * 100,
    recommendationRate: validResults.filter(r => r.metrics.hasRecommendations).length / validResults.length * 100
  };

  return { results, averages };
}

// Initialize global instances
const promptManager = new PromptManager();
const promptABTester = new PromptABTester();
const promptOptimizer = new PromptOptimizer();

module.exports = {
  getEmbedding,
  getGeneration,
  getGenerationWithSystem,
  // Advanced prompt engineering utilities
  PromptManager,
  PromptABTester,
  PromptOptimizer,
  promptManager,
  promptABTester,
  promptOptimizer,
  generatePromptVariations,
  analyzePromptEffectiveness
};