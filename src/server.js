const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     process.env.DB_PORT,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// ──────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────

// Kubernetes liveness / readiness probe
app.get('/health', (req, res) =>
  res.status(200).json({ status: 'ok', service: 'auth-service' })
);

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }
  try {
    const token = authHeader.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

app.post('/register', async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const inviteCode = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 character code
    const result = await pool.query(
      'INSERT INTO users (username, password, role, invite_code) VALUES ($1, $2, $3, $4) RETURNING id, username, role, invite_code',
      [username, hashedPassword, role || 'family', inviteCode]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, username: user.username, role: user.role, invite_code: user.invite_code } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, invite_code FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, username, role FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Link family to elder
app.post('/link', authenticate, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const familyId = req.user.userId;

    // Find elder
    const elderRes = await pool.query('SELECT id, role FROM users WHERE invite_code = $1', [inviteCode]);
    if (elderRes.rows.length === 0) return res.status(404).json({ error: 'Invalid invite code' });
    const elder = elderRes.rows[0];
    if (elder.role !== 'elder') return res.status(400).json({ error: 'User is not registered as an elder' });

    // Create link
    await pool.query(
      'INSERT INTO family_links (family_id, elder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [familyId, elder.id]
    );
    res.status(201).json({ success: true, elderId: elder.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get elders linked to a family member
app.get('/links/elders', authenticate, async (req, res) => {
  try {
    const familyId = req.user.userId;
    const result = await pool.query(
      `SELECT u.id, u.username, u.role FROM users u
       JOIN family_links f ON u.id = f.elder_id
       WHERE f.family_id = $1`,
      [familyId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get family members linked to an elder
app.get('/links/family', authenticate, async (req, res) => {
  try {
    const elderId = req.user.userId;
    const result = await pool.query(
      `SELECT u.id, u.username, u.role FROM users u
       JOIN family_links f ON u.id = f.family_id
       WHERE f.elder_id = $1`,
      [elderId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────
// SEED — creates demo users if the table is empty
// ──────────────────────────────────────────────
async function seedDemoUsers() {
  try {
    const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM users');
    if (parseInt(rows[0].cnt, 10) > 0) {
      console.log('ℹ️  Users table already has data — skipping seed.');
      return;
    }
    const elderHash  = await bcrypt.hash('password123', 10);
    const familyHash = await bcrypt.hash('password123', 10);
    
    await pool.query(
      `INSERT INTO users (username, password, role, invite_code) VALUES
        ($1, $2, 'elder', 'DEMO-123'),
        ($3, $4, 'family', NULL)
       ON CONFLICT (username) DO NOTHING`,
      ['grandma', elderHash, 'daughter', familyHash]
    );
    
    // Seed link
    const users = await pool.query('SELECT id, username FROM users WHERE username IN ($1, $2)', ['grandma', 'daughter']);
    const grandma = users.rows.find(u => u.username === 'grandma');
    const daughter = users.rows.find(u => u.username === 'daughter');
    
    if (grandma && daughter) {
      await pool.query(
        'INSERT INTO family_links (family_id, elder_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [daughter.id, grandma.id]
      );
    }
    
    console.log("✅ Demo users seeded → grandma (elder) / daughter (family) — password: password123");
  } catch (err) {
    console.error('⚠️  Seeding failed:', err.message);
  }
}

// ──────────────────────────────────────────────
// STARTUP
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  // Wait for a valid DB connection before seeding / starting
  let retries = 10;
  while (retries--) {
    try {
      await pool.query('SELECT 1');
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(10) UNIQUE');
      break;
    } catch {
      console.log(`⏳ Waiting for database… (${retries} retries left)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  await seedDemoUsers();
  app.listen(PORT, () => {
    console.log(`Auth service running on port ${PORT}`);
  });
}

start();
