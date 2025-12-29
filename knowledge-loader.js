/**
 * Knowledge Loader for Union Shield
 * Loads and caches knowledge base files for AI context
 */

const fs = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = path.join(__dirname, 'knowledge');

// Cache for loaded knowledge
let knowledgeCache = null;
let lastLoadTime = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Load all knowledge files from the knowledge directory
 */
function loadKnowledge() {
  // Return cached if still valid
  if (knowledgeCache && lastLoadTime && (Date.now() - lastLoadTime < CACHE_TTL)) {
    return knowledgeCache;
  }

  const knowledge = {
    justCause: '',
    weingarten: '',
    grievanceTypes: '',
    winningArguments: '',
    defenseExamples: '',
    laborTerms: '',
    timelineRules: '',
    redFlags: '',
    systemPrompts: ''
  };

  const fileMap = {
    'JUST_CAUSE.md': 'justCause',
    'WEINGARTEN.md': 'weingarten',
    'GRIEVANCE_TYPES.md': 'grievanceTypes',
    'WINNING_ARGUMENTS.md': 'winningArguments',
    'DEFENSE_EXAMPLES.md': 'defenseExamples',
    'LABOR_TERMS.md': 'laborTerms',
    'TIMELINE_RULES.md': 'timelineRules',
    'RED_FLAGS.md': 'redFlags',
    'SYSTEM_PROMPTS.md': 'systemPrompts'
  };

  try {
    const files = fs.readdirSync(KNOWLEDGE_DIR);

    for (const file of files) {
      if (fileMap[file]) {
        const filePath = path.join(KNOWLEDGE_DIR, file);
        knowledge[fileMap[file]] = fs.readFileSync(filePath, 'utf-8');
      }
    }
  } catch (error) {
    console.error('Error loading knowledge files:', error.message);
  }

  knowledgeCache = knowledge;
  lastLoadTime = Date.now();

  return knowledge;
}

/**
 * Get the main system prompt for the AI
 */
function getSystemPrompt() {
  const knowledge = loadKnowledge();

  return `You are Union Shield, an expert AI assistant for union stewards with over 20 years of experience in labor relations, grievance handling, and arbitration.

YOUR EXPERTISE INCLUDES:
- Applying the Seven Tests of Just Cause
- Weingarten rights and representation
- Contract interpretation and enforcement
- Progressive discipline principles
- Disparate treatment analysis
- Arbitration precedents and case law
- NLRA and labor law fundamentals

WHEN BUILDING A DEFENSE:
1. Start by identifying the type of grievance
2. Determine which contract articles apply
3. Apply the Seven Tests of Just Cause if discipline is involved
4. Look for procedural violations
5. Check for disparate treatment
6. Identify mitigating factors
7. Cite relevant precedents when available
8. Propose specific, measurable remedies

YOUR RESPONSE STYLE:
- Be direct and professional
- Use clear, organized formatting
- Cite specific contract language when possible
- Provide actionable arguments, not just theory
- Acknowledge weaknesses but focus on strengths
- Always include a recommended remedy

IMPORTANT RULES:
- Never advise illegal activity
- Always recommend consulting a union attorney for complex legal issues
- Acknowledge when a case may be weak, but still provide the best defense possible
- Remember that your goal is to protect the rights of workers

KEY KNOWLEDGE:

THE SEVEN TESTS OF JUST CAUSE:
1. Notice - Was the employee warned?
2. Reasonable Rule - Is the rule related to business operations?
3. Investigation - Did management investigate first?
4. Fair Investigation - Was the investigation objective?
5. Proof - Is there substantial evidence?
6. Equal Treatment - Were others treated the same?
7. Penalty - Is the punishment proportional?

WEINGARTEN RIGHTS:
Employees have the right to union representation during investigatory interviews that could lead to discipline. The employee must request representation. Management must either grant the request, end the interview, or give the employee a choice.

COMMON WINNING ARGUMENTS:
- Progressive discipline was not followed
- Disparate treatment (others did the same thing with less punishment)
- Insufficient evidence/proof
- Procedural violations
- Long service record with no prior discipline
- Mitigating circumstances not considered
- Rule never enforced before`;
}

/**
 * Get context about specific grievance types
 */
function getGrievanceTypeContext(grievanceType) {
  const knowledge = loadKnowledge();

  const typeKeywords = {
    'termination': ['termination', 'discharge', 'fired', 'let go'],
    'suspension': ['suspension', 'suspended', 'sent home'],
    'warning': ['warning', 'write up', 'written up', 'documented'],
    'overtime': ['overtime', 'ot', 'hours', 'equalization'],
    'seniority': ['seniority', 'bypass', 'passed over', 'junior'],
    'safety': ['safety', 'hazard', 'dangerous', 'osha', 'injury'],
    'harassment': ['harassment', 'hostile', 'bullying', 'discrimination'],
    'pay': ['pay', 'wage', 'rate', 'money', 'compensation']
  };

  let detectedType = 'general';
  const lowerGrievance = grievanceType.toLowerCase();

  for (const [type, keywords] of Object.entries(typeKeywords)) {
    if (keywords.some(kw => lowerGrievance.includes(kw))) {
      detectedType = type;
      break;
    }
  }

  return {
    type: detectedType,
    relevantKnowledge: knowledge.grievanceTypes,
    winningArguments: knowledge.winningArguments
  };
}

/**
 * Get the defense packet template prompt
 */
function getDefensePacketPrompt(grievanceDetails, similarCases) {
  const knowledge = loadKnowledge();

  return `Generate a formal grievance defense packet using the following structure and information.

GRIEVANCE DETAILS:
${grievanceDetails}

SIMILAR CASES FROM DATABASE:
${similarCases}

REFERENCE MATERIAL - JUST CAUSE TESTS:
${knowledge.justCause.substring(0, 2000)}

REFERENCE MATERIAL - WINNING ARGUMENTS:
${knowledge.winningArguments.substring(0, 2000)}

REFERENCE MATERIAL - DEFENSE EXAMPLES:
${knowledge.defenseExamples.substring(0, 3000)}

Please generate a complete defense packet with:
1. Header with grievant information
2. Statement of grievance
3. Chronological facts
4. Contract violations cited
5. Just cause analysis (if discipline)
6. Supporting arguments
7. Similar case references
8. Specific remedy requested

Format professionally as this may be presented in a formal hearing.`;
}

/**
 * Get quick answer prompt for simple questions
 */
function getQuickAnswerPrompt(question) {
  return `You are a union steward expert answering a quick question.

QUESTION: ${question}

Provide:
1. A direct answer to the question
2. Brief explanation of why
3. One or two key points to remember
4. Recommendation for next steps if applicable

Keep your response concise but complete. Use bullet points for clarity.`;
}

/**
 * Get all knowledge as a single context string (for RAG)
 */
function getAllKnowledgeContext() {
  const knowledge = loadKnowledge();

  // Concatenate key knowledge with size limits
  return `
JUST CAUSE STANDARDS:
${knowledge.justCause.substring(0, 1500)}

WEINGARTEN RIGHTS:
${knowledge.weingarten.substring(0, 1000)}

WINNING ARGUMENTS:
${knowledge.winningArguments.substring(0, 2000)}

RED FLAGS IN MANAGEMENT ARGUMENTS:
${knowledge.redFlags.substring(0, 1500)}

TIMELINE RULES:
${knowledge.timelineRules.substring(0, 1000)}
`;
}

module.exports = {
  loadKnowledge,
  getSystemPrompt,
  getGrievanceTypeContext,
  getDefensePacketPrompt,
  getQuickAnswerPrompt,
  getAllKnowledgeContext
};
