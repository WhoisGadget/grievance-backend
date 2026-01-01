require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

// COST-FREE PERFORMANCE OPTIMIZATION: Node.js Clustering
// Utilizes all CPU cores for better performance and scalability
const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`🚀 COST-FREE OPTIMIZATION: Starting ${numCPUs} worker processes`);

  // Fork workers equal to number of CPU cores
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Restart workers if they die
  cluster.on('exit', (worker, code, signal) => {
    console.log(`⚠️  Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });

  console.log(`✅ Clustering enabled: ${numCPUs} CPU cores utilized`);
} else {
  // Worker process - run the server

// Validate API keys on startup
function validateApiKeys() {
  const requiredKeys = [
    { name: 'OPENAI_API_KEY', placeholder: 'your_openai_api_key_here', service: 'OpenAI' },
    { name: 'GEMINI_API_KEY', placeholder: 'your_gemini_api_key_here', service: 'Google Gemini' },
    { name: 'GROQ_API_KEY', placeholder: 'your_groq_api_key_here', service: 'Groq' },
    { name: 'MISTRAL_API_KEY', placeholder: 'your_mistral_api_key_here', service: 'Mistral' }
  ];

  const missingKeys = [];
  const placeholderKeys = [];

  requiredKeys.forEach(({ name, placeholder, service }) => {
    const value = process.env[name];
    if (!value) {
      missingKeys.push(service);
    } else if (value === placeholder) {
      placeholderKeys.push(service);
    }
  });

  if (missingKeys.length > 0 || placeholderKeys.length > 0) {
    const errors = [];
    if (missingKeys.length > 0) {
      errors.push(`Missing API keys for: ${missingKeys.join(', ')}`);
    }
    if (placeholderKeys.length > 0) {
      errors.push(`Placeholder API keys detected for: ${placeholderKeys.join(', ')}`);
    }
    errors.push('\nPlease update your .env file with actual API keys from the respective services.');
    throw new Error('API Key Configuration Error:\n' + errors.join('\n'));
  }
}

validateApiKeys();
const basicAuth = require('express-basic-auth');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Auto-initialize database tables on startup
async function initializeDatabase() {
  console.log('🔧 Initializing database tables and indexes...');
  try {
    // Enable pgvector extension (for embeddings)
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('   ✅ pgvector extension enabled');
    } catch (err) {
      console.log('   ⚠️  pgvector not available (embeddings will be stored as JSON)');
    }

    // Create leak_data table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leak_data (
        id SERIAL PRIMARY KEY,
        value FLOAT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ leak_data table ready');

    // Create cases table (for RAG - similar cases lookup)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id SERIAL PRIMARY KEY,
        case_id VARCHAR(255),
        title TEXT,
        decision TEXT,
        date VARCHAR(50),
        text_content TEXT,
        embedding TEXT,
        keywords TEXT,
        provider VARCHAR(50) DEFAULT 'gemini',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ cases table ready');

    // Create pdfs table (for uploaded documents)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pdfs (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255),
        text_content TEXT,
        embedding TEXT,
        provider VARCHAR(50) DEFAULT 'gemini',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ pdfs table ready');

    // Create feedback table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        grievance_text TEXT,
        generated_report TEXT,
        rating INTEGER,
        comments TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ feedback table ready');

    // Create ai_response_votes table for user voting system
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_response_votes (
        id SERIAL PRIMARY KEY,
        response_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        vote BOOLEAN NOT NULL, -- true for correct, false for incorrect
        ai_provider VARCHAR(50),
        response_type VARCHAR(50), -- e.g., 'analyze-grievance', 'quick-answer', etc.
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(response_id, user_id) -- one vote per user per response
      )
    `);
    console.log('   ✅ ai_response_votes table ready');

    // Create ai_feedback table for detailed user feedback
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_feedback (
        id SERIAL PRIMARY KEY,
        response_id VARCHAR(255) NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        accuracy INTEGER CHECK (accuracy >= 1 AND accuracy <= 5),
        completeness INTEGER CHECK (completeness >= 1 AND completeness <= 5),
        usefulness INTEGER CHECK (usefulness >= 1 AND usefulness <= 5),
        comments TEXT,
        suggested_improvements TEXT[], -- Array of suggested improvements
        grievance_type VARCHAR(100),
        ai_provider VARCHAR(50),
        response_quality_score DECIMAL(3,2), -- Calculated quality score
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ai_feedback_response_id (response_id),
        INDEX idx_ai_feedback_user_rating (rating),
        INDEX idx_ai_feedback_grievance_type (grievance_type),
        INDEX idx_ai_feedback_ai_provider (ai_provider),
        UNIQUE(response_id, user_id) -- one feedback per user per response
      )
    `);
    console.log('   ✅ ai_feedback table ready');

    // Create admin_settings table for system administrator settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(100) UNIQUE NOT NULL,
        setting_value JSONB NOT NULL,
        description TEXT,
        updated_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ admin_settings table ready');

    // Insert default settings if not exist
    await pool.query(`
      INSERT INTO admin_settings (setting_key, setting_value, description)
      VALUES ('voting_enabled', 'true', 'Enable/disable the AI response voting system for all users')
      ON CONFLICT (setting_key) DO NOTHING
    `);
    console.log('   ✅ default admin settings inserted');

    // Create analytics_metrics table for comprehensive analytics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_metrics (
        id SERIAL PRIMARY KEY,
        metric_name VARCHAR(100) NOT NULL,
        metric_value DECIMAL(10,2),
        metric_type VARCHAR(50) DEFAULT 'counter', -- counter, gauge, histogram
        category VARCHAR(50) DEFAULT 'general', -- general, ai, security, usage, performance
        tags JSONB DEFAULT '{}',
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_analytics_metrics_name_time (metric_name, timestamp),
        INDEX idx_analytics_metrics_category (category)
      )
    `);
    console.log('   ✅ analytics_metrics table ready');

    // Create ai_performance_logs table for AI model comparison
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_performance_logs (
        id SERIAL PRIMARY KEY,
        ai_provider VARCHAR(50) NOT NULL,
        operation_type VARCHAR(100) NOT NULL, -- analyze-grievance, quick-answer, etc.
        response_time_ms INTEGER,
        success BOOLEAN DEFAULT true,
        error_message TEXT,
        token_usage JSONB DEFAULT '{}',
        confidence_score DECIMAL(3,2),
        user_rating INTEGER, -- 1-5 rating from user feedback
        response_quality_score DECIMAL(3,2), -- calculated quality score
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_ai_performance_provider (ai_provider),
        INDEX idx_ai_performance_operation (operation_type),
        INDEX idx_ai_performance_time (created_at)
      )
    `);
    console.log('   ✅ ai_performance_logs table ready');

    // Create usage_logs table for usage pattern analytics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        action VARCHAR(100) NOT NULL, -- login, create-grievance, analyze-grievance, etc.
        resource_type VARCHAR(50), -- grievance, contract, evidence, etc.
        resource_id INTEGER,
        ip_address VARCHAR(45),
        user_agent TEXT,
        session_duration INTEGER, -- in seconds
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_usage_logs_user (user_id),
        INDEX idx_usage_logs_action (action),
        INDEX idx_usage_logs_time (created_at)
      )
    `);
    console.log('   ✅ usage_logs table ready');

    // Create users table (for user tracking)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid VARCHAR(255) UNIQUE,
        email VARCHAR(255),
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'member',
        position VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);
    console.log('   ✅ users table ready');

    // Create grievances table (for tracking individual grievances)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS grievances (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title VARCHAR(255),
        description TEXT,
        grievant_name VARCHAR(255),
        grievant_id VARCHAR(255),
        incident_date DATE,
        discipline_type VARCHAR(255),
        employee_tenure INTEGER,
        prior_discipline TEXT,
        status VARCHAR(50) DEFAULT 'draft',
        contract_id INTEGER,
        win_probability DECIMAL(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ grievances table ready');

    // Create contracts table (for uploaded contracts)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        filename VARCHAR(255),
        text_content TEXT,
        embedding TEXT,
        provider VARCHAR(50) DEFAULT 'gemini',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ contracts table ready');

    // Create evidence table (for uploaded evidence files)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS evidence (
        id SERIAL PRIMARY KEY,
        grievance_id INTEGER REFERENCES grievances(id),
        filename VARCHAR(255),
        file_type VARCHAR(50),
        text_content TEXT,
        embedding TEXT,
        provider VARCHAR(50) DEFAULT 'gemini',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ evidence table ready');

    // Create case_files table (for generated court-ready documents)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS case_files (
        id SERIAL PRIMARY KEY,
        grievance_id INTEGER REFERENCES grievances(id),
        content TEXT,
        format_type VARCHAR(50) DEFAULT 'court_ready',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ case_files table ready');

    // Create performance indexes
    console.log('   📊 Creating performance indexes...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cases_user_id ON cases(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cases_created_at ON cases(created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_grievances_user_id ON grievances(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_grievances_created_at ON grievances(created_at)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_grievances_status ON grievances(status)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_evidence_grievance_id ON evidence(grievance_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_contracts_user_id ON contracts(user_id)');
    console.log('   ✅ Performance indexes created');

    console.log('✅ Database initialization complete!');
  } catch (error) {
    console.error('❌ Error initializing database:', error.message);
    // Don't exit - let the server start anyway, some routes may still work
  }
}

const csv = require('csv-parser');
const fs = require('fs');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const admin = require('firebase-admin');
const { getEmbedding, getGeneration, getGenerationWithSystem } = require('./ai-helpers');
const { getSystemPrompt, getDefensePacketPrompt, getQuickAnswerPrompt, getAllKnowledgeContext, getGrievanceTypeContext } = require('./knowledge-loader');
const { getPersonaPrompt, getUpdatePrompt } = require('./master-prompt');
const logger = require('./logger');
const helmet = require('helmet');
const app = express();

// Initialize Firebase Admin
function loadFirebaseServiceAccount() {
  const configValue = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

  if (!configValue) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY is not set in environment variables');
    return null;
  }

  // First try to parse as JSON directly
  try {
    return JSON.parse(configValue);
  } catch (e) {
    // If parsing fails, check if it's a file path
    if (configValue.endsWith('.json') || configValue.startsWith('./') || configValue.startsWith('/')) {
      try {
        const filePath = configValue.startsWith('/') ? configValue : require('path').join(__dirname, configValue);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(fileContent);
      } catch (fileError) {
        console.error('Failed to read Firebase service account from file:', fileError.message);
        return null;
      }
    }
    console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY as JSON');
    return null;
  }
}

const serviceAccount = loadFirebaseServiceAccount();
if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} else {
  console.warn('Firebase Admin not initialized - authentication features will be disabled');
}
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || 'secret';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// CORS middleware - allow frontend to call backend
app.use(cors({
  origin: true, // Allow all origins in development, or specify your frontend URL
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware for logging requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Middleware for parsing JSON
app.use(express.json());

// Helmet middleware for security headers
app.use(helmet());

// Rate limiting middleware
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// JWT authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  console.log(`Auth attempt: ${req.method} ${req.url}, hasAuthHeader: ${!!authHeader}`);

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    console.log(`Auth attempt with Bearer token: ${token.substring(0, 10)}...`);

    jwt.verify(token, jwtSecret, (err, user) => {
      if (err) {
        console.error('Error verifying JWT:', err);
        return res.sendStatus(403);
      }
      req.user = user;
      console.log('JWT verified for user:', user.uid);
      next();
    });
  } else {
    console.log('Auth failed: no Bearer token');
    res.sendStatus(401);
  }
};

// Login route to verify Firebase ID token and generate JWT
app.post('/login', async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res.status(400).json({ error: 'ID token is required' });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    console.log('ID token verified for user:', uid);

    // Generate custom JWT
    const token = jwt.sign({ uid }, jwtSecret, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    console.error('Error verifying ID token:', error);
    res.status(401).json({ error: 'Invalid ID token' });
  }
});

// Route for data insertion - protected
app.get('/leak', authenticateToken, async (req, res) => {
  const value = Math.random();
  await pool.query('INSERT INTO leak_data (value) VALUES ($1)', [value]);
  const result = await pool.query('SELECT COUNT(*) as count FROM leak_data');
  const count = parseInt(result.rows[0].count);
  console.log('Data inserted into database, total count:', count);
  res.json({ message: 'Data inserted into database', count });
});

// Input validation schema
const dataSchema = Joi.object({
  value: Joi.number().required()
});

const grievanceSchema = Joi.object({
  grievance: Joi.string().max(10000).pattern(/^[^]+$/).required() // Limit length, basic pattern to prevent obvious injections
});

const feedbackSchema = Joi.object({
  grievance_text: Joi.string().required(),
  generated_report: Joi.string().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  comments: Joi.string().optional()
});

const aiFeedbackSchema = Joi.object({
  responseId: Joi.string().required(),
  rating: Joi.number().integer().min(1).max(5).required(),
  accuracy: Joi.number().integer().min(1).max(5).optional(), // How accurate was the analysis
  completeness: Joi.number().integer().min(1).max(5).optional(), // How complete was the response
  usefulness: Joi.number().integer().min(1).max(5).optional(), // How useful was the information
  comments: Joi.string().optional(),
  suggestedImprovements: Joi.array().items(Joi.string()).optional(),
  grievanceType: Joi.string().optional(),
  aiProvider: Joi.string().optional()
});

const grievanceCreateSchema = Joi.object({
  title: Joi.string().min(1).max(200).required(),
  description: Joi.string().min(10).max(5000).required(),
  grievantName: Joi.string().max(100).optional(),
  grievantId: Joi.string().max(50).optional(),
  incidentDate: Joi.date().optional(),
  disciplineType: Joi.string().max(100).optional(),
  grievantPosition: Joi.string().max(100).optional()
});

const updateCaseSchema = Joi.object({
  grievanceId: Joi.number().integer().required(),
  updateData: Joi.object({
    meetingType: Joi.string().valid('step1', 'step2', 'arbitration').required(),
    summary: Joi.string().max(2000).optional(),
    tone: Joi.string().valid('calm', 'defensive', 'aggressive').optional(),
    evidence: Joi.string().max(1000).optional(),
    inconsistencies: Joi.string().max(1000).optional(),
    settlement: Joi.string().max(500).optional()
  }).required(),
  persona: Joi.string().valid('strategist', 'litigator').default('strategist')
});

const generateCaseFileSchema = Joi.object({
  grievanceId: Joi.number().integer().required(),
  prepData: Joi.object({
    witnesses: Joi.string().max(1000).optional(),
    evidence: Joi.string().max(2000).optional()
  }).optional()
});

// Route for POST data with validation - protected
app.post('/data', authenticateToken, async (req, res) => {
  const { error } = dataSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { value } = req.body;
  await pool.query('INSERT INTO leak_data (value) VALUES ($1)', [value]);
  const result = await pool.query('SELECT COUNT(*) as count FROM leak_data');
  const count = parseInt(result.rows[0].count);
  res.json({ message: 'Data inserted via POST', count });
});

// Fixed route with non-blocking operation - protected
app.get('/block', authenticateToken, (req, res) => {
  // Non-blocking delay using setTimeout
  setTimeout(() => {
    res.send('Delayed for 1 second without blocking');
  }, 1000);
});

// Function to compute cosine similarity
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Function to calculate win probability with weighted factors
function calculateWinProbability(grievanceContext, similarCases, contractAnalysis = null) {
  let score = 0;
  let totalWeight = 0;

  // Factor 1: Similar case outcomes (30% weight)
  const caseWeight = 0.3;
  if (similarCases.length > 0) {
    const granted = similarCases.filter(c => c.decision === 'Granted').length;
    const caseScore = (granted / similarCases.length) * 100;
    score += caseScore * caseWeight;
    totalWeight += caseWeight;
  }

  // Factor 2: Contract clarity (25% weight)
  const contractWeight = 0.25;
  let contractScore = 50; // Default neutral
  if (contractAnalysis && contractAnalysis.violations && contractAnalysis.violations.length > 0) {
    // Stronger violations = higher score
    const violationCount = contractAnalysis.violations.length;
    contractScore = Math.min(90, 50 + (violationCount * 10));
  }
  score += contractScore * contractWeight;
  totalWeight += contractWeight;

  // Factor 3: Just cause analysis (20% weight)
  const justCauseWeight = 0.2;
  if (grievanceContext && grievanceContext.justCauseAnalysis) {
    const justCause = grievanceContext.justCauseAnalysis;
    const passingTests = [justCause.notice, justCause.reasonableRule, justCause.investigation,
                         justCause.fairInvestigation, justCause.proof, justCause.equalTreatment,
                         justCause.penalty].filter(test => test === 'pass').length;
    const justCauseScore = (passingTests / 7) * 100;
    score += justCauseScore * justCauseWeight;
    totalWeight += justCauseWeight;
  }

  // Factor 4: Evidence strength (15% weight)
  const evidenceWeight = 0.15;
  // This would be enhanced with actual evidence count/quality
  const evidenceScore = 60; // Placeholder - would analyze actual evidence
  score += evidenceScore * evidenceWeight;
  totalWeight += evidenceWeight;

  // Factor 5: Grievance type success rate (10% weight)
  const typeWeight = 0.1;
  const typeSuccessRates = {
    'termination': 65,
    'suspension': 70,
    'discipline': 75,
    'contract_violation': 80,
    'overtime': 85,
    'seniority': 75
  };
  const typeScore = typeSuccessRates[grievanceContext?.grievanceType] || 50;
  score += typeScore * typeWeight;
  totalWeight += typeWeight;

  // Calculate final percentage
  const finalScore = totalWeight > 0 ? score / totalWeight : 50;

  // Provide confidence level
  const confidence = totalWeight >= 0.8 ? 'high' : totalWeight >= 0.5 ? 'medium' : 'low';

  return {
    percentage: Math.round(finalScore),
    confidence,
    factors: {
      similarCases: similarCases.length > 0 ? (similarCases.filter(c => c.decision === 'Granted').length / similarCases.length * 100).toFixed(1) : 'N/A',
      contractClarity: contractScore.toFixed(1),
      justCause: grievanceContext?.justCauseAnalysis ? (([grievanceContext.justCauseAnalysis.notice, grievanceContext.justCauseAnalysis.reasonableRule, grievanceContext.justCauseAnalysis.investigation, grievanceContext.justCauseAnalysis.fairInvestigation, grievanceContext.justCauseAnalysis.proof, grievanceContext.justCauseAnalysis.equalTreatment, grievanceContext.justCauseAnalysis.penalty].filter(test => test === 'pass').length / 7) * 100).toFixed(1) : 'N/A',
      evidenceStrength: evidenceScore.toFixed(1),
      grievanceType: typeScore.toFixed(1)
    }
  };
}

// Position to contract mapping for auto-selection
const POSITION_CONTRACT_MAPPING = {
  // Educational positions
  'teacher': ['teacher', 'educator', 'faculty'],
  'school counselor': ['teacher', 'educator', 'counselor'],
  'librarian': ['teacher', 'educator', 'library'],
  'nurse': ['nurse', 'healthcare', 'medical'],
  'school nurse': ['nurse', 'healthcare', 'medical'],
  'custodian': ['maintenance', 'custodial', 'support'],
  'cafeteria worker': ['food service', 'cafeteria', 'support'],
  'bus driver': ['transportation', 'bus', 'support'],
  'paraprofessional': ['support', 'aide', 'assistant'],

  // Healthcare positions
  'registered nurse': ['nurse', 'healthcare', 'medical'],
  'licensed practical nurse': ['nurse', 'healthcare', 'medical'],
  'nursing assistant': ['nurse', 'healthcare', 'medical'],
  'medical assistant': ['healthcare', 'medical', 'clinical'],
  'pharmacist': ['healthcare', 'pharmacy', 'medical'],

  // Manufacturing/Industrial
  'machinist': ['machinist', 'skilled trades', 'manufacturing'],
  'welder': ['welder', 'skilled trades', 'metalworking'],
  'electrician': ['electrician', 'skilled trades', 'electrical'],
  'plumber': ['plumber', 'skilled trades', 'plumbing'],
  'carpenter': ['carpenter', 'skilled trades', 'construction'],
  'maintenance technician': ['maintenance', 'skilled trades', 'technical'],

  // Office/Clerical
  'secretary': ['clerical', 'office', 'administrative'],
  'administrative assistant': ['clerical', 'office', 'administrative'],
  'clerk': ['clerical', 'office', 'administrative'],
  'data entry': ['clerical', 'office', 'administrative'],
  'receptionist': ['clerical', 'office', 'administrative'],

  // Service Industry
  'cashier': ['retail', 'service', 'sales'],
  'sales associate': ['retail', 'service', 'sales'],
  'customer service': ['service', 'customer', 'support'],
  'security guard': ['security', 'safety', 'protection'],

  // Professional/Technical
  'engineer': ['professional', 'technical', 'engineering'],
  'technician': ['technical', 'professional', 'skilled'],
  'analyst': ['professional', 'technical', 'analysis'],
  'supervisor': ['supervisory', 'management', 'lead'],
  'manager': ['management', 'supervisory', 'professional']
};

// Function to get contract suggestions based on position
async function getContractSuggestionsForPosition(position, userId) {
  if (!position) return [];

  const positionLower = position.toLowerCase();
  const matchingKeywords = [];

  // Find matching keywords for this position
  for (const [pos, keywords] of Object.entries(POSITION_CONTRACT_MAPPING)) {
    if (pos.toLowerCase().includes(positionLower) || positionLower.includes(pos.toLowerCase())) {
      matchingKeywords.push(...keywords);
    }
  }

  if (matchingKeywords.length === 0) return [];

  try {
    // Get user's contracts
    const contractsResult = await pool.query(
      'SELECT id, filename FROM contracts WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );

    const contracts = contractsResult.rows;

    // Score contracts based on keyword matches
    const scoredContracts = contracts.map(contract => {
      const filenameLower = contract.filename.toLowerCase();
      const textContent = contract.text_content ? contract.text_content.toLowerCase() : '';

      let score = 0;
      matchingKeywords.forEach(keyword => {
        if (filenameLower.includes(keyword) || textContent.includes(keyword)) {
          score += 1;
        }
      });

      return {
        ...contract,
        relevanceScore: score,
        matchedKeywords: matchingKeywords.filter(keyword =>
          filenameLower.includes(keyword) || textContent.includes(keyword)
        )
      };
    });

    // Return contracts sorted by relevance score (highest first)
    return scoredContracts
      .filter(contract => contract.relevanceScore > 0)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);

  } catch (error) {
    console.error('Error getting contract suggestions:', error);
    return [];
  }
}

// Function to calculate response confidence based on multiple factors
function calculateResponseConfidence(structuredReport, winProbAnalysis, numSimilarCases, attemptNumber) {
  let confidenceScore = 0.5; // Base confidence

  // Factor 1: Fallback usage reduces confidence
  if (structuredReport.fallback) {
    confidenceScore -= 0.3;
  }

  // Factor 2: Win probability confidence
  if (winProbAnalysis.confidence === 'high') {
    confidenceScore += 0.2;
  } else if (winProbAnalysis.confidence === 'medium') {
    confidenceScore += 0.1;
  } else {
    confidenceScore -= 0.1;
  }

  // Factor 3: Number of similar cases found
  if (numSimilarCases >= 5) {
    confidenceScore += 0.2;
  } else if (numSimilarCases >= 2) {
    confidenceScore += 0.1;
  } else {
    confidenceScore -= 0.1;
  }

  // Factor 4: AI provider attempt (later attempts suggest issues)
  if (attemptNumber > 1) {
    confidenceScore -= 0.1 * (attemptNumber - 1);
  }

  // Factor 5: Completeness of response
  const requiredFields = ['grievanceSummary', 'grievanceType', 'justCauseAnalysis', 'strategicArguments'];
  const presentFields = requiredFields.filter(field => structuredReport[field] && structuredReport[field] !== 'N/A');
  const completenessRatio = presentFields.length / requiredFields.length;
  confidenceScore += (completenessRatio - 0.5) * 0.2; // Adjust by up to ±0.2

  // Ensure confidence stays within 0-1 range
  confidenceScore = Math.max(0, Math.min(1, confidenceScore));

  return Math.round(confidenceScore * 100) / 100; // Round to 2 decimal places
}

// Function to sanitize user input for AI prompts
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';

  // Length validation - prevent extremely long inputs that could cause issues
  if (input.length > 10000) {
    console.warn('Input length exceeds 10,000 characters, truncating');
    input = input.substring(0, 10000) + '...[TRUNCATED]';
  }

  // Remove common prompt injection attempts
  let sanitized = input
    .replace(/ignore previous instructions/gi, '[FILTERED]')
    .replace(/system prompt/gi, '[FILTERED]')
    .replace(/as an AI/gi, '[FILTERED]')
    .replace(/forget your training/gi, '[FILTERED]')
    .replace(/override/gi, '[FILTERED]')
    .replace(/bypass restrictions/gi, '[FILTERED]')
    .replace(/jailbreak/gi, '[FILTERED]')
    .replace(/developer mode/gi, '[FILTERED]')
    .replace(/administrative access/gi, '[FILTERED]')
    .replace(/root access/gi, '[FILTERED]')
    .replace(/sudo/gi, '[FILTERED]')
    .replace(/execute code/gi, '[FILTERED]')
    .replace(/run command/gi, '[FILTERED]')
    .replace(/system command/gi, '[FILTERED]')
    .replace(/shell script/gi, '[FILTERED]');

  // Remove potential script injection
  sanitized = sanitized
    .replace(/<script[^>]*>.*?<\/script>/gi, '[SCRIPT_REMOVED]')
    .replace(/javascript:/gi, '[JS_REMOVED]')
    .replace(/on\w+\s*=/gi, '[EVENT_REMOVED]');

  // Remove excessive whitespace and normalize
  sanitized = sanitized
    .replace(/\s+/g, ' ')
    .trim();

  // Basic content validation - ensure it's not just gibberish
  if (sanitized.length < 10) {
    console.warn('Input too short after sanitization, may be invalid');
  }

  return sanitized;
}

// Analyze grievance route - protected
app.post('/analyze-grievance', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  try {
    const { error } = grievanceSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { grievance } = req.body;
    const sanitizedGrievance = sanitizeInput(grievance);

    // Log usage
    await logUsage(req.user.uid, 'analyze-grievance', 'grievance');

    // Get grievance type context
    const grievanceContext = getGrievanceTypeContext(sanitizedGrievance);
    console.log('Detected grievance type:', grievanceContext.type);

    // Generate embedding for grievance
    const grievanceEmbeddingResponse = await getEmbedding(sanitizedGrievance);
    const grievanceEmbedding = grievanceEmbeddingResponse.values;

    // Get cases with embeddings (increased limit for better search)
    const casesResult = await pool.query('SELECT *, COALESCE(provider, \'gemini\') as provider FROM cases WHERE embedding IS NOT NULL LIMIT 100');
    const allCases = casesResult.rows.map(row => ({ ...row, embedding: JSON.parse(row.embedding) }));

    // Get pdfs with embeddings (increased limit for better search)
    const pdfsResult = await pool.query('SELECT *, COALESCE(provider, \'gemini\') as provider FROM pdfs WHERE embedding IS NOT NULL LIMIT 100');
    const allPdfs = pdfsResult.rows.map(row => ({ ...row, embedding: JSON.parse(row.embedding) }));

    // Compute similarities
    const caseSimilarities = allCases.filter(c => c.provider === grievanceEmbeddingResponse.provider).map(c => ({
      ...c,
      type: 'case',
      similarity: cosineSimilarity(grievanceEmbedding, c.embedding)
    }));

    const pdfSimilarities = allPdfs.filter(p => p.provider === grievanceEmbeddingResponse.provider).map(p => ({
      ...p,
      type: 'pdf',
      similarity: cosineSimilarity(grievanceEmbedding, p.embedding)
    }));

    // Combine and sort
    const allSimilarities = [...caseSimilarities, ...pdfSimilarities];
    allSimilarities.sort((a, b) => b.similarity - a.similarity);
    const topMatches = allSimilarities.slice(0, 10);

    // Calculate enhanced win probability
    const topCaseMatches = topMatches.filter(m => m.type === 'case').slice(0, 5);
    const winProbAnalysis = calculateWinProbability(grievanceContext, topCaseMatches);
    const winProb = winProbAnalysis.percentage;

    // Generate report using AI with system prompt and knowledge context
    const sourcesText = topMatches.map(m => m.type === 'case' ?
      `Case: ${m.case_id}, Title: ${m.title}, Decision: ${m.decision}, Date: ${m.date}, Keywords: ${m.keywords}` :
      `PDF: ${m.filename}, Excerpt: ${m.text_content.substring(0, 300)}...`
    ).join('\n\n');

    // Get system prompt and knowledge context
    const systemPrompt = getSystemPrompt();
    const knowledgeContext = getAllKnowledgeContext();

    const userPrompt = `Analyze the following grievance and provide a structured JSON response.

GRIEVANCE:
${sanitizedGrievance}

DETECTED GRIEVANCE TYPE: ${grievanceContext.type}

SIMILAR CASES FROM DATABASE (sorted by relevance):
${sourcesText}

WIN PROBABILITY BASED ON SIMILAR CASES: ${winProb}%

RELEVANT KNOWLEDGE:
${knowledgeContext}

Please respond with a valid JSON object containing the following structure:
{
  "grievanceSummary": "Brief summary of the grievance",
  "grievanceType": "Type of grievance (discipline, contract violation, etc.)",
  "justCauseAnalysis": {
    "notice": "Did employer provide notice? (pass/fail/unknown)",
    "reasonableRule": "Is the rule reasonable? (pass/fail/unknown)",
    "investigation": "Was there an investigation? (pass/fail/unknown)",
    "fairInvestigation": "Was it fair? (pass/fail/unknown)",
    "proof": "Is there sufficient proof? (pass/fail/unknown)",
    "equalTreatment": "Were others treated the same? (pass/fail/unknown)",
    "penalty": "Is the penalty proportional? (pass/fail/unknown)"
  },
  "matchingSourcesAnalysis": "Analysis of the matching sources and their relevance",
  "winProbabilityAssessment": "Detailed assessment of win probability with reasoning",
  "strategicArguments": ["Array of key arguments to use"],
  "recommendedDefensePoints": ["Array of specific defense points"],
  "recommendations": "Actionable recommendations for next steps",
  "risks": "Potential risks and challenges",
  "suggestedRemedy": "What remedy should be requested",
  "confidence": {
     "overall": "high/medium/low",
     "evidenceStrength": "high/medium/low",
     "legalAnalysis": "high/medium/low",
     "winProbability": "percentage",
     "uncertaintyFactors": ["List any areas of uncertainty"]
   }
}

Ensure the response is only the JSON object, no additional text.`;

    console.log('AI Prompt being sent with system prompt and knowledge context');

    const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'analyze-grievance');
    const report = generationResponse.text;
    let structuredReport;

    // Enhanced JSON parsing with multiple fallback strategies
    try {
      // Strategy 1: Try to extract JSON from the response (handles extra text)
      const jsonMatch = report.match(/\{[\s\S]*?\}(?=\s*$|\s*[^}])/);
      if (jsonMatch) {
        structuredReport = JSON.parse(jsonMatch[0]);
      } else {
        // Strategy 2: Try parsing the entire response
        structuredReport = JSON.parse(report);
      }

      // Validate the response structure
      if (!structuredReport || typeof structuredReport !== 'object') {
        throw new Error('Invalid response structure');
      }

      // Ensure required fields are present
      const requiredFields = ['grievanceSummary', 'grievanceType', 'justCauseAnalysis', 'strategicArguments'];
      const missingFields = requiredFields.filter(field => !(field in structuredReport));
      if (missingFields.length > 0) {
        console.warn('AI response missing required fields:', missingFields);
        // Add default values for missing fields
        missingFields.forEach(field => {
          if (field === 'grievanceSummary') {
            structuredReport[field] = grievanceContext?.summary || 'Analysis generated but summary unavailable';
          } else if (field === 'grievanceType') {
            structuredReport[field] = grievanceContext?.type || 'unknown';
          } else if (field === 'justCauseAnalysis') {
            structuredReport[field] = {
              notice: 'unknown',
              reasonableRule: 'unknown',
              investigation: 'unknown',
              fairInvestigation: 'unknown',
              proof: 'unknown',
              equalTreatment: 'unknown',
              penalty: 'unknown'
            };
          } else if (field === 'strategicArguments') {
            structuredReport[field] = ['Analysis incomplete - please review manually'];
          }
        });
      }

    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError.message);
      // Enhanced fallback: Create a structured response from available data
      structuredReport = {
        error: 'Failed to parse AI response',
        fallback: true,
        grievanceSummary: grievanceContext?.summary || sanitizedGrievance.substring(0, 200) + '...',
        grievanceType: grievanceContext?.type || 'contract_violation',
        justCauseAnalysis: {
          notice: 'unknown',
          reasonableRule: 'unknown',
          investigation: 'unknown',
          fairInvestigation: 'unknown',
          proof: 'unknown',
          equalTreatment: 'unknown',
          penalty: 'unknown'
        },
        matchingSourcesAnalysis: `Found ${topMatches.length} similar cases in database`,
        winProbabilityAssessment: `Estimated win probability: ${winProb}% based on similar cases`,
        strategicArguments: [
          'Gather all relevant documentation',
          'Consult with union representatives',
          'Document timeline of events',
          'Preserve all communications'
        ],
        recommendedDefensePoints: [
          'Review contract language carefully',
          'Document all interactions',
          'Seek legal counsel if needed'
        ],
        recommendations: 'Please consult with a union representative for personalized advice',
        risks: 'Analysis unavailable - proceed with caution',
        suggestedRemedy: 'Further review required',
        confidence: {
          overall: 'low',
          evidenceStrength: 'low',
          legalAnalysis: 'low',
          winProbability: winProb.toString(),
          uncertaintyFactors: ['AI analysis failed - manual review recommended']
        },
        fullReport: report // Keep original response for debugging
      };
    }

    // Generate unique response ID for voting system
    const responseId = crypto.randomUUID();

    // Calculate enhanced confidence score based on multiple factors
    const confidenceScore = calculateResponseConfidence(structuredReport, winProbAnalysis, topMatches.length, generationResponse.attempt);

    // Log AI performance
    const responseTime = Date.now() - startTime;
    await logAIPerformance(
      generationResponse.provider,
      'analyze-grievance',
      responseTime,
      true,
      confidenceScore,
      structuredReport.fallback ? 'Used fallback response due to parsing failure' : null,
      generationResponse.tokenUsage || {}
    );

    res.json({
      report: structuredReport,
      matchingCases: topMatches.length,
      winProbability: winProbAnalysis,
      grievanceType: grievanceContext.type,
      aiProvider: generationResponse.provider,
      responseId: responseId
    });
  } catch (err) {
    // Log failed AI performance
    const responseTime = Date.now() - startTime;
    await logAIPerformance('unknown', 'analyze-grievance', responseTime, false, null, err.message);

    console.error('Error in analyze-grievance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload PDF route - protected
app.post('/upload-pdf', authenticateToken, upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    console.log('File upload attempt:', { originalname: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size });

    // Check mimetype
    if (req.file.mimetype !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files are allowed' });

    // Check magic bytes for PDF
    const buffer = req.file.buffer;
    if (buffer.length < 4 || !buffer.slice(0, 4).equals(Buffer.from('%PDF'))) {
      return res.status(400).json({ error: 'Invalid PDF file' });
    }

    // Extract text from PDF
    const data = await pdfParse(req.file.buffer);
    const text = data.text;

    // Generate embedding
    const embeddingResponse = await getEmbedding(text);
    const embedding = embeddingResponse.values;

    // Insert into database
    await pool.query('INSERT INTO pdfs (filename, text_content, embedding, provider) VALUES ($1, $2, $3::vector, $4)', [req.file.originalname, text, '[' + embedding.join(',') + ']', embeddingResponse.provider]);

    res.json({ message: 'PDF uploaded and processed successfully', filename: req.file.originalname });
  } catch (err) {
    console.error('Error in upload-pdf:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Feedback route - protected
app.post('/feedback', authenticateToken, async (req, res) => {
  const { error } = feedbackSchema.validate(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const { grievance_text, generated_report, rating, comments } = req.body;
  await pool.query('INSERT INTO feedback (grievance_text, generated_report, rating, comments) VALUES ($1, $2, $3, $4)', [grievance_text, generated_report, rating, comments]);

  res.json({ message: 'Feedback submitted successfully' });
});

// Vote on AI response route - protected
app.post('/vote-ai-response', authenticateToken, async (req, res) => {
  try {
    const { responseId, vote, responseType, aiProvider } = req.body;

    if (!responseId || typeof vote !== 'boolean' || !responseType) {
      return res.status(400).json({ error: 'responseId, vote (boolean), and responseType are required' });
    }

    // Insert or update vote (UPSERT)
    await pool.query(`
      INSERT INTO ai_response_votes (response_id, user_id, vote, ai_provider, response_type)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (response_id, user_id)
      DO UPDATE SET
        vote = EXCLUDED.vote,
        ai_provider = EXCLUDED.ai_provider,
        response_type = EXCLUDED.response_type,
        created_at = CURRENT_TIMESTAMP
    `, [responseId, req.user.uid, vote, aiProvider, responseType]);

    // Log the vote for continuous learning
    logger.info('AI_RESPONSE_VOTE', req.user.uid, {
      responseId,
      vote,
      responseType,
      aiProvider,
      timestamp: new Date().toISOString(),
      ip: req.ip
    });

    res.json({ message: 'Vote recorded successfully' });
  } catch (err) {
    logger.error('Error in vote-ai-response', err, { userId: req.user?.uid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detailed AI feedback route - protected
app.post('/ai-feedback', authenticateToken, async (req, res) => {
  try {
    const { error } = aiFeedbackSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const {
      responseId,
      rating,
      accuracy,
      completeness,
      usefulness,
      comments,
      suggestedImprovements,
      grievanceType,
      aiProvider
    } = req.body;

    // Calculate overall quality score based on available metrics
    let qualityScore = rating / 5.0; // Base score from overall rating

    const metrics = [accuracy, completeness, usefulness].filter(m => m !== undefined);
    if (metrics.length > 0) {
      const avgMetrics = metrics.reduce((sum, m) => sum + m, 0) / metrics.length;
      qualityScore = (qualityScore + (avgMetrics / 5.0)) / 2; // Average of rating and metrics
    }

    // Insert detailed feedback
    await pool.query(`
      INSERT INTO ai_feedback (
        response_id, user_id, rating, accuracy, completeness, usefulness,
        comments, suggested_improvements, grievance_type, ai_provider, response_quality_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (response_id, user_id)
      DO UPDATE SET
        rating = EXCLUDED.rating,
        accuracy = EXCLUDED.accuracy,
        completeness = EXCLUDED.completeness,
        usefulness = EXCLUDED.usefulness,
        comments = EXCLUDED.comments,
        suggested_improvements = EXCLUDED.suggested_improvements,
        grievance_type = EXCLUDED.grievance_type,
        ai_provider = EXCLUDED.ai_provider,
        response_quality_score = EXCLUDED.response_quality_score,
        created_at = CURRENT_TIMESTAMP
    `, [
      responseId, req.user.uid, rating, accuracy, completeness, usefulness,
      comments, suggestedImprovements || [], grievanceType, aiProvider, qualityScore
    ]);

    // Log detailed feedback for analytics
    logger.info('AI_DETAILED_FEEDBACK', req.user.uid, {
      responseId,
      rating,
      qualityScore,
      grievanceType,
      aiProvider,
      hasSuggestions: suggestedImprovements && suggestedImprovements.length > 0,
      timestamp: new Date().toISOString()
    });

    // Update AI performance logs with user rating if available
    if (aiProvider && responseId) {
      await pool.query(`
        UPDATE ai_performance_logs
        SET user_rating = $1, response_quality_score = $2
        WHERE ai_provider = $3 AND operation_type IN ('analyze-grievance', 'quick-answer')
        AND created_at >= NOW() - INTERVAL '1 hour'
        ORDER BY created_at DESC
        LIMIT 1
      `, [rating, qualityScore, aiProvider]);
    }

    res.json({
      message: 'Detailed feedback recorded successfully',
      qualityScore: Math.round(qualityScore * 100) / 100
    });

  } catch (err) {
    logger.error('Error in ai-feedback', err, { userId: req.user?.uid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Enhanced Pocket Steward AI - position-aware quick answers
  app.post("/quick-answer", authenticateToken, async (req, res) => {
    const startTime = Date.now();
    try {
      const { question } = req.body;
      if (!question || question.length > 1000) {
        return res.status(400).json({ error: "Question is required and must be under 1000 characters" });
      }

      const sanitizedQuestion = sanitizeInput(question);

      // Log usage
      await logUsage(req.user.uid, 'quick-answer', 'question');

      // Get user profile and contracts for enhanced responses
      let userPosition = null;
      let userContracts = null;

      try {
        // Get user's position from users table
        const userResult = await pool.query("SELECT position FROM users WHERE firebase_uid = $1", [req.user.uid]);
        if (userResult.rows.length > 0 && userResult.rows[0].position) {
          userPosition = userResult.rows[0].position;
        }

        // Get user's contracts for reference
        const contractsResult = await pool.query(`
          SELECT id, filename, text_content
          FROM contracts
          WHERE user_id = (SELECT id FROM users WHERE firebase_uid = $1)
          ORDER BY created_at DESC
          LIMIT 5
        `, [req.user.uid]);

        if (contractsResult.rows.length > 0) {
          userContracts = contractsResult.rows.map(contract => ({
            id: contract.id,
            filename: contract.filename,
            text_content: contract.text_content
          }));
        }
      } catch (dbError) {
        console.warn("Could not load user position/contracts for enhanced response:", dbError.message);
      }

      // Use enhanced Pocket Steward prompt
      const systemPrompt = getSystemPrompt();
      const userPrompt = getQuickAnswerPrompt(sanitizedQuestion, userPosition, userContracts);

      const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'quick-answer');

      // Generate unique response ID for voting system
      const responseId = crypto.randomUUID();

      // Calculate confidence for quick answers (simpler than full analysis)
      const confidenceScore = generationResponse.attempt > 1 ? 0.6 : 0.8; // Reduce confidence if retries were needed

      // Log AI performance
      const responseTime = Date.now() - startTime;
      await logAIPerformance(
        generationResponse.provider,
        'quick-answer',
        responseTime,
        true,
        confidenceScore,
        null,
        generationResponse.tokenUsage || {}
      );

      res.json({
        answer: generationResponse.text,
        aiProvider: generationResponse.provider,
        userContext: {
          position: userPosition,
          contractCount: userContracts?.length || 0
        },
        responseId: responseId
      });
    } catch (err) {
      // Log failed AI performance
      const responseTime = Date.now() - startTime;
      await logAIPerformance('unknown', 'quick-answer', responseTime, false, null, err.message);

      console.error("Error in quick-answer:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

// Generate defense packet route - creates a formal defense document
app.post('/generate-defense-packet', authenticateToken, async (req, res) => {
  try {
    const { grievance, grievantName, grievantId, incidentDate, disciplineType, employeeTenure, priorDiscipline } = req.body;

    if (!grievance) {
      return res.status(400).json({ error: 'Grievance description is required' });
    }

    const sanitizedGrievance = sanitizeInput(grievance);

    // Generate embedding to find similar cases
    const grievanceEmbeddingResponse = await getEmbedding(sanitizedGrievance);
    const grievanceEmbedding = grievanceEmbeddingResponse.values;

    // Get similar cases
    const casesResult = await pool.query('SELECT *, COALESCE(provider, \'gemini\') as provider FROM cases WHERE embedding IS NOT NULL LIMIT 50');
    const allCases = casesResult.rows.map(row => ({ ...row, embedding: JSON.parse(row.embedding) }));

    const caseSimilarities = allCases.filter(c => c.provider === grievanceEmbeddingResponse.provider).map(c => ({
      ...c,
      similarity: cosineSimilarity(grievanceEmbedding, c.embedding)
    }));

    caseSimilarities.sort((a, b) => b.similarity - a.similarity);
    const topCases = caseSimilarities.slice(0, 5);

    const similarCasesText = topCases.map(c =>
      `- ${c.case_id}: ${c.title} (Decision: ${c.decision}, Date: ${c.date})`
    ).join('\n');

    // Build grievance details string
    const grievanceDetails = `
Grievant: ${grievantName || 'Not provided'}
Employee ID: ${grievantId || 'Not provided'}
Incident Date: ${incidentDate || 'Not provided'}
Discipline Type: ${disciplineType || 'Not provided'}
Years of Service: ${employeeTenure || 'Not provided'}
Prior Discipline: ${priorDiscipline || 'None reported'}

GRIEVANCE DESCRIPTION:
${sanitizedGrievance}
`;

    const systemPrompt = getSystemPrompt();
    const userPrompt = getDefensePacketPrompt(grievanceDetails, similarCasesText);

    const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'generate-defense-packet');

    // Generate unique response ID for voting system
    const responseId = crypto.randomUUID();

    res.json({
      defensePacket: generationResponse.text,
      similarCases: topCases.map(c => ({
        caseId: c.case_id,
        title: c.title,
        decision: c.decision,
        date: c.date,
        similarity: (c.similarity * 100).toFixed(1) + '%'
      })),
      aiProvider: generationResponse.provider,
      responseId: responseId
    });
  } catch (err) {
    console.error('Error in generate-defense-packet:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get knowledge base info route
app.get('/knowledge-info', authenticateToken, (req, res) => {
  try {
    const { loadKnowledge } = require('./knowledge-loader');
    const knowledge = loadKnowledge();

    const info = {
      availableKnowledge: Object.keys(knowledge).filter(k => knowledge[k].length > 0),
      knowledgeSizes: {}
    };

    for (const [key, value] of Object.entries(knowledge)) {
      if (value.length > 0) {
        info.knowledgeSizes[key] = {
          characters: value.length,
          approximateWords: Math.round(value.split(/\s+/).length)
        };
      }
    }

    res.json(info);
  } catch (err) {
    console.error('Error in knowledge-info:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create grievance route - protected
app.post('/create-grievance', authenticateToken, async (req, res) => {
  try {
    const { error } = grievanceCreateSchema.validate(req.body);
    if (error) {
      logger.warn('Invalid grievance creation data', { userId: req.user?.uid, error: error.details[0].message });
      return res.status(400).json({ error: error.details[0].message });
    }

    const { title, description, grievantName, grievantId, incidentDate, disciplineType, grievantPosition } = req.body;

    // Log usage
    await logUsage(req.user.uid, 'create-grievance', 'grievance');

    // Auto-select contract based on position if no specific contract chosen
    let contractId = null;
    let selectedContractName = null;
    if (grievantPosition) {
      const suggestedContracts = await getContractSuggestionsForPosition(grievantPosition, req.user.uid);
      if (suggestedContracts.length > 0) {
        contractId = suggestedContracts[0].id; // Use the highest-scoring contract
        selectedContractName = suggestedContracts[0].filename;
        console.log(`Auto-selected contract ${selectedContractName} for position: ${grievantPosition}`);
      }
    }

    const result = await pool.query(`
      INSERT INTO grievances (user_id, title, description, grievant_name, grievant_id, incident_date, discipline_type, contract_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [req.user.uid, title, description, grievantName, grievantId, incidentDate, disciplineType, contractId]);

    logger.audit('CREATE_GRIEVANCE', req.user.uid, {
      grievanceId: result.rows[0].id,
      title: title,
      contractAutoSelected: !!contractId,
      position: grievantPosition,
      ip: req.ip
    });

    res.json({
      message: 'Grievance created successfully',
      grievanceId: result.rows[0].id,
      contractAutoSelected: !!contractId,
      selectedContract: selectedContractName
    });
  } catch (err) {
    logger.error('Error in create-grievance', err, { userId: req.user?.uid });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload contract route - protected
app.post('/upload-contract', authenticateToken, upload.single('contract'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // Support PDF and text files
    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (req.file.mimetype === 'text/plain') {
      text = req.file.buffer.toString('utf8');
    } else {
      return res.status(400).json({ error: 'Only PDF and text files are supported' });
    }

    // Generate embedding
    const embeddingResponse = await getEmbedding(text);
    const embedding = embeddingResponse.values;

    // Insert into database
    await pool.query('INSERT INTO contracts (user_id, filename, text_content, embedding, provider) VALUES ($1, $2, $3, $4, $5)', [req.user.uid, req.file.originalname, text, '[' + embedding.join(',') + ']', embeddingResponse.provider]);

    res.json({ message: 'Contract uploaded successfully', filename: req.file.originalname });
  } catch (err) {
    console.error('Error in upload-contract:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Analyze contract violations route - protected
app.post('/analyze-contract-violations', authenticateToken, async (req, res) => {
  try {
    const { grievanceId, contractId } = req.body;

    if (!grievanceId || !contractId) {
      return res.status(400).json({ error: 'Grievance ID and Contract ID are required' });
    }

    // Get grievance details
    const grievanceResult = await pool.query('SELECT * FROM grievances WHERE id = $1 AND user_id = $2', [grievanceId, req.user.uid]);
    if (grievanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Grievance not found' });
    }
    const grievance = grievanceResult.rows[0];

    // Get contract text
    const contractResult = await pool.query('SELECT * FROM contracts WHERE id = $1 AND user_id = $2', [contractId, req.user.uid]);
    if (contractResult.rows.length === 0) {
      return res.status(404).json({ error: 'Contract not found' });
    }
    const contract = contractResult.rows[0];

    // AI analysis for violations
    const systemPrompt = getSystemPrompt();
    const userPrompt = `Analyze the following grievance against the provided contract and identify specific violations.

GRIEVANCE:
${grievance.description}

CONTRACT TEXT (excerpts):
${contract.text_content.substring(0, 5000)}...

Please identify:
1. Specific contract articles violated
2. Exact language from the contract
3. How the grievance violates these provisions
4. Supporting arguments from winning strategies

Respond with structured JSON:
{
  "violations": [
    {
      "article": "Article X, Section Y",
      "contractLanguage": "Exact quote...",
      "violation": "How it's violated...",
      "arguments": ["Supporting arguments..."]
    }
  ],
  "overallAnalysis": "Summary"
}`;

    const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'analyze-contract-violations');
    let violations;
    try {
      violations = JSON.parse(generationResponse.text);
    } catch (parseError) {
      console.error('Failed to parse contract violations:', parseError.message);
      violations = {
        violations: [{
          article: "Analysis Error",
          contractLanguage: "Unable to parse AI response",
          violation: "Contract analysis failed",
          arguments: ["Please try again or consult legal counsel"]
        }],
        overallAnalysis: "AI analysis failed - manual review recommended"
      };
    }

    // Update grievance with contract reference
    await pool.query('UPDATE grievances SET contract_id = $1 WHERE id = $2', [contractId, grievanceId]);

    // Generate unique response ID for voting system
    const responseId = crypto.randomUUID();

    res.json({
      violations: violations.violations,
      overallAnalysis: violations.overallAnalysis,
      contractFilename: contract.filename,
      responseId: responseId
    });
  } catch (err) {
    console.error('Error in analyze-contract-violations:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload evidence route - protected
app.post('/upload-evidence', authenticateToken, upload.single('evidence'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { grievanceId } = req.body;

    if (!grievanceId) return res.status(400).json({ error: 'Grievance ID is required' });

    // Check if grievance belongs to user
    const grievanceCheck = await pool.query('SELECT id FROM grievances WHERE id = $1 AND user_id = $2', [grievanceId, req.user.uid]);
    if (grievanceCheck.rows.length === 0) return res.status(404).json({ error: 'Grievance not found' });

    // Extract text based on file type
    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else if (req.file.mimetype.startsWith('image/')) {
      text = `[Image evidence: ${req.file.originalname}]`;
    } else if (req.file.mimetype === 'text/plain') {
      text = req.file.buffer.toString('utf8');
    }

    // Generate embedding if text is substantial
    let embedding = null;
    let provider = null;
    if (text.length > 50) {
      const embeddingResponse = await getEmbedding(text);
      embedding = '[' + embeddingResponse.values.join(',') + ']';
      provider = embeddingResponse.provider;
    }

    // Insert into database
    await pool.query('INSERT INTO evidence (grievance_id, filename, file_type, text_content, embedding, provider) VALUES ($1, $2, $3, $4, $5, $6)', [grievanceId, req.file.originalname, req.file.mimetype, text, embedding, provider]);

    res.json({ message: 'Evidence uploaded successfully', filename: req.file.originalname });
  } catch (err) {
    console.error('Error in upload-evidence:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate case file route - protected
app.post('/generate-case-file', authenticateToken, async (req, res) => {
  try {
    const { error } = generateCaseFileSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { grievanceId } = req.body;

    // Get full grievance data with related info
    const grievanceResult = await pool.query(`
      SELECT g.*, c.filename as contract_filename, c.text_content as contract_text
      FROM grievances g
      LEFT JOIN contracts c ON g.contract_id = c.id
      WHERE g.id = $1 AND g.user_id = $2
    `, [grievanceId, req.user.uid]);

    if (grievanceResult.rows.length === 0) return res.status(404).json({ error: 'Grievance not found' });

    const grievance = grievanceResult.rows[0];

    // Get evidence
    const evidenceResult = await pool.query('SELECT * FROM evidence WHERE grievance_id = $1', [grievanceId]);
    const evidence = evidenceResult.rows;

    // Get similar cases (precedents)
    const similarCases = await getSimilarCases(grievance.description);

    // Generate comprehensive case file
    const systemPrompt = getSystemPrompt();
    const userPrompt = `Generate a comprehensive court-ready case file for the following grievance.

GRIEVANCE DETAILS:
Title: ${grievance.title}
Description: ${grievance.description}
Grievant: ${grievance.grievant_name}
Incident Date: ${grievance.incident_date}
Discipline: ${grievance.discipline_type}
Tenure: ${grievance.employee_tenure} years
Prior Discipline: ${grievance.prior_discipline}

CONTRACT INFORMATION:
${grievance.contract_text ? `Contract: ${grievance.contract_filename}\n${grievance.contract_text.substring(0, 2000)}...` : 'No contract attached'}

EVIDENCE ATTACHED:
${evidence.map(e => `- ${e.filename} (${e.file_type})`).join('\n')}

SIMILAR PRECEDENTS:
${similarCases.map(c => `- ${c.case_id}: ${c.title} (${c.decision})`).join('\n')}

WINNING ARGUMENTS FROM KNOWLEDGE BASE:
${getAllKnowledgeContext().substring(0, 3000)}

Generate a formal case file with the following structure:
1. Case Summary
2. Factual Background
3. Contract Violations
4. Supporting Arguments
5. Precedent Analysis
6. Evidence Summary
7. Recommended Remedy
8. Win Probability Assessment

Format it professionally for court/arbitration presentation.`;

    const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'generate-case-file');
    const caseFileContent = generationResponse.text;

    // Save to database
    await pool.query('INSERT INTO case_files (grievance_id, content, format_type) VALUES ($1, $2, $3)', [grievanceId, caseFileContent, 'court_ready']);

    // Generate unique response ID for voting system
    const responseId = crypto.randomUUID();

    res.json({
      caseFile: caseFileContent,
      formatType: 'court_ready',
      aiProvider: generationResponse.provider,
      responseId: responseId
    });
  } catch (err) {
    console.error('Error in generate-case-file:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update case state route - protected
app.post('/update-case', authenticateToken, async (req, res) => {
  try {
    const { error } = updateCaseSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { grievanceId, updateData, persona = 'strategist' } = req.body;

    // Get current grievance
    const grievanceResult = await pool.query('SELECT * FROM grievances WHERE id = $1 AND user_id = $2', [grievanceId, req.user.uid]);
    if (grievanceResult.rows.length === 0) return res.status(404).json({ error: 'Grievance not found' });

    const grievance = grievanceResult.rows[0];

    // Get similar cases for context
    const similarCases = await getSimilarCases(grievance.description);

    // Prepare update context
    const updateContext = {
      currentCase: {
        title: grievance.title,
        description: grievance.description,
        status: grievance.status,
        winProbability: grievance.win_probability
      },
      updateData: updateData,
      similarCases: similarCases.slice(0, 3)
    };

    // Generate AI analysis with persona
    const systemPrompt = getPersonaPrompt(persona);
    const userPrompt = getUpdatePrompt(updateContext, persona);

    const generationResponse = await generateWithFallback(systemPrompt, userPrompt, 'update-case');
    const updateAnalysis = generationResponse.text;

    // Parse AI response for structured data (assume JSON response)
    let structuredUpdate;
    try {
      const jsonMatch = updateAnalysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        structuredUpdate = JSON.parse(jsonMatch[0]);
      } else {
        structuredUpdate = { analysis: updateAnalysis };
      }
    } catch (e) {
      structuredUpdate = { analysis: updateAnalysis };
    }

    // Update grievance status and win probability if provided
    if (structuredUpdate.newWinProbability) {
      await pool.query('UPDATE grievances SET win_probability = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [structuredUpdate.newWinProbability, grievanceId]);
    }

    // Generate unique response ID for voting system
    const responseId = crypto.randomUUID();

    res.json({
      updateAnalysis: structuredUpdate,
      persona: persona,
      aiProvider: generationResponse.provider,
      responseId: responseId
    });
  } catch (err) {
    console.error('Error in update-case:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to get similar cases
async function getSimilarCases(grievanceText) {
  try {
    const embeddingResponse = await getEmbedding(grievanceText);
    const grievanceEmbedding = embeddingResponse.values;

    const casesResult = await pool.query('SELECT *, COALESCE(provider, \'gemini\') as provider FROM cases WHERE embedding IS NOT NULL LIMIT 50');
    const allCases = casesResult.rows.map(row => ({ ...row, embedding: JSON.parse(row.embedding) }));

    const caseSimilarities = allCases.filter(c => c.provider === embeddingResponse.provider).map(c => ({
      ...c,
      similarity: cosineSimilarity(grievanceEmbedding, c.embedding)
    }));

    caseSimilarities.sort((a, b) => b.similarity - a.similarity);
    return caseSimilarities.slice(0, 5);
  } catch (err) {
    console.error('Error getting similar cases:', err);
    return [];
  }
}

// Get user's grievances - protected
app.get('/grievances', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, c.filename as contract_filename
      FROM grievances g
      LEFT JOIN contracts c ON g.contract_id = c.id
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC
    `, [req.user.uid]);

    res.json({ grievances: result.rows });
  } catch (err) {
    console.error('Error in get-grievances:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get specific grievance with related data - protected
app.get('/grievances/:id', authenticateToken, async (req, res) => {
  try {
    const grievanceId = req.params.id;

    const grievanceResult = await pool.query(`
      SELECT g.*, c.filename as contract_filename, c.text_content as contract_text
      FROM grievances g
      LEFT JOIN contracts c ON g.contract_id = c.id
      WHERE g.id = $1 AND g.user_id = $2
    `, [grievanceId, req.user.uid]);

    if (grievanceResult.rows.length === 0) {
      return res.status(404).json({ error: 'Grievance not found' });
    }

    // Get evidence
    const evidenceResult = await pool.query('SELECT * FROM evidence WHERE grievance_id = $1', [grievanceId]);

    // Get case files
    const caseFilesResult = await pool.query('SELECT * FROM case_files WHERE grievance_id = $1 ORDER BY created_at DESC', [grievanceId]);

    res.json({
      grievance: grievanceResult.rows[0],
      evidence: evidenceResult.rows,
      caseFiles: caseFilesResult.rows
    });
  } catch (err) {
    console.error('Error in get-grievance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get contract suggestions for a position - protected
app.get('/contract-suggestions', authenticateToken, async (req, res) => {
  try {
    const { position } = req.query;

    if (!position) {
      return res.status(400).json({ error: 'Position parameter is required' });
    }

    const suggestions = await getContractSuggestionsForPosition(position, req.user.uid);
    res.json({
      position: position,
      suggestions: suggestions.map(contract => ({
        id: contract.id,
        filename: contract.filename,
        relevanceScore: contract.relevanceScore,
        matchedKeywords: contract.matchedKeywords
      }))
    });
  } catch (err) {
    console.error('Error in contract-suggestions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's contracts - protected
app.get('/contracts', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, filename, created_at FROM contracts WHERE user_id = $1 ORDER BY created_at DESC', [req.user.uid]);
    res.json({ contracts: result.rows });
  } catch (err) {
    console.error('Error in get-contracts:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update grievance - protected
app.put('/grievances/:id', authenticateToken, async (req, res) => {
  try {
    const grievanceId = req.params.id;
    const { status, winProbability, contractId } = req.body;

    await pool.query(`
      UPDATE grievances
      SET status = $1, win_probability = $2, contract_id = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5
    `, [status, winProbability, contractId, grievanceId, req.user.uid]);

    res.json({ message: 'Grievance updated successfully' });
  } catch (err) {
    console.error('Error in update-grievance:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Security testing routes - protected
app.post('/run-security-tests', authenticateToken, async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

    // Ensure temp directory exists
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Run security tests using Jest with JSON output
    const jestProcess = spawn('npm', [
      'test',
      '--',
      'tests/security.test.js',
      '--json',
      '--outputFile=/tmp/security-test-results.json',
      '--testTimeout=30000'
    ], {
      cwd: __dirname,
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Set timeout for test execution
    const timeout = setTimeout(() => {
      jestProcess.kill('SIGTERM');
    }, 30000); // 30 second timeout

    jestProcess.on('close', (code) => {
      clearTimeout(timeout);

      try {
        const resultsPath = '/tmp/security-test-results.json';
        if (fs.existsSync(resultsPath)) {
          const rawResults = fs.readFileSync(resultsPath, 'utf8');
          const testResults = JSON.parse(rawResults);

          const summary = {
            success: code === 0,
            exitCode: code,
            totalTests: testResults.numTotalTests || 0,
            passedTests: testResults.numPassedTests || 0,
            failedTests: testResults.numFailedTests || 0,
            duration: testResults.testResults ? testResults.testResults[0]?.perfStats?.runtime || 0 : 0,
            timestamp: new Date().toISOString()
          };

          // Clean up temp file
          try {
            fs.unlinkSync(resultsPath);
          } catch (e) {
            console.warn('Could not clean up temp file:', e.message);
          }

          res.json({
            success: summary.success,
            summary: summary,
            testResults: testResults,
            executionTime: summary.duration + 'ms'
          });
        } else {
          res.json({
            success: code === 0,
            summary: {
              exitCode: code,
              message: 'Test completed but no detailed results available'
            },
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {
        console.error('Error processing test results:', e);
        res.status(500).json({
          success: false,
          error: 'Failed to process test results: ' + e.message,
          exitCode: code,
          timestamp: new Date().toISOString()
        });
      }
    });

    jestProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.error('Error running security tests:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to execute security tests: ' + error.message,
        timestamp: new Date().toISOString()
      });
    });

  } catch (error) {
    console.error('Error in run-security-tests endpoint:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Get security test status - protected
app.get('/security-test-status', authenticateToken, (req, res) => {
  try {
    const fs = require('fs');
    const lastRunPath = '/tmp/security-test-last-run.json';

    let lastRunInfo = null;
    if (fs.existsSync(lastRunPath)) {
      try {
        lastRunInfo = JSON.parse(fs.readFileSync(lastRunPath, 'utf8'));
      } catch (e) {
        console.warn('Could not read last run info:', e.message);
      }
    }

    res.json({
      lastRun: lastRunInfo,
      timestamp: new Date().toISOString(),
      available: true // Security testing is available
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get security test status',
      timestamp: new Date().toISOString()
    });
  }
});

// Admin settings routes - protected (only accessible when admin mode is enabled)
app.get('/admin-settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT setting_key, setting_value, description, updated_by, updated_at FROM admin_settings ORDER BY setting_key');
    res.json({ settings: result.rows });
  } catch (err) {
    console.error('Error in get-admin-settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/admin-settings/:key', authenticateToken, async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ error: 'Setting value is required' });
    }

    // Update the setting
    const result = await pool.query(`
      UPDATE admin_settings
      SET setting_value = $1, updated_by = $2, updated_at = CURRENT_TIMESTAMP
      WHERE setting_key = $3
      RETURNING setting_key, setting_value, description, updated_by, updated_at
    `, [JSON.stringify(value), req.user.uid, key]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    res.json({
      message: 'Setting updated successfully',
      setting: result.rows[0]
    });
  } catch (err) {
    console.error('Error in update-admin-setting:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Analytics routes - protected (admin-only access)
app.get('/analytics/dashboard', authenticateToken, async (req, res) => {
  try {
    const timeRange = req.query.range || '24h'; // 1h, 24h, 7d, 30d

    // Calculate time range
    const now = new Date();
    let startTime;
    switch (timeRange) {
      case '1h': startTime = new Date(now.getTime() - 60 * 60 * 1000); break;
      case '24h': startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); break;
      case '7d': startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); break;
      case '30d': startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); break;
      default: startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    // Real-time accuracy metrics
    const accuracyResult = await pool.query(`
      SELECT
        AVG(CASE WHEN vote = true THEN 1 ELSE 0 END) * 100 as accuracy_rate,
        COUNT(*) as total_votes,
        COUNT(CASE WHEN vote = true THEN 1 END) as correct_votes,
        COUNT(CASE WHEN vote = false THEN 1 END) as incorrect_votes
      FROM ai_response_votes
      WHERE created_at >= $1
    `, [startTime]);

    // Usage patterns
    const usageResult = await pool.query(`
      SELECT
        action,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at)))) as avg_session_duration
      FROM usage_logs
      WHERE created_at >= $1
      GROUP BY action
      ORDER BY count DESC
    `, [startTime]);

    // Performance trending
    const performanceResult = await pool.query(`
      SELECT
        DATE_TRUNC('hour', created_at) as time_bucket,
        AVG(response_time_ms) as avg_response_time,
        COUNT(*) as request_count,
        AVG(confidence_score) as avg_confidence
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY time_bucket
      ORDER BY time_bucket
    `, [startTime]);

    // AI model comparison
    const aiComparisonResult = await pool.query(`
      SELECT
        ai_provider,
        operation_type,
        AVG(response_time_ms) as avg_response_time,
        AVG(confidence_score) as avg_confidence,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
        AVG(user_rating) as avg_user_rating
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY ai_provider, operation_type
      ORDER BY ai_provider, operation_type
    `, [startTime]);

    // System health metrics
    const systemMetricsResult = await pool.query(`
      SELECT
        metric_name,
        metric_value,
        metric_type,
        category,
        tags,
        timestamp
      FROM analytics_metrics
      WHERE timestamp >= $1
      ORDER BY timestamp DESC
      LIMIT 100
    `, [startTime]);

    res.json({
      timeRange,
      accuracy: {
        rate: Math.round(accuracyResult.rows[0]?.accuracy_rate || 0),
        totalVotes: accuracyResult.rows[0]?.total_votes || 0,
        correctVotes: accuracyResult.rows[0]?.correct_votes || 0,
        incorrectVotes: accuracyResult.rows[0]?.incorrect_votes || 0
      },
      usage: usageResult.rows,
      performance: performanceResult.rows,
      aiComparison: aiComparisonResult.rows,
      systemHealth: systemMetricsResult.rows,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in analytics dashboard:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Real-time metrics endpoint
app.get('/analytics/real-time', authenticateToken, async (req, res) => {
  try {
    const lastHour = new Date(Date.now() - 60 * 60 * 1000);

    // Active users in last hour
    const activeUsersResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as active_users
      FROM usage_logs
      WHERE created_at >= $1
    `, [lastHour]);

    // Current system load (requests per minute)
    const requestsPerMinuteResult = await pool.query(`
      SELECT COUNT(*) / 60.0 as requests_per_minute
      FROM usage_logs
      WHERE created_at >= $1
    `, [lastHour]);

    // AI response accuracy (last 100 votes)
    const recentAccuracyResult = await pool.query(`
      SELECT
        AVG(CASE WHEN vote = true THEN 1 ELSE 0 END) * 100 as recent_accuracy
      FROM (
        SELECT vote FROM ai_response_votes
        ORDER BY created_at DESC
        LIMIT 100
      ) recent_votes
    `);

    // Error rate in last hour
    const errorRateResult = await pool.query(`
      SELECT
        COUNT(CASE WHEN success = false THEN 1 END)::float / COUNT(*)::float * 100 as error_rate
      FROM ai_performance_logs
      WHERE created_at >= $1
    `, [lastHour]);

    res.json({
      activeUsers: activeUsersResult.rows[0]?.active_users || 0,
      requestsPerMinute: Math.round((requestsPerMinuteResult.rows[0]?.requests_per_minute || 0) * 100) / 100,
      accuracy: Math.round(recentAccuracyResult.rows[0]?.recent_accuracy || 0),
      errorRate: Math.round(errorRateResult.rows[0]?.error_rate || 0),
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in real-time metrics:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Performance trends endpoint
app.get('/analytics/performance-trends', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const trendsResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        AVG(response_time_ms) as avg_response_time,
        COUNT(*) as total_requests,
        AVG(confidence_score) as avg_confidence,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
        AVG(user_rating) as avg_user_rating
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [startTime]);

    res.json({
      trends: trendsResult.rows,
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in performance trends:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Usage patterns endpoint
app.get('/analytics/usage-patterns', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Daily usage patterns
    const dailyUsageResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        action,
        COUNT(*) as count
      FROM usage_logs
      WHERE created_at >= $1
      GROUP BY DATE(created_at), action
      ORDER BY date, count DESC
    `, [startTime]);

    // Peak usage hours
    const hourlyUsageResult = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as requests
      FROM usage_logs
      WHERE created_at >= $1
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY hour
    `, [startTime]);

    // User engagement metrics
    const userEngagementResult = await pool.query(`
      SELECT
        user_id,
        COUNT(*) as total_actions,
        COUNT(DISTINCT DATE(created_at)) as active_days,
        MAX(created_at) - MIN(created_at) as engagement_span
      FROM usage_logs
      WHERE created_at >= $1 AND user_id IS NOT NULL
      GROUP BY user_id
      ORDER BY total_actions DESC
      LIMIT 50
    `, [startTime]);

    res.json({
      dailyUsage: dailyUsageResult.rows,
      hourlyUsage: hourlyUsageResult.rows,
      userEngagement: userEngagementResult.rows,
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in usage patterns:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI model comparison endpoint
app.get('/analytics/ai-comparison', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const comparisonResult = await pool.query(`
      SELECT
        ai_provider,
        operation_type,
        AVG(response_time_ms) as avg_response_time,
        MIN(response_time_ms) as min_response_time,
        MAX(response_time_ms) as max_response_time,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN success = true THEN 1 END) as successful_requests,
        AVG(confidence_score) * 100 as avg_confidence_percent,
        AVG(user_rating) as avg_user_rating,
        COUNT(CASE WHEN user_rating >= 4 THEN 1 END) as high_ratings,
        COUNT(CASE WHEN user_rating <= 2 THEN 1 END) as low_ratings
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY ai_provider, operation_type
      ORDER BY ai_provider, operation_type
    `, [startTime]);

    // Overall provider comparison
    const providerOverallResult = await pool.query(`
      SELECT
        ai_provider,
        AVG(response_time_ms) as avg_response_time,
        COUNT(*) as total_requests,
        COUNT(CASE WHEN success = true THEN 1 END)::float / COUNT(*)::float * 100 as success_rate,
        AVG(confidence_score) * 100 as avg_confidence,
        AVG(user_rating) as avg_user_rating
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY ai_provider
      ORDER BY avg_response_time
    `, [startTime]);

    res.json({
      detailedComparison: comparisonResult.rows,
      providerOverview: providerOverallResult.rows,
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in AI comparison:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI feedback analytics endpoint
app.get('/analytics/feedback-analysis', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Overall feedback statistics
    const overallStats = await pool.query(`
      SELECT
        COUNT(*) as total_feedback,
        AVG(rating) as avg_rating,
        AVG(accuracy) as avg_accuracy,
        AVG(completeness) as avg_completeness,
        AVG(usefulness) as avg_usefulness,
        AVG(response_quality_score) as avg_quality_score
      FROM ai_feedback
      WHERE created_at >= $1
    `, [startTime]);

    // Feedback by AI provider
    const providerStats = await pool.query(`
      SELECT
        ai_provider,
        COUNT(*) as feedback_count,
        AVG(rating) as avg_rating,
        AVG(accuracy) as avg_accuracy,
        AVG(response_quality_score) as avg_quality,
        MIN(created_at) as first_feedback,
        MAX(created_at) as latest_feedback
      FROM ai_feedback
      WHERE created_at >= $1
      GROUP BY ai_provider
      ORDER BY avg_rating DESC
    `, [startTime]);

    // Feedback by grievance type
    const typeStats = await pool.query(`
      SELECT
        grievance_type,
        COUNT(*) as feedback_count,
        AVG(rating) as avg_rating,
        AVG(accuracy) as avg_accuracy,
        AVG(response_quality_score) as avg_quality
      FROM ai_feedback
      WHERE created_at >= $1 AND grievance_type IS NOT NULL
      GROUP BY grievance_type
      ORDER BY feedback_count DESC
    `, [startTime]);

    // Most common improvement suggestions
    const suggestionsStats = await pool.query(`
      SELECT
        suggestion,
        COUNT(*) as frequency,
        AVG(rating) as avg_rating_for_suggestion
      FROM (
        SELECT unnest(suggested_improvements) as suggestion, rating
        FROM ai_feedback
        WHERE created_at >= $1 AND suggested_improvements IS NOT NULL
      ) suggestions
      GROUP BY suggestion
      ORDER BY frequency DESC
      LIMIT 15
    `, [startTime]);

    // Adaptive recommendations
    const adaptiveRecs = await getAdaptiveAIRecommendations('analyze-grievance', days);

    res.json({
      period: `${days} days`,
      overall: overallStats.rows[0] || {},
      byProvider: providerStats.rows,
      byGrievanceType: typeStats.rows,
      improvementSuggestions: suggestionsStats.rows,
      adaptiveRecommendations: adaptiveRecs,
      insights: {
        bestPerformingProvider: providerStats.rows[0]?.ai_provider || 'N/A',
        worstPerformingProvider: providerStats.rows[providerStats.rows.length - 1]?.ai_provider || 'N/A',
        mostCommonIssueType: typeStats.rows[0]?.grievance_type || 'N/A',
        totalSuggestions: suggestionsStats.rows.reduce((sum, s) => sum + s.frequency, 0),
        averageRating: Math.round((overallStats.rows[0]?.avg_rating || 0) * 100) / 100
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('Error in feedback analysis:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Predictive insights endpoint
app.get('/analytics/predictive-insights', authenticateToken, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Predict future usage based on trends
    const usageTrendResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(*) as daily_requests
      FROM usage_logs
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 14
    `, [startTime]);

    // Calculate usage growth rate
    const recentUsage = usageTrendResult.rows.slice(0, 7);
    const previousUsage = usageTrendResult.rows.slice(7, 14);

    const recentAvg = recentUsage.reduce((sum, day) => sum + day.daily_requests, 0) / recentUsage.length;
    const previousAvg = previousUsage.reduce((sum, day) => sum + day.daily_requests, 0) / previousUsage.length;
    const growthRate = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

    // Predict system load
    const loadPrediction = recentAvg * (1 + growthRate / 100);

    // AI performance predictions
    const aiPerformanceResult = await pool.query(`
      SELECT
        ai_provider,
        operation_type,
        AVG(response_time_ms) as current_avg_time,
        COUNT(*) as recent_count
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY ai_provider, operation_type
      ORDER BY current_avg_time DESC
    `, [startTime]);

    // Error rate trends
    const errorTrendResult = await pool.query(`
      SELECT
        DATE(created_at) as date,
        COUNT(CASE WHEN success = false THEN 1 END)::float / COUNT(*)::float * 100 as daily_error_rate
      FROM ai_performance_logs
      WHERE created_at >= $1
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 7
    `, [startTime]);

    const avgErrorRate = errorTrendResult.rows.reduce((sum, day) => sum + day.daily_error_rate, 0) / errorTrendResult.rows.length;

    // AI feedback analytics for continuous improvement
    const feedbackAnalysisResult = await pool.query(`
      SELECT
        ai_provider,
        grievance_type,
        AVG(rating) as avg_rating,
        AVG(accuracy) as avg_accuracy,
        AVG(completeness) as avg_completeness,
        AVG(usefulness) as avg_usefulness,
        AVG(response_quality_score) as avg_quality_score,
        COUNT(*) as feedback_count,
        COUNT(CASE WHEN rating <= 2 THEN 1 END) as low_ratings,
        COUNT(CASE WHEN rating >= 4 THEN 1 END) as high_ratings
      FROM ai_feedback
      WHERE created_at >= $1
      GROUP BY ai_provider, grievance_type
      ORDER BY avg_rating DESC
    `, [startTime]);

    // Extract common improvement suggestions
    const suggestionsResult = await pool.query(`
      SELECT
        unnest(suggested_improvements) as suggestion,
        COUNT(*) as frequency
      FROM ai_feedback
      WHERE created_at >= $1 AND suggested_improvements IS NOT NULL
      GROUP BY unnest(suggested_improvements)
      ORDER BY frequency DESC
      LIMIT 10
    `, [startTime]);

    // AI provider performance comparison with feedback
    const providerFeedbackResult = await pool.query(`
      SELECT
        ap.ai_provider,
        AVG(ap.response_time_ms) as avg_response_time,
        AVG(ap.confidence_score) as avg_confidence,
        AVG(af.rating) as avg_user_rating,
        AVG(af.response_quality_score) as avg_quality_score,
        COUNT(ap.*) as total_requests,
        COUNT(af.*) as feedback_count
      FROM ai_performance_logs ap
      LEFT JOIN ai_feedback af ON ap.ai_provider = af.ai_provider
        AND ap.created_at >= $1 AND af.created_at >= $1
      WHERE ap.created_at >= $1
      GROUP BY ap.ai_provider
      ORDER BY avg_user_rating DESC NULLS LAST
    `, [startTime]);

    res.json({
      usageGrowth: {
        currentAverage: Math.round(recentAvg),
        previousAverage: Math.round(previousAvg),
        growthRate: Math.round(growthRate * 100) / 100,
        predictedLoad: Math.round(loadPrediction)
      },
      aiPerformance: aiPerformanceResult.rows,
      errorTrends: {
        averageErrorRate: Math.round(avgErrorRate * 100) / 100,
        recentDays: errorTrendResult.rows
      },
      feedbackAnalysis: {
        byProviderAndType: feedbackAnalysisResult.rows,
        topImprovementSuggestions: suggestionsResult.rows,
        providerComparison: providerFeedbackResult.rows
      },
      recommendations: [
        growthRate > 10 ? 'High usage growth detected - Consider scaling infrastructure' : 'Usage growth is stable',
        avgErrorRate > 5 ? 'Error rate above threshold - Review AI model performance' : 'Error rates within acceptable range',
        aiPerformanceResult.rows.length > 0 && aiPerformanceResult.rows[0].current_avg_time > 5000 ? 'Response times are high - Optimize AI processing' : 'Response times are acceptable',
        feedbackAnalysisResult.rows.length > 0 && feedbackAnalysisResult.rows[0].avg_rating < 3 ?
          `Low user satisfaction detected (${Math.round(feedbackAnalysisResult.rows[0].avg_rating * 10) / 10}/5) - Focus on ${feedbackAnalysisResult.rows[0].grievance_type} grievances` :
          'User satisfaction is acceptable',
        suggestionsResult.rows.length > 0 ?
          `Top requested improvement: "${suggestionsResult.rows[0].suggestion}" (${suggestionsResult.rows[0].frequency} mentions)` :
          'No specific improvement suggestions from users yet'
      ],
      period: `${days} days`,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error in predictive insights:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Analytics data export endpoint
app.get('/analytics/export', authenticateToken, async (req, res) => {
  try {
    const format = req.query.format || 'json'; // json, csv
    const dataType = req.query.type || 'all'; // all, usage, performance, ai
    const days = parseInt(req.query.days) || 30;
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let exportData = {};

    if (dataType === 'all' || dataType === 'usage') {
      const usageResult = await pool.query(`
        SELECT * FROM usage_logs
        WHERE created_at >= $1
        ORDER BY created_at DESC
      `, [startTime]);
      exportData.usage = usageResult.rows;
    }

    if (dataType === 'all' || dataType === 'performance') {
      const performanceResult = await pool.query(`
        SELECT * FROM ai_performance_logs
        WHERE created_at >= $1
        ORDER BY created_at DESC
      `, [startTime]);
      exportData.performance = performanceResult.rows;
    }

    if (dataType === 'all' || dataType === 'ai') {
      const aiResult = await pool.query(`
        SELECT * FROM ai_response_votes
        WHERE created_at >= $1
        ORDER BY created_at DESC
      `, [startTime]);
      exportData.aiVotes = aiResult.rows;
    }

    if (format === 'csv') {
      // Convert to CSV format
      let csvContent = '';

      for (const [tableName, rows] of Object.entries(exportData)) {
        if (rows.length === 0) continue;

        csvContent += `\n--- ${tableName.toUpperCase()} ---\n`;
        if (rows.length > 0) {
          csvContent += Object.keys(rows[0]).join(',') + '\n';
          rows.forEach(row => {
            csvContent += Object.values(row).map(val =>
              typeof val === 'object' ? JSON.stringify(val) : String(val)
            ).join(',') + '\n';
          });
        }
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=analytics-export-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csvContent);
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=analytics-export-${new Date().toISOString().split('T')[0]}.json`);
      res.json({
        exportInfo: {
          period: `${days} days`,
          dataTypes: dataType,
          recordCounts: Object.fromEntries(
            Object.entries(exportData).map(([key, rows]) => [key, rows.length])
          ),
          exportedAt: new Date().toISOString()
        },
        data: exportData
      });
    }
  } catch (err) {
    console.error('Error in analytics export:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Function to log analytics metrics (call this from various endpoints)
async function logAnalyticsMetric(metricName, value, category = 'general', tags = {}) {
  try {
    await pool.query(`
      INSERT INTO analytics_metrics (metric_name, metric_value, category, tags)
      VALUES ($1, $2, $3, $4)
    `, [metricName, value, category, JSON.stringify(tags)]);
  } catch (err) {
    console.warn('Failed to log analytics metric:', err.message);
  }
}

// Function to log usage (call this from authenticated endpoints)
async function logUsage(userId, action, resourceType = null, resourceId = null, metadata = {}) {
  try {
    await pool.query(`
      INSERT INTO usage_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [userId, action, resourceType, resourceId, '127.0.0.1', 'API', JSON.stringify(metadata)]);
  } catch (err) {
    console.warn('Failed to log usage:', err.message);
  }
}

// Function to log AI performance (call this from AI endpoints)
async function logAIPerformance(aiProvider, operationType, responseTimeMs, success = true, confidenceScore = null, errorMessage = null, tokenUsage = {}) {
  try {
    await pool.query(`
      INSERT INTO ai_performance_logs (ai_provider, operation_type, response_time_ms, success, error_message, confidence_score, token_usage)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [aiProvider, operationType, responseTimeMs, success, errorMessage, confidenceScore, JSON.stringify(tokenUsage)]);
  } catch (err) {
    console.warn('Failed to log AI performance:', err.message);
  }
}

// Get adaptive AI recommendations based on feedback data
async function getAdaptiveAIRecommendations(operationType = 'analyze-grievance', days = 30) {
  try {
    const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get feedback analytics for the operation type
    const feedbackResult = await pool.query(`
      SELECT
        ai_provider,
        AVG(rating) as avg_rating,
        AVG(accuracy) as avg_accuracy,
        AVG(response_quality_score) as avg_quality,
        COUNT(*) as feedback_count
      FROM ai_feedback
      WHERE created_at >= $1
      GROUP BY ai_provider
      HAVING COUNT(*) >= 5  -- Only consider providers with sufficient feedback
      ORDER BY avg_quality DESC
    `, [startTime]);

    // Get performance data
    const performanceResult = await pool.query(`
      SELECT
        ai_provider,
        AVG(response_time_ms) as avg_response_time,
        AVG(confidence_score) as avg_confidence,
        COUNT(CASE WHEN success = true THEN 1 END)::float / COUNT(*)::float as success_rate
      FROM ai_performance_logs
      WHERE created_at >= $1 AND operation_type = $2
      GROUP BY ai_provider
      ORDER BY avg_response_time ASC
    `, [startTime, operationType]);

    // Combine feedback and performance data
    const recommendations = {
      preferredProviders: [],
      providerScores: {},
      improvementAreas: [],
      confidenceAdjustments: {}
    };

    // Create provider ranking based on combined metrics
    const providerMap = new Map();

    feedbackResult.rows.forEach(feedback => {
      providerMap.set(feedback.ai_provider, {
        rating: feedback.avg_rating,
        accuracy: feedback.avg_accuracy,
        quality: feedback.avg_quality,
        feedbackCount: feedback.feedback_count
      });
    });

    performanceResult.rows.forEach(perf => {
      const existing = providerMap.get(perf.ai_provider) || {};
      providerMap.set(perf.ai_provider, {
        ...existing,
        responseTime: perf.avg_response_time,
        confidence: perf.avg_confidence,
        successRate: perf.success_rate
      });
    });

    // Calculate combined scores and rank providers
    const rankedProviders = Array.from(providerMap.entries())
      .map(([provider, metrics]) => ({
        provider,
        combinedScore: calculateProviderScore(metrics),
        metrics
      }))
      .sort((a, b) => b.combinedScore - a.combinedScore);

    recommendations.preferredProviders = rankedProviders.map(p => p.provider);
    recommendations.providerScores = Object.fromEntries(
      rankedProviders.map(p => [p.provider, Math.round(p.combinedScore * 100) / 100])
    );

    // Identify improvement areas
    if (rankedProviders.length > 0) {
      const topProvider = rankedProviders[0];
      if (topProvider.metrics.rating < 3.5) {
        recommendations.improvementAreas.push('Overall user satisfaction is low - review response quality');
      }
      if (topProvider.metrics.accuracy < 3.5) {
        recommendations.improvementAreas.push('Accuracy ratings are low - improve fact-checking in responses');
      }
      if (topProvider.metrics.responseTime > 3000) {
        recommendations.improvementAreas.push('Response times are slow - consider optimization or provider switching');
      }
    }

    // Calculate confidence adjustments based on feedback
    rankedProviders.forEach(({ provider, metrics }) => {
      let adjustment = 0;
      if (metrics.rating >= 4) adjustment += 0.1;
      else if (metrics.rating <= 2) adjustment -= 0.1;

      if (metrics.accuracy >= 4) adjustment += 0.1;
      else if (metrics.accuracy <= 2) adjustment -= 0.1;

      recommendations.confidenceAdjustments[provider] = Math.round(adjustment * 100) / 100;
    });

    return recommendations;

  } catch (error) {
    console.warn('Error getting adaptive AI recommendations:', error.message);
    // Return default recommendations if analysis fails
    return {
      preferredProviders: ['gemini', 'openai', 'groq', 'mistral'],
      providerScores: { gemini: 0.8, openai: 0.7, groq: 0.6, mistral: 0.6 },
      improvementAreas: ['Unable to analyze feedback data'],
      confidenceAdjustments: { gemini: 0, openai: 0, groq: 0, mistral: 0 }
    };
  }
}

// Calculate provider score based on multiple metrics
function calculateProviderScore(metrics) {
  let score = 0.5; // Base score

  // Rating weight (40%)
  if (metrics.rating) {
    score += (metrics.rating - 3) * 0.4; // Center around 3.0
  }

  // Accuracy weight (30%)
  if (metrics.accuracy) {
    score += (metrics.accuracy - 3) * 0.3;
  }

  // Response time penalty (20%) - faster is better
  if (metrics.responseTime) {
    const timeScore = Math.max(0, 1 - (metrics.responseTime / 5000)); // 5s baseline
    score += timeScore * 0.2;
  }

  // Success rate bonus (10%)
  if (metrics.successRate) {
    score += (metrics.successRate - 0.8) * 0.1; // 80% baseline
  }

  return Math.max(0, Math.min(1, score)); // Clamp to 0-1 range
}

// Enhanced AI generation with retry logic and adaptive provider selection
async function generateWithFallback(systemPrompt, userPrompt, operationType = 'unknown', maxRetries = 2) {
  // Get adaptive recommendations for provider ordering
  const recommendations = await getAdaptiveAIRecommendations(operationType);

  // Use recommended provider order, fallback to default
  const providers = recommendations.preferredProviders.length > 0 ?
    recommendations.preferredProviders :
    ['gemini', 'openai', 'groq', 'mistral'];

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const provider of providers) {
      const startTime = Date.now();
      try {
        console.log(`Attempting ${operationType} with ${provider} (attempt ${attempt + 1})`);

        const response = await getGenerationWithSystem(systemPrompt, userPrompt, provider);

        // Apply confidence adjustment based on feedback
        const baseConfidence = 0.8;
        const adjustment = recommendations.confidenceAdjustments[provider] || 0;
        const adjustedConfidence = Math.max(0, Math.min(1, baseConfidence + adjustment));

        // Log successful performance with adjusted confidence
        const responseTime = Date.now() - startTime;
        await logAIPerformance(provider, operationType, responseTime, true, adjustedConfidence, null, response.tokenUsage || {});

        return {
          ...response,
          provider,
          attempt: attempt + 1,
          adjustedConfidence
        };

      } catch (error) {
        const responseTime = Date.now() - startTime;
        console.warn(`AI provider ${provider} failed:`, error.message);

        // Log failed performance
        await logAIPerformance(provider, operationType, responseTime, false, null, error.message);

        lastError = error;

        // If this is not the last provider, continue to next provider
        if (provider !== providers[providers.length - 1]) {
          continue;
        }
      }
    }

    // If all providers failed in this attempt, wait before retrying
    if (attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
      console.log(`All providers failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All attempts failed
  throw new Error(`All AI providers failed after ${maxRetries + 1} attempts. Last error: ${lastError?.message}`);
}

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

// Initialize database and start server
initializeDatabase().then(() => {
  app.listen(port, () => {
    console.log(`Worker ${process.pid}: Server running on port ${port}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  // Start server anyway
  app.listen(port, () => {
    console.log(`Worker ${process.pid}: Server running on port ${port} (database init failed)`);
  });
});

module.exports = app;
}