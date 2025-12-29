require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');

async function importCases() {
  const dataDir = process.env.DATA_DIR || 'data';

  // Get all CSV files in the data directory that match our pattern
  const files = fs.readdirSync(dataDir).filter(f =>
    f.startsWith('cases_part_') && f.endsWith('.csv')
  );

  if (files.length === 0) {
    console.log('No case files found. Looking for cases_part_*.csv files in', dataDir);
    return;
  }

  console.log(`Found ${files.length} case files to import.`);

  let totalImported = 0;
  let totalErrors = 0;

  for (const file of files) {
    const filePath = path.join(dataDir, file);
    console.log(`\nProcessing ${file}...`);

    const results = [];

    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Parsed ${results.length} cases from ${file}`);

    // Insert each case into the database
    for (const row of results) {
      try {
        // Map the CSV columns to database columns
        const caseId = row['Case Number'] || row['Case ID'] || '';
        const title = row['Case Name'] || row['Title'] || '';
        const caseType = row['Case Type'] || '';
        const union = row['Union'] || '';
        const decision = row['Decision'] || row['Allegation'] || '';
        const date = row['Date'] || row['Date Filed'] || null;
        const keywords = row['Keywords'] || `${caseType} ${union}`.trim();

        if (!caseId) {
          continue; // Skip rows without case ID
        }

        await pool.query(
          `INSERT INTO cases (case_id, title, decision, date, keywords)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (case_id) DO UPDATE SET
             title = EXCLUDED.title,
             decision = EXCLUDED.decision,
             date = EXCLUDED.date,
             keywords = EXCLUDED.keywords`,
          [caseId, title, decision, date, keywords]
        );
        totalImported++;

        if (totalImported % 1000 === 0) {
          console.log(`Imported ${totalImported} cases so far...`);
        }
      } catch (error) {
        totalErrors++;
        if (totalErrors <= 10) {
          console.error(`Error inserting case:`, error.message);
        }
      }
    }
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Total imported: ${totalImported}`);
  console.log(`Total errors: ${totalErrors}`);

  await pool.end();
}

importCases().catch(console.error);
