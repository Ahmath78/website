require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');

const E = process.env;
const WAIT = 'Menunggu Pembayaran';
const STATUSES = [WAIT, 'Dibayar', 'Diproses', 'Selesai', 'Dibatalkan'];
const PAID = ['Dibayar', 'Diproses', 'Selesai'];
const EXPIRY_HOURS = Number(E.PAYMENT_EXPIRY_HOURS) || 24;

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); // CSP dimatikan karena Tailwind via CDN
app.use(express.json({ limit: '50kb' }));
app.use(session({
  secret: E.SESSION_SECRET || 'dev-only-secret',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: E.NODE_ENV === 'production', maxAge: 24 * 3600e3 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const clean = (s, max) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function normWA(v) {
  let n = String(v ?? '').replace(/\D/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8')) n = '62' + n;
  return /^62\d{8,13}$/.test(n) ? n : null;
}
function nextInvoice() {
  const wib = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `INV-${wib}-`;
  const n = db.prepare('SELECT COUNT(*) c FROM orders WHERE invoice_no LIKE ?').get(prefix + '%').c + 1;
  return prefix + String(n).padStart(3, '0');
}
const parsePkg = p => ({ ...p, features: JSON.parse(p.features), popular: !!p.popular, active: !!p.active });

const orderLimit = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: true, legacyHeaders: false });
const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, standardHeaders: true, legacyHeaders: false });

// ---------- Xendit ----------
async function createXenditInvoice(order) {
  const res = await fetch('https://api.xendit.co/v2/invoices', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from((E.XENDIT_SECRET_KEY || '') + ':').toString('base64')
    },
    body: JSON.stringify({
      external_id: order.invoice_no,
      amount: order.price,
      currency: 'IDR',
      payer_email: order.email,
      description: `${order.invoice_no} - ${order.package_name}`,
      invoice_duration: EXPIRY_HOURS * 3600,
      success_redirect_url: `${E.BASE_URL}/status.html?inv=${order.invoice_no}`,
      failure_redirect_url: `${E.BASE_URL}/status.html?inv=${order.invoice_no}`
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Gagal membuat invoice Xendit');
  return data; // { id, invoice_url, ... }
}

// ---------- API publik ----------
app.get('/api/config', (req, res) => res.json({
  store: E.STORE_NAME || 'Toko Online', wa: E.STORE_WA || '', email: E.STORE_EMAIL || '', hours: E.STORE_HOURS || ''
}));

app.get('/api/packages', (req, res) => {
  res.json(db.prepare('SELECT * FROM packages WHERE active=1 ORDER BY price').all().map(parsePkg));
});

app.post('/api/orders', orderLimit, async (req, res) => {
  const b = req.body || {};
  const pkg = db.prepare('SELECT * FROM packages WHERE id=? AND active=1').get(Number(b.package_id));
  if (!pkg) return res.status(400).json({ error: 'Paket tidak ditemukan.' });
  const name = clean(b.name, 80), email = clean(b.email, 120).toLowerCase(), note = clean(b.note, 500), wa = normWA(b.whatsapp);
  if (name.length < 2) return res.status(400).json({ error: 'Nama minimal 2 karakter.' });
  if (!wa) return res.status(400).json({ error: 'Nomor WhatsApp tidak valid. Contoh: 081234567890.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ error: 'Format email tidak valid.' });

  const order = {
    invoice_no: nextInvoice(), package_id: pkg.id, package_name: pkg.name, price: pkg.price,
    name, whatsapp: wa, email, note, expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600e3).toISOString()
  };
  const info = db.prepare(`INSERT INTO orders (invoice_no,package_id,package_name,price,name,whatsapp,email,note,expires_at)
    VALUES (@invoice_no,@package_id,@package_name,@price,@name,@whatsapp,@email,@note,@expires_at)`).run(order);
  try {
    const x = await createXenditInvoice(order);
    db.prepare('UPDATE orders SET payment_url=?, xendit_id=? WHERE id=?').run(x.invoice_url, x.id, info.lastInsertRowid);
    res.json({ invoice_no: order.invoice_no, payment_url: x.invoice_url, expires_at: order.expires_at });
  } catch (e) {
    console.error('Xendit error:', e.message);
    db.prepare('DELETE FROM orders WHERE id=?').run(info.lastInsertRowid);
    res.status(502).json({ error: 'Pembayaran belum bisa dibuat. Coba lagi sebentar atau hubungi CS.' });
  }
});

app.get('/api/orders/:inv', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE invoice_no=?').get(String(req.params.inv).toUpperCase());
  if (!o) return res.status(404).json({ error: 'Nomor invoice tidak ditemukan.' });
  res.json({
    invoice_no: o.invoice_no, package_name: o.package_name, price: o.price, name: o.name, status: o.status,
    expires_at: o.expires_at, created_at: o.created_at, paid_at: o.paid_at,
    payment_url: o.status === WAIT ? o.payment_url : null
  });
});

app.post('/api/contact', orderLimit, (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80), contact = clean(b.contact, 120), message = clean(b.message, 1000);
  if (name.length < 2 || contact.length < 5 || message.length < 5) return res.status(400).json({ error: 'Lengkapi nama, kontak, dan pesan.' });
  db.prepare('INSERT INTO messages (name,contact,message) VALUES (?,?,?)').run(name, contact, message);
  res.json({ ok: true });
});

// ---------- Webhook Xendit ----------
app.post('/api/webhook/xendit', (req, res) => {
  const token = req.get('x-callback-token') || '';
  if (!E.XENDIT_CALLBACK_TOKEN || !safeEq(token, E.XENDIT_CALLBACK_TOKEN)) return res.sendStatus(401);
  const { external_id, status } = req.body || {};
  if (status === 'PAID' || status === 'SETTLED') {
    db.prepare("UPDATE orders SET status='Dibayar', paid_at=datetime('now') WHERE invoice_no=? AND status=?").run(String(external_id), WAIT);
  } else if (status === 'EXPIRED') {
    db.prepare("UPDATE orders SET status='Dibatalkan' WHERE invoice_no=? AND status=?").run(String(external_id), WAIT);
  }
  res.sendStatus(200);
});

// Kedaluwarsa otomatis
setInterval(() => {
  db.prepare("UPDATE orders SET status='Dibatalkan' WHERE status=? AND expires_at < ?").run(WAIT, new Date().toISOString());
}, 60e3);

// ---------- Admin ----------
const needAdmin = (req, res, next) => req.session.admin ? next() : res.status(401).json({ error: 'Silakan login.' });

app.post('/api/admin/login', loginLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (E.ADMIN_USER && E.ADMIN_PASSWORD && safeEq(username ?? '', E.ADMIN_USER) && safeEq(password ?? '', E.ADMIN_PASSWORD)) {
    return req.session.regenerate(() => { req.session.admin = true; res.json({ ok: true }); });
  }
  res.status(401).json({ error: 'Username atau password salah.' });
});
app.post('/api/admin/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/me', needAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/stats', needAdmin, (req, res) => {
  const income = db.prepare(`SELECT COALESCE(SUM(price),0) t FROM orders WHERE status IN (${PAID.map(() => '?').join(',')})`).get(...PAID).t;
  const counts = Object.fromEntries(STATUSES.map(s => [s, db.prepare('SELECT COUNT(*) c FROM orders WHERE status=?').get(s).c]));
  res.json({ income, counts });
});
app.get('/api/admin/orders', needAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 300').all());
});
app.put('/api/admin/orders/:id/status', needAdmin, (req, res) => {
  const s = req.body?.status;
  if (!STATUSES.includes(s)) return res.status(400).json({ error: 'Status tidak valid.' });
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(s, Number(req.params.id));
  res.json({ ok: true });
});

function readPkg(b) {
  const name = clean(b.name, 80), category = clean(b.category, 40), price = Math.round(Number(b.price));
  const features = (Array.isArray(b.features) ? b.features : []).map(f => clean(f, 120)).filter(Boolean).slice(0, 12);
  if (name.length < 2 || category.length < 2) return null;
  if (!Number.isFinite(price) || price < 1000 || price > 100e6) return null;
  return { name, category, price, features: JSON.stringify(features), popular: b.popular ? 1 : 0, active: b.active === false ? 0 : 1 };
}
app.get('/api/admin/packages', needAdmin, (req, res) => res.json(db.prepare('SELECT * FROM packages ORDER BY id').all().map(parsePkg)));
app.post('/api/admin/packages', needAdmin, (req, res) => {
  const p = readPkg(req.body || {});
  if (!p) return res.status(400).json({ error: 'Data paket tidak valid (harga minimal Rp1.000).' });
  db.prepare('INSERT INTO packages (name,category,price,features,popular,active) VALUES (@name,@category,@price,@features,@popular,@active)').run(p);
  res.json({ ok: true });
});
app.put('/api/admin/packages/:id', needAdmin, (req, res) => {
  const p = readPkg(req.body || {});
  if (!p) return res.status(400).json({ error: 'Data paket tidak valid.' });
  db.prepare('UPDATE packages SET name=@name,category=@category,price=@price,features=@features,popular=@popular,active=@active WHERE id=@id').run({ ...p, id: Number(req.params.id) });
  res.json({ ok: true });
});
app.delete('/api/admin/packages/:id', needAdmin, (req, res) => {
  db.prepare('DELETE FROM packages WHERE id=?').run(Number(req.params.id)); // pesanan lama tetap aman (nama & harga tersimpan di order)
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan.' }));
app.listen(E.PORT || 3000, () => console.log(`Server jalan di http://localhost:${E.PORT || 3000}`));
