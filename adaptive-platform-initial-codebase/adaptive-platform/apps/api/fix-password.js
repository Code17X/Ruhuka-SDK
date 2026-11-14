import argon2 from 'argon2';
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  console.log('Generating real Argon2 hash for "password123"...');
  const hash = await argon2.hash('password123');
  
  console.log('Updating database...');
  const res = await pool.query(
    "UPDATE users SET password_hash = $1 WHERE email = 'teacher@test.com' RETURNING email, id", 
    [hash]
  );
  
  if (res.rowCount === 0) {
    console.log('⚠️ No user found with email "teacher@test.com". Here are all users:');
    const users = await pool.query("SELECT id, email FROM users");
    console.log(users.rows);
  } else {
    console.log('✅ Password successfully updated for:', res.rows[0].email);
  }
  
  await pool.end();
}

run().catch(console.error);