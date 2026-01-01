/**
 * Knowledge Loader for Union Shield
 * Loads and caches knowledge base files for AI context
 */

const fs = require('fs');
const path = require('path');
const { MASTER_PROMPT } = require('./master-prompt');

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

  // Integrate the MASTER_PROMPT (dual-persona tactical engine) with knowledge base
  return MASTER_PROMPT + `

ADDITIONAL KNOWLEDGE BASE:

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
- Rule never enforced before

KEY LEGAL PRINCIPLES:
${knowledge.justCause.substring(0, 1500)}

WINNING STRATEGIES:
${knowledge.winningArguments.substring(0, 1500)}

DEFENSE TECHNIQUES:
${knowledge.defenseExamples.substring(0, 1000)}`;
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
 * Get enhanced quick answer prompt for Pocket Steward AI
 */
function getQuickAnswerPrompt(question, userPosition = null, userContracts = null) {
  const knowledge = loadKnowledge();

  // Base system prompt for Pocket Steward
  let systemPrompt = `You are the Pocket Steward AI, an expert union representative with 25+ years of experience in labor relations, contract interpretation, and workers' rights protection.

CORE EXPERTISE:
- Contract language interpretation and enforcement
- Grievance filing and arbitration procedures
- Just cause analysis and progressive discipline
- Weingarten rights and representation
- NLRA compliance and unfair labor practices
- Workplace safety and harassment prevention
- Wage and hour law fundamentals

RESPONSE REQUIREMENTS:
1. Provide direct, actionable answers based on established labor law
2. Include specific contract article references when relevant
3. Rate your confidence level (high/medium/low) based on available information
4. Flag when attorney consultation is recommended
5. Include next steps and timeline considerations
6. Reference relevant case law or precedents when applicable

KNOWLEDGE BASE:
${getAllKnowledgeContext()}`;

  // Add position-specific context if available
  if (userPosition) {
    systemPrompt += `

POSITION CONTEXT: User holds position as ${userPosition}
- Consider position-specific contract provisions
- Account for job classification requirements
- Include relevant bargaining unit rules`;
  }

  // Add contract context if available
  if (userContracts && userContracts.length > 0) {
    systemPrompt += `

AVAILABLE CONTRACTS:
${userContracts.map(contract => `- ${contract.filename}: ${contract.text_content?.substring(0, 200) || 'Content analysis available'}`).join('\n')}

REFERENCE SPECIFIC ARTICLES when providing contract-based advice.`;
  }

  return `${systemPrompt}

QUESTION: ${question}

Provide a comprehensive but concise response covering:
• Direct answer with legal basis
• Specific steps to take
• Relevant contract articles or laws
• Timeline considerations
• When to escalate to union leadership
• Confidence level in the advice

Format with clear sections and actionable recommendations.`;
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
