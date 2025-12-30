/**
 * Database Setup Script for Grievance Backend
 * Run this script to create all required tables
 *
 * Usage: node setup-database.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupDatabase() {
  console.log('🔧 Setting up database...\n');

  try {
    // Test connection
    console.log('1. Testing database connection...');
    const testResult = await pool.query('SELECT NOW()');
    console.log('   ✅ Connected at:', testResult.rows[0].now);

    // Enable pgvector extension (for embeddings)
    console.log('\n2. Enabling pgvector extension...');
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('   ✅ pgvector extension enabled');
    } catch (err) {
      console.log('   ⚠️  pgvector not available (embeddings will be stored as JSON)');
    }

    // Create leak_data table
    console.log('\n3. Creating leak_data table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leak_data (
        id SERIAL PRIMARY KEY,
        value FLOAT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ leak_data table ready');

    // Create cases table (for RAG - similar cases lookup)
    console.log('\n4. Creating cases table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cases (
        id SERIAL PRIMARY KEY,
        case_id VARCHAR(255),
        title TEXT,
        decision TEXT,
        date VARCHAR(50),
        text_content TEXT,
        embedding TEXT,
        provider VARCHAR(50) DEFAULT 'gemini',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('   ✅ cases table ready');

    // Create pdfs table (for uploaded documents)
    console.log('\n5. Creating pdfs table...');
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
    console.log('\n6. Creating feedback table...');
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

    // Create users table (optional - for user tracking)
    console.log('\n7. Creating users table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firebase_uid VARCHAR(255) UNIQUE,
        email VARCHAR(255),
        name VARCHAR(255),
        role VARCHAR(50) DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);
    console.log('   ✅ users table ready');

    // Verify tables
    console.log('\n8. Verifying tables...');
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log('   Tables in database:');
    tablesResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });

    console.log('\n✅ Database setup complete!\n');

  } catch (error) {
    console.error('\n❌ Error setting up database:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

setupDatabase();
