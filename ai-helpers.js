require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');
const Groq = require('groq-sdk');
const { Mistral } = require('@mistralai/mistralai');

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

module.exports = { getEmbedding, getGeneration, getGenerationWithSystem };