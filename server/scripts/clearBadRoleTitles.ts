import * as dotenv from 'dotenv';
dotenv.config();
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function main() {
  const r = await pool.query(`UPDATE journalists SET "roleTitle" = '', "updatedAt" = NOW() WHERE "roleTitle" LIKE '%pepotamus%' OR "roleTitle" LIKE '%Awesome%'`);
  console.log('cleared', r.rowCount, 'rows');
  const { rows } = await pool.query('SELECT id, name, "roleTitle" FROM journalists ORDER BY id');
  console.log(rows);
  await pool.end();
}
main().catch(console.error);
