require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const { getEmbedding } = require('./ai-helpers');

async function generateEmbeddings() {
  const casesResult = await pool.query('SELECT id, title, decision, keywords FROM cases WHERE embedding IS NULL');
  const cases = casesResult.rows;

  console.log(`Generating embeddings for ${cases.length} cases...`);

  for (const caseData of cases) {
    const text = `${caseData.title} ${caseData.decision} ${caseData.keywords}`;
    try {
      const embeddingResponse = await getEmbedding(text);
      const embedding = embeddingResponse.values;
      await pool.query('UPDATE cases SET embedding = $1::vector, provider = $2 WHERE id = $3', ['[' + embedding.join(',') + ']', embeddingResponse.provider, caseData.id]);
      console.log(`Updated embedding for case ${caseData.id} using ${embeddingResponse.provider}`);
    } catch (error) {
      console.error(`Error generating embedding for case ${caseData.id}:`, error);
    }
  }

  console.log('Embeddings generation completed.');
}

generateEmbeddings().catch(console.error);