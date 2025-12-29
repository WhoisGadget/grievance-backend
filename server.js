require('dotenv').config();
const express = require('express');

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
const csv = require('csv-parser');
const fs = require('fs');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const admin = require('firebase-admin');
const { getEmbedding, getGeneration, getGenerationWithSystem } = require('./ai-helpers');
const { getSystemPrompt, getDefensePacketPrompt, getQuickAnswerPrompt, getAllKnowledgeContext, getGrievanceTypeContext } = require('./knowledge-loader');
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

// Function to sanitize user input for AI prompts
function sanitizeInput(input) {
  // Remove common prompt injection attempts
  return input
    .replace(/ignore previous instructions/gi, '[FILTERED]')
    .replace(/system prompt/gi, '[FILTERED]')
    .replace(/as an AI/gi, '[FILTERED]')
    .replace(/forget your training/gi, '[FILTERED]')
    .replace(/override/gi, '[FILTERED]');
}

// Analyze grievance route - protected
app.post('/analyze-grievance', authenticateToken, async (req, res) => {
  try {
    const { error } = grievanceSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { grievance } = req.body;
    const sanitizedGrievance = sanitizeInput(grievance);

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

    // Calculate win probability based on top 5 cases for more accuracy
    const topCaseMatches = topMatches.filter(m => m.type === 'case').slice(0, 5);
    const granted = topCaseMatches.filter(c => c.decision === 'Granted').length;
    const winProb = topCaseMatches.length > 0 ? (granted / topCaseMatches.length * 100).toFixed(2) : 0;

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
  "confidence": "Confidence level in the analysis (high/medium/low)"
}

Ensure the response is only the JSON object, no additional text.`;

    console.log('AI Prompt being sent with system prompt and knowledge context');

    const generationResponse = await getGenerationWithSystem(systemPrompt, userPrompt);
    const report = generationResponse.text;
    let structuredReport;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = report.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        structuredReport = JSON.parse(jsonMatch[0]);
      } else {
        structuredReport = JSON.parse(report);
      }
    } catch (e) {
      // Fallback to plain text if JSON parsing fails
      structuredReport = { error: 'Failed to parse structured report', fullReport: report };
    }

    res.json({
      report: structuredReport,
      matchingCases: topMatches.length,
      winProbability: winProb,
      grievanceType: grievanceContext.type,
      aiProvider: generationResponse.provider
    });
  } catch (err) {
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

// Quick answer route - for simple questions
app.post('/quick-answer', authenticateToken, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || question.length > 1000) {
      return res.status(400).json({ error: 'Question is required and must be under 1000 characters' });
    }

    const sanitizedQuestion = sanitizeInput(question);
    const systemPrompt = getSystemPrompt();
    const userPrompt = getQuickAnswerPrompt(sanitizedQuestion);

    const generationResponse = await getGenerationWithSystem(systemPrompt, userPrompt);

    res.json({
      answer: generationResponse.text,
      aiProvider: generationResponse.provider
    });
  } catch (err) {
    console.error('Error in quick-answer:', err);
    res.status(500).json({ error: 'Internal server error' });
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

    const generationResponse = await getGenerationWithSystem(systemPrompt, userPrompt);

    res.json({
      defensePacket: generationResponse.text,
      similarCases: topCases.map(c => ({
        caseId: c.case_id,
        title: c.title,
        decision: c.decision,
        date: c.date,
        similarity: (c.similarity * 100).toFixed(1) + '%'
      })),
      aiProvider: generationResponse.provider
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

// Health check route
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

module.exports = app;