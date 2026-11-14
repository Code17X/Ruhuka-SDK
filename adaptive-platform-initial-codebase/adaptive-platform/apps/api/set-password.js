import argon2 from 'argon2';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const hash = await argon2.hash('password123');
  console.log('Generated hash for "password123"');
  
  await pool.query(
    "UPDATE users SET password_hash = $1 WHERE email = 'teacher@test.com'", 
    [hash]
  );
  console.log('✅ User password updated successfully!');
  await pool.end();
}

run().catch(console.error);