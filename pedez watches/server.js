require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const sqlite3  = require('sqlite3').verbose();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3001;
const JWT  = process.env.JWT_SECRET || 'pedez_secret_change_in_production';
const isProd = process.env.NODE_ENV === 'production';

// ── MIDDLEWARE ──
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// ── FILE UPLOAD ──
const upload = multer({
  storage: multer.diskStorage({
    destination: (_, __, cb) => cb(null, 'uploads/'),
    filename:    (_, f, cb)  => cb(null, `watch-${Date.now()}${path.extname(f.originalname)}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, f, cb) => /\.(jpg|jpeg|png|webp)$/i.test(f.originalname) ? cb(null, true) : cb(new Error('Images only'))
});

// ── DATABASE ──
const db = new sqlite3.Database(path.join(__dirname, 'pedez.db'), err => {
  if (err) { console.error('DB Error:', err); process.exit(1); }
});
const dbGet = (sql, p=[]) => new Promise((res, rej) => db.get(sql, p, (e,r) => e ? rej(e) : res(r)));
const dbAll = (sql, p=[]) => new Promise((res, rej) => db.all(sql, p, (e,r) => e ? rej(e) : res(r)));
const dbRun = (sql, p=[]) => new Promise((res, rej) => db.run(sql, p, function(e){ e ? rej(e) : res({ id: this.lastID, changes: this.changes }); }));

// ── AUTH HELPERS ──
const signToken = d => jwt.sign(d, JWT, { expiresIn: '7d' });
const auth = (req, res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return res.status(401).json({ error: 'Please sign in' });
  try { req.user = jwt.verify(h.slice(7), JWT); next(); }
  catch { res.status(401).json({ error: 'Session expired — please sign in again' }); }
};
const admin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required' });

// ── SCHEMA ──
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    phone TEXT DEFAULT '', password TEXT NOT NULL,
    role TEXT DEFAULT 'customer', points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'Bronze', order_count INTEGER DEFAULT 0,
    referral_code TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS watches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, brand TEXT NOT NULL,
    category TEXT DEFAULT 'luxury', price REAL NOT NULL,
    discount INTEGER DEFAULT 0, stock INTEGER DEFAULT 10,
    reference TEXT DEFAULT '', movement TEXT DEFAULT 'Automatic',
    description TEXT DEFAULT '', image_url TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    address TEXT DEFAULT '', delivery TEXT DEFAULT 'pickup',
    packaging TEXT DEFAULT 'standard',
    mpesa_code TEXT DEFAULT '', phone TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL, watch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, price REAL NOT NULL)`);

  db.run(`CREATE TABLE IF NOT EXISTS wishlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, watch_id INTEGER NOT NULL,
    UNIQUE(user_id, watch_id))`);

  db.run(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL, phone TEXT, amount REAL,
    mpesa_code TEXT DEFAULT '', status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    order_id INTEGER, rating INTEGER NOT NULL,
    title TEXT DEFAULT '', body TEXT NOT NULL,
    verified_purchase INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS notify_stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    watch_id INTEGER NOT NULL, phone TEXT DEFAULT '',
    email TEXT DEFAULT '', sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS referrals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    referrer_id INTEGER NOT NULL, referred_id INTEGER NOT NULL,
    rewarded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS customer_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, note TEXT NOT NULL,
    admin_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  db.run(`CREATE TABLE IF NOT EXISTS abandoned_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT DEFAULT '', email TEXT DEFAULT '',
    items TEXT NOT NULL, reminded INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);

  // ── SEED ADMIN ──
  db.get("SELECT id FROM users WHERE role='admin'", (_, row) => {
    if (!row) {
      const hash = bcrypt.hashSync('admin123', 10);
      const code = 'PZ' + Math.random().toString(36).slice(2,8).toUpperCase();
      db.run("INSERT INTO users (name,email,password,role,referral_code) VALUES (?,?,?,?,?)",
        ['Admin', 'admin@pedezwatch.com', hash, 'admin', code],
        () => console.log('✓ Admin created: admin@pedezwatch.com / admin123'));
    }
  });

  // ── SEED WATCHES ──
  db.get("SELECT COUNT(*) as c FROM watches", (_, row) => {
    if (row?.c === 0) {
      const ins = db.prepare(`INSERT INTO watches
        (name,brand,category,price,discount,stock,reference,movement,description)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      [
        ['Submariner Date','Rolex','luxury',9600,20,2,'Ref. 126610LN','Automatic',
          "The definitive diver's watch. Reference 126610LN, 41mm Oystersteel, Cerachrom bezel. Water-resistant to 300m, built to outlast generations."],
        ['Seamaster 300','Omega','luxury',5200,0,5,'Ref. 210.32.42.20.03.001','Co-Axial Automatic',
          "Omega's Co-Axial Master Chronometer. Anti-magnetic to 15,000 gauss. The most precisely certified watch movement ever made."],
        ['Carrera Calibre','TAG Heuer','sport',3400,15,3,'Ref. CBN2A1B.BA0643','Automatic',
          "The watch Jack Heuer created for racing drivers in 1963. Self-winding chronograph, flyback function, still the benchmark sports chrono."],
        ['Santos de Cartier','Cartier','luxury',7800,0,1,'Ref. WSSA0018','Automatic',
          "The watch that kickstarted wrist watchmaking in 1904. Iconic square case, exposed screws, Art Deco in every detail."],
        ['Presage Cocktail Time','Seiko','classic',1200,0,8,'Ref. SARX055','Automatic',
          "Stunning silver enamel dial — a masterwork of Japanese craft at a price that makes no sense."],
        ['Pilot Type 20','IWC','classic',4800,10,4,'Ref. IW328203','Automatic',
          "Born from the spirit of early aviation. Oversized crown, anti-magnetic protection, beautifully refined military heritage."],
      ].forEach(w => ins.run(...w));
      ins.finalize(() => console.log('✓ 6 watches seeded'));
    }
  });

  console.log('✓ Database ready');
});

// ════════════════════════════════════════
// AUTH
// ════════════════════════════════════════
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone = '', password, referral_code } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (await dbGet('SELECT id FROM users WHERE email=?', [email]))
      return res.status(400).json({ error: 'Email already registered' });
    const hash = await bcrypt.hash(password, 10);
    const code = 'PZ' + Math.random().toString(36).slice(2,8).toUpperCase();
    const r = await dbRun(
      'INSERT INTO users (name,email,phone,password,points,referral_code) VALUES (?,?,?,?,?,?)',
      [name, email, phone, hash, 200, code]
    );
    // Handle referral
    if (referral_code) {
      const referrer = await dbGet('SELECT id FROM users WHERE referral_code=?', [referral_code]);
      if (referrer && referrer.id !== r.id) {
        await dbRun('INSERT INTO referrals (referrer_id,referred_id,rewarded) VALUES (?,?,1)', [referrer.id, r.id]);
        await dbRun('UPDATE users SET points=points+500 WHERE id=?', [referrer.id]);
      }
    }
    const user = { id: r.id, name, email, phone, role: 'customer', points: 200, tier: 'Bronze', order_count: 0 };
    res.status(201).json({ message: `Welcome to Pedez Watch, ${name}!`, token: signToken(user), user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const u = await dbGet('SELECT * FROM users WHERE email=?', [email]);
    if (!u || !await bcrypt.compare(password, u.password))
      return res.status(401).json({ error: 'Wrong email or password' });
    const user = { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role,
      points: u.points, tier: u.tier, order_count: u.order_count };
    res.json({ message: `Welcome back, ${u.name}!`,
      token: signToken({ id: u.id, name: u.name, email: u.email, role: u.role }), user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const u = await dbGet(
    'SELECT id,name,email,phone,role,points,tier,order_count,referral_code FROM users WHERE id=?',
    [req.user.id]);
  u ? res.json(u) : res.status(404).json({ error: 'User not found' });
});

// ════════════════════════════════════════
// WATCHES
// ════════════════════════════════════════
app.get('/api/watches', async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = 'SELECT * FROM watches WHERE is_active=1';
    const p = [];
    if (category && category !== 'all') { sql += ' AND category=?'; p.push(category); }
    if (search) { sql += ' AND (name LIKE ? OR brand LIKE ? OR category LIKE ?)'; p.push(`%${search}%`,`%${search}%`,`%${search}%`); }
    res.json(await dbAll(sql + ' ORDER BY created_at DESC', p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/watches/:id', async (req, res) => {
  const w = await dbGet('SELECT * FROM watches WHERE id=? AND is_active=1', [req.params.id]);
  w ? res.json(w) : res.status(404).json({ error: 'Watch not found' });
});

app.post('/api/watches', auth, admin, async (req, res) => {
  try {
    const { name, brand, category='luxury', price, discount=0, stock=10, reference='', movement='Automatic', description='', image_url='' } = req.body;
    if (!name || !brand || !price) return res.status(400).json({ error: 'Name, brand and price required' });
    const r = await dbRun(
      'INSERT INTO watches (name,brand,category,price,discount,stock,reference,movement,description,image_url) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [name, brand, category, price, discount, stock, reference, movement, description, image_url]);
    res.status(201).json({ id: r.id, message: 'Watch added' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/watches/:id', auth, admin, async (req, res) => {
  try {
    const { name, brand, category, price, discount, stock, reference, movement, description, image_url } = req.body;
    await dbRun(
      'UPDATE watches SET name=?,brand=?,category=?,price=?,discount=?,stock=?,reference=?,movement=?,description=?,image_url=? WHERE id=?',
      [name, brand, category, price, discount, stock, reference, movement, description, image_url||'', req.params.id]);
    res.json({ message: 'Watch updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/watches/:id/price', auth, admin, async (req, res) => {
  try {
    const { price, discount } = req.body;
    await dbRun('UPDATE watches SET price=?,discount=? WHERE id=?', [price, discount||0, req.params.id]);
    res.json({ message: 'Price updated' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/watches/:id', auth, admin, async (req, res) => {
  try {
    await dbRun('UPDATE watches SET is_active=0 WHERE id=?', [req.params.id]);
    res.json({ message: 'Watch removed' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Photo upload
app.post('/api/upload/:id', auth, admin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const url = `/uploads/${req.file.filename}`;
    await dbRun('UPDATE watches SET image_url=? WHERE id=?', [url, req.params.id]);
    res.json({ url, message: 'Photo uploaded' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// WISHLIST
// ════════════════════════════════════════
app.get('/api/wishlist', auth, async (req, res) => {
  try {
    const items = await dbAll(
      'SELECT w.* FROM wishlist wl JOIN watches w ON w.id=wl.watch_id WHERE wl.user_id=? AND w.is_active=1',
      [req.user.id]);
    res.json(items);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wishlist/:id', auth, async (req, res) => {
  try {
    await dbRun('INSERT OR IGNORE INTO wishlist (user_id,watch_id) VALUES (?,?)', [req.user.id, req.params.id]);
    res.json({ message: 'Added to wishlist' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/wishlist/:id', auth, async (req, res) => {
  try {
    await dbRun('DELETE FROM wishlist WHERE user_id=? AND watch_id=?', [req.user.id, req.params.id]);
    res.json({ message: 'Removed from wishlist' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// ORDERS
// ════════════════════════════════════════
app.post('/api/orders', auth, async (req, res) => {
  try {
    const { items, address='', delivery='pickup', packaging='standard', mpesa_code='', phone='', notes='' } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'No items in order' });
    // Calculate total
    let total = packaging === 'gift' ? 8 : 0;
    const watchIds = items.map(i => i.id);
    const watches = await dbAll(`SELECT * FROM watches WHERE id IN (${watchIds.map(()=>'?').join(',')})`, watchIds);
    const watchMap = Object.fromEntries(watches.map(w => [w.id, w]));
    const orderItems = [];
    for (const item of items) {
      const w = watchMap[item.id];
      if (!w) return res.status(400).json({ error: `Watch ${item.id} not found` });
      if (w.stock < (item.qty || 1)) return res.status(400).json({ error: `${w.name} is out of stock` });
      const price = w.price * (1 - w.discount / 100);
      total += price * (item.qty || 1);
      orderItems.push({ id: w.id, qty: item.qty || 1, price });
    }
    // Create order
    const orderResult = await dbRun(
      'INSERT INTO orders (user_id,total,address,delivery,packaging,mpesa_code,phone,notes) VALUES (?,?,?,?,?,?,?,?)',
      [req.user.id, total, address, delivery, packaging, mpesa_code, phone, notes]);
    const orderId = orderResult.id;
    // Insert items and update stock
    for (const item of orderItems) {
      await dbRun('INSERT INTO order_items (order_id,watch_id,quantity,price) VALUES (?,?,?,?)',
        [orderId, item.id, item.qty, item.price]);
      await dbRun('UPDATE watches SET stock=MAX(0,stock-?) WHERE id=?', [item.qty, item.id]);
    }
    // Create payment record
    await dbRun('INSERT INTO payments (order_id,phone,amount,mpesa_code,status) VALUES (?,?,?,?,?)',
      [orderId, phone, total, mpesa_code, mpesa_code ? 'pending' : 'pending']);
    // Update user points and order count
    const pts = Math.floor(total);
    await dbRun('UPDATE users SET points=points+?,order_count=order_count+1 WHERE id=?', [pts, req.user.id]);
    // Update tier
    const u = await dbGet('SELECT order_count FROM users WHERE id=?', [req.user.id]);
    const count = u?.order_count || 1;
    const tier = count>=20?'Diamond':count>=15?'Platinum':count>=10?'Gold':count>=5?'Silver':'Bronze';
    await dbRun('UPDATE users SET tier=? WHERE id=?', [tier, req.user.id]);
    res.status(201).json({ id: orderId, message: 'Order placed!', total, points_earned: pts });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders/my', auth, async (req, res) => {
  try {
    const orders = await dbAll(
      `SELECT o.*, GROUP_CONCAT(w.brand||' '||w.name||' x'||oi.quantity, ', ') as items_desc
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN watches w ON w.id=oi.watch_id
       WHERE o.user_id=? GROUP BY o.id ORDER BY o.created_at DESC`,
      [req.user.id]);
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/orders', auth, admin, async (req, res) => {
  try {
    const { status } = req.query;
    let sql = `SELECT o.*,u.name cname,u.email cemail,u.phone cphone,
      GROUP_CONCAT(w.brand||' '||w.name||' x'||oi.quantity,', ') as items_desc
      FROM orders o JOIN users u ON u.id=o.user_id
      LEFT JOIN order_items oi ON oi.order_id=o.id
      LEFT JOIN watches w ON w.id=oi.watch_id`;
    const p = [];
    if (status) { sql += ' WHERE o.status=?'; p.push(status); }
    sql += ' GROUP BY o.id ORDER BY o.created_at DESC';
    res.json(await dbAll(sql, p));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id/status', auth, admin, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['pending','awaiting_payment','confirmed','shipped','delivered','cancelled'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    await dbRun('UPDATE orders SET status=? WHERE id=?', [status, req.params.id]);
    res.json({ message: `Order #${req.params.id} → ${status}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Order tracking (public)
app.get('/api/track/:id', async (req, res) => {
  try {
    const o = await dbGet(
      `SELECT o.id,o.status,o.created_at,o.mpesa_code,o.delivery,o.packaging,
        GROUP_CONCAT(w.name||' x'||oi.quantity,', ') as items_desc
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN watches w ON w.id=oi.watch_id
       WHERE o.id=? GROUP BY o.id`,
      [req.params.id]);
    o ? res.json(o) : res.status(404).json({ error: 'Order not found' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// PAYMENTS
// ════════════════════════════════════════
app.get('/api/admin/payments', auth, admin, async (req, res) => {
  try {
    const pays = await dbAll(
      `SELECT p.*,o.total,o.phone as order_phone,u.name cname,u.email cemail,
        GROUP_CONCAT(w.brand||' '||w.name,', ') as items
       FROM payments p JOIN orders o ON o.id=p.order_id
       JOIN users u ON u.id=o.user_id
       LEFT JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN watches w ON w.id=oi.watch_id
       GROUP BY p.id ORDER BY p.created_at DESC`);
    res.json(pays);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/payments/:id', auth, admin, async (req, res) => {
  try {
    const { status } = req.body;
    await dbRun('UPDATE payments SET status=? WHERE id=?', [status, req.params.id]);
    if (status === 'verified') {
      const pay = await dbGet('SELECT order_id FROM payments WHERE id=?', [req.params.id]);
      if (pay) await dbRun("UPDATE orders SET status='confirmed' WHERE id=?", [pay.order_id]);
    }
    res.json({ message: 'Payment ' + status });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════
app.get('/api/reviews/:watch_id', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT r.*,u.name reviewer_name FROM reviews r
       JOIN users u ON u.id=r.user_id
       WHERE r.watch_id=? ORDER BY r.created_at DESC`,
      [req.params.watch_id]);
    const avg = rows.length ? (rows.reduce((s,r)=>s+r.rating,0)/rows.length).toFixed(1) : null;
    res.json({ reviews: rows, avg, count: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/reviews', auth, async (req, res) => {
  try {
    const { watch_id, rating, title='', body } = req.body;
    if (!watch_id || !rating || !body) return res.status(400).json({ error: 'Watch, rating and review text required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
    const existing = await dbGet('SELECT id FROM reviews WHERE watch_id=? AND user_id=?', [watch_id, req.user.id]);
    if (existing) {
      await dbRun('UPDATE reviews SET rating=?,title=?,body=? WHERE id=?', [rating, title, body, existing.id]);
      return res.json({ message: 'Review updated' });
    }
    // Check if verified purchase
    const order = await dbGet(
      `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
       WHERE o.user_id=? AND oi.watch_id=? AND o.status='delivered' LIMIT 1`,
      [req.user.id, watch_id]);
    await dbRun(
      'INSERT INTO reviews (watch_id,user_id,rating,title,body,verified_purchase) VALUES (?,?,?,?,?,?)',
      [watch_id, req.user.id, rating, title, body, order ? 1 : 0]);
    res.status(201).json({ message: 'Review submitted — thank you!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/reviews/:id', auth, admin, async (req, res) => {
  try {
    await dbRun('DELETE FROM reviews WHERE id=?', [req.params.id]);
    res.json({ message: 'Review deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// NOTIFY STOCK
// ════════════════════════════════════════
app.post('/api/notify-stock', async (req, res) => {
  try {
    const { watch_id, phone='', email='' } = req.body;
    if (!watch_id) return res.status(400).json({ error: 'Watch ID required' });
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email required' });
    const existing = await dbGet('SELECT id FROM notify_stock WHERE watch_id=? AND phone=?', [watch_id, phone]);
    if (existing) return res.json({ message: "You're already on the list — we'll notify you!" });
    await dbRun('INSERT INTO notify_stock (watch_id,phone,email) VALUES (?,?,?)', [watch_id, phone, email]);
    res.json({ message: "Got it — we'll WhatsApp you when it's back in stock!" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notify-stock', auth, admin, async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT ns.*,w.name watch_name,w.brand FROM notify_stock ns
       LEFT JOIN watches w ON w.id=ns.watch_id ORDER BY ns.created_at DESC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// REFERRALS
// ════════════════════════════════════════
app.get('/api/referral/code', auth, async (req, res) => {
  try {
    const u = await dbGet('SELECT referral_code FROM users WHERE id=?', [req.user.id]);
    let code = u?.referral_code;
    if (!code) {
      code = 'PZ' + Math.random().toString(36).slice(2,8).toUpperCase();
      await dbRun('UPDATE users SET referral_code=? WHERE id=?', [code, req.user.id]);
    }
    const refs = await dbAll('SELECT * FROM referrals WHERE referrer_id=?', [req.user.id]);
    res.json({ code, referrals: refs.length, earned: refs.filter(r=>r.rewarded).length * 500 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/referral/use', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code required' });
    const referrer = await dbGet('SELECT id FROM users WHERE referral_code=?', [code]);
    if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
    if (referrer.id === req.user.id) return res.status(400).json({ error: "You can't use your own code" });
    const existing = await dbGet('SELECT id FROM referrals WHERE referred_id=?', [req.user.id]);
    if (existing) return res.status(400).json({ error: 'You have already used a referral code' });
    await dbRun('INSERT INTO referrals (referrer_id,referred_id,rewarded) VALUES (?,?,1)', [referrer.id, req.user.id]);
    await dbRun('UPDATE users SET points=points+500 WHERE id=?', [referrer.id]);
    await dbRun('UPDATE users SET points=points+500 WHERE id=?', [req.user.id]);
    res.json({ message: 'Referral applied — you both earned 500 points!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// WISHLIST (already above — skip duplicate)
// ════════════════════════════════════════

// ════════════════════════════════════════
// AUTHENTICITY CERTIFICATE
// ════════════════════════════════════════
app.get('/api/certificate/:order_id', auth, async (req, res) => {
  try {
    const orderId = req.params.order_id;
    const order = await dbGet(
      `SELECT o.*,u.name customer_name,u.email customer_email
       FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?`, [orderId]);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Access denied' });
    const items = await dbAll(
      `SELECT w.name,w.brand,w.reference,w.movement,oi.price,oi.quantity
       FROM order_items oi JOIN watches w ON w.id=oi.watch_id WHERE oi.order_id=?`, [orderId]);
    res.json({
      certificate_id: `PW-CERT-${orderId}-${Date.now().toString(36).toUpperCase()}`,
      issued_to: order.customer_name,
      order_id: `PW-${orderId}`,
      date: order.created_at,
      items,
      statement: 'This certifies that the timepiece(s) listed herein were supplied by Pedez Watch and are authentic as described at time of sale.',
      issued_by: 'Pedez Watch — Est. 2024',
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// LIVE VIEWERS (in-memory)
// ════════════════════════════════════════
const viewers = new Map();
const VIEWER_TTL = 45000;

function pruneViewers(watchId) {
  const now = Date.now();
  if (viewers.has(watchId))
    viewers.get(watchId).forEach((ts, sid) => { if (now - ts > VIEWER_TTL) viewers.get(watchId).delete(sid); });
}

app.post('/api/viewers/:watch_id', (req, res) => {
  const id = req.params.watch_id;
  const sid = req.body?.sid || Math.random().toString(36).slice(2);
  if (!viewers.has(id)) viewers.set(id, new Map());
  viewers.get(id).set(sid, Date.now());
  pruneViewers(id);
  res.json({ count: viewers.get(id).size, sid });
});

app.get('/api/viewers/:watch_id', (req, res) => {
  const id = req.params.watch_id;
  pruneViewers(id);
  res.json({ count: viewers.has(id) ? viewers.get(id).size : 0 });
});

// ════════════════════════════════════════
// ABANDONED CART
// ════════════════════════════════════════
app.post('/api/cart/save', async (req, res) => {
  try {
    const { phone='', email='', items } = req.body;
    if (!items?.length) return res.status(400).json({ error: 'No items provided' });
    if (!phone && !email) return res.status(400).json({ error: 'Phone or email required' });
    await dbRun('INSERT INTO abandoned_carts (phone,email,items) VALUES (?,?,?)',
      [phone, email, JSON.stringify(items)]);
    res.json({ message: "Saved! We'll follow up with you." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/abandoned-carts', auth, admin, async (req, res) => {
  try {
    res.json(await dbAll('SELECT * FROM abandoned_carts ORDER BY created_at DESC LIMIT 100'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// CUSTOMER NOTES (admin)
// ════════════════════════════════════════
app.get('/api/admin/notes/:user_id', auth, admin, async (req, res) => {
  try {
    res.json(await dbAll(
      'SELECT cn.*,u.name admin_name FROM customer_notes cn LEFT JOIN users u ON u.id=cn.admin_id WHERE cn.user_id=? ORDER BY cn.created_at DESC',
      [req.params.user_id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/notes', auth, admin, async (req, res) => {
  try {
    const { user_id, note } = req.body;
    if (!user_id || !note) return res.status(400).json({ error: 'User ID and note required' });
    await dbRun('INSERT INTO customer_notes (user_id,note,admin_id) VALUES (?,?,?)', [user_id, note, req.user.id]);
    res.status(201).json({ message: 'Note saved' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/notes/:id', auth, admin, async (req, res) => {
  try {
    await dbRun('DELETE FROM customer_notes WHERE id=?', [req.params.id]);
    res.json({ message: 'Note deleted' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// ADMIN — USERS
// ════════════════════════════════════════
app.get('/api/admin/users', auth, admin, async (req, res) => {
  try {
    res.json(await dbAll(
      'SELECT id,name,email,phone,role,points,tier,order_count,referral_code,created_at FROM users ORDER BY created_at DESC'));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// ADMIN — STATS (dashboard)
// ════════════════════════════════════════
app.get('/api/admin/stats', auth, admin, async (req, res) => {
  try {
    const [watches, orders, revenue, pending, awaiting, users, chart, lowStock, topWatch, recent] = await Promise.all([
      dbGet('SELECT COUNT(*) c FROM watches WHERE is_active=1'),
      dbGet('SELECT COUNT(*) c FROM orders'),
      dbGet("SELECT COALESCE(SUM(total),0) r FROM orders WHERE status NOT IN ('cancelled','pending')"),
      dbGet("SELECT COUNT(*) c FROM orders WHERE status='pending'"),
      dbGet("SELECT COUNT(*) c FROM payments WHERE status='pending'"),
      dbGet('SELECT COUNT(*) c FROM users WHERE role=\'customer\''),
      dbAll(`SELECT strftime('%m',created_at) m, SUM(total) rev, COUNT(*) cnt
             FROM orders WHERE status NOT IN ('cancelled','pending')
             GROUP BY m ORDER BY m`),
      dbAll('SELECT id,name,brand,stock FROM watches WHERE is_active=1 AND stock<=3 ORDER BY stock ASC'),
      dbGet(`SELECT w.name FROM order_items oi JOIN watches w ON w.id=oi.watch_id
             GROUP BY oi.watch_id ORDER BY COUNT(*) DESC LIMIT 1`),
      dbAll(`SELECT o.*,u.name cname,u.phone cphone,
               GROUP_CONCAT(w.brand||' '||w.name||' x'||oi.quantity,', ') items
             FROM orders o JOIN users u ON u.id=o.user_id
             LEFT JOIN order_items oi ON oi.order_id=o.id
             LEFT JOIN watches w ON w.id=oi.watch_id
             GROUP BY o.id ORDER BY o.created_at DESC LIMIT 20`),
    ]);
    res.json({
      watches: watches?.c || 0,
      orders: orders?.c || 0,
      revenue: revenue?.r || 0,
      pending: pending?.c || 0,
      awaiting: awaiting?.c || 0,
      users: users?.c || 0,
      chart, lowStock,
      topWatch: topWatch?.name || '—',
      recent,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// ADMIN — BULK PRICE UPDATE
// ════════════════════════════════════════
app.patch('/api/admin/bulk-price', auth, admin, async (req, res) => {
  try {
    const { category, percent, type='decrease' } = req.body;
    if (!category || !percent) return res.status(400).json({ error: 'Category and percent required' });
    const multiplier = type === 'increase' ? (1 + percent/100) : (1 - percent/100);
    const r = await dbRun(
      'UPDATE watches SET price=ROUND(price*?,0) WHERE category=? AND is_active=1',
      [multiplier, category]);
    res.json({ message: `Updated ${r.changes} watches in '${category}' by ${type==='increase'?'+':'−'}${percent}%`, changed: r.changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// ADMIN — SALES REPORT
// ════════════════════════════════════════
app.get('/api/admin/report', auth, admin, async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month } = req.query;
    const dateFilter = month
      ? `AND strftime('%Y-%m',created_at)='${year}-${String(month).padStart(2,'0')}'`
      : `AND strftime('%Y',created_at)='${year}'`;
    const [summary, byCategory, topWatches, orders] = await Promise.all([
      dbGet(`SELECT COUNT(*) total_orders, COALESCE(SUM(total),0) total_revenue,
               COALESCE(AVG(total),0) avg_order
             FROM orders WHERE status NOT IN ('cancelled','pending') ${dateFilter}`),
      dbAll(`SELECT w.category, COUNT(*) orders, COALESCE(SUM(oi.price*oi.quantity),0) revenue
             FROM order_items oi JOIN watches w ON w.id=oi.watch_id
             JOIN orders o ON o.id=oi.order_id
             WHERE o.status NOT IN ('cancelled','pending') ${dateFilter}
             GROUP BY w.category`),
      dbAll(`SELECT w.name,w.brand,COUNT(*) sold,COALESCE(SUM(oi.price*oi.quantity),0) revenue
             FROM order_items oi JOIN watches w ON w.id=oi.watch_id
             JOIN orders o ON o.id=oi.order_id
             WHERE o.status NOT IN ('cancelled','pending') ${dateFilter}
             GROUP BY oi.watch_id ORDER BY sold DESC LIMIT 10`),
      dbAll(`SELECT o.*,u.name customer FROM orders o JOIN users u ON u.id=o.user_id
             WHERE o.status NOT IN ('cancelled','pending') ${dateFilter}
             ORDER BY o.created_at DESC`),
    ]);
    res.json({ period: month ? `${year}-${month}` : String(year), summary, byCategory, topWatches, orders });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// MUSIC TRACKS
// ════════════════════════════════════════
async function ensureMusicTable() {
  await dbRun(`CREATE TABLE IF NOT EXISTS music_tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, artist TEXT DEFAULT '',
    src TEXT NOT NULL, active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
}

app.get('/api/music', async (req, res) => {
  try {
    await ensureMusicTable();
    res.json(await dbAll('SELECT * FROM music_tracks WHERE active=1 ORDER BY sort_order ASC, id ASC'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/music', auth, admin, async (req, res) => {
  try {
    await ensureMusicTable();
    res.json(await dbAll('SELECT * FROM music_tracks ORDER BY sort_order ASC, id ASC'));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/music', auth, admin, async (req, res) => {
  try {
    await ensureMusicTable();
    const { name, artist='', src, active=1 } = req.body;
    if (!name || !src) return res.status(400).json({ error: 'Name and stream URL required' });
    const count = await dbGet('SELECT COUNT(*) c FROM music_tracks');
    const r = await dbRun('INSERT INTO music_tracks (name,artist,src,active,sort_order) VALUES (?,?,?,?,?)',
      [name, artist, src, active ? 1 : 0, count?.c || 0]);
    res.status(201).json({ id: r.id, message: 'Track added' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/music/:id', auth, admin, async (req, res) => {
  try {
    await ensureMusicTable();
    const { name, artist='', src, active, sort_order=0 } = req.body;
    await dbRun('UPDATE music_tracks SET name=?,artist=?,src=?,active=?,sort_order=? WHERE id=?',
      [name, artist, src, active ? 1 : 0, sort_order, req.params.id]);
    res.json({ message: 'Track updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/music/:id', auth, admin, async (req, res) => {
  try {
    await ensureMusicTable();
    await dbRun('DELETE FROM music_tracks WHERE id=?', [req.params.id]);
    res.json({ message: 'Track deleted' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/music/:id/toggle', auth, admin, async (req, res) => {
  try {
    await ensureMusicTable();
    const t = await dbGet('SELECT active FROM music_tracks WHERE id=?', [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Not found' });
    await dbRun('UPDATE music_tracks SET active=? WHERE id=?', [t.active ? 0 : 1, req.params.id]);
    res.json({ active: !t.active, message: 'Track ' + (t.active ? 'hidden' : 'activated') });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════
// PAGES
// ════════════════════════════════════════
app.get('/auth',  (_, res) => res.sendFile(path.join(__dirname, 'public', 'auth.html')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*',      (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`\n🟡 Pedez Watch → http://localhost:${PORT}`);
  console.log(`   Admin  → http://localhost:${PORT}/admin`);
  console.log(`   Login  → admin@pedezwatch.com / admin123\n`);
});
