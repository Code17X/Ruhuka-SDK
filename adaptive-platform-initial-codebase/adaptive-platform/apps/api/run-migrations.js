import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'migrations');
const envPath = join(__dirname, '..', '..', '.env');

let databaseUrl = 'postgres://postgres:postgres@localhost:5432/adaptive_platform';
try {
  const envContent = readFileSync(envPath, 'utf-8');
  // Match DATABASE_URL= and capture everything after it, trimming whitespace
  const match = envContent.match(/^DATABASE_URL\s*=\s*(.+)$/m);
  if (match && match[1]) {
    databaseUrl = match[1].trim();
  }
} catch (e) {
  console.warn('Could not read .env file, using default local database URL');
}

// Sanitize the URL for logging (hide password)
const sanitizedUrl = databaseUrl.replace(/:\/\/[^:]+:([^@]+)@/, '://***:***@');
console.log('Attempting to connect with URL:', sanitizedUrl);

// Check for common typos
if (databaseUrl.includes('[') || databaseUrl.includes(']')) {
  console.error('\n❌ ERROR: Your DATABASE_URL contains brackets like [YOUR-PASSWORD].');
  console.error('Please remove the brackets and use your actual password.');
  process.exit(1);
}

if (databaseUrl.includes('DATABASE_URLDATABASE_URL')) {
  console.error('\n❌ ERROR: Your .env file has a typo: DATABASE_URLDATABASE_URL=');
  console.error('Please change it to exactly DATABASE_URL=');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function runMigrations() {
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`\nFound ${files.length} migration files in ${migrationsDir}`);

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const sql = readFileSync(filePath, 'utf-8');
    
    console.log(`\nApplying ${file}...`);
    try {
      await pool.query(sql);
      console.log(`✓ ${file} applied successfully`);
    } catch (error) {
      console.error(`✗ ${file} failed:`, error.message);
      throw error;
    }
  }

  console.log('\n✓ All migrations applied successfully');
  await pool.end();
}

runMigrations().catch(error => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});