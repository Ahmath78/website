const Database = require('better-sqlite3');
const fs = require('fs');
fs.mkdirSync('data', { recursive: true });
const db = new Database('data/store.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  features TEXT NOT NULL DEFAULT '[]',
  popular INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL UNIQUE,
  package_id INTEGER NOT NULL,
  package_name TEXT NOT NULL,
  price INTEGER NOT NULL,
  name TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  email TEXT NOT NULL,
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Menunggu Pembayaran',
  payment_url TEXT,
  xendit_id TEXT,
  expires_at TEXT NOT NULL,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, contact TEXT, message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Data dummy: 3 paket (hanya jika tabel masih kosong)
if (db.prepare('SELECT COUNT(*) c FROM packages').get().c === 0) {
  const ins = db.prepare('INSERT INTO packages (name,category,price,features,popular) VALUES (?,?,?,?,?)');
  ins.run('Starter', 'Desain', 49000, JSON.stringify(['1 desain logo sederhana', '2x revisi', 'File PNG transparan', 'Selesai 1 hari']), 0);
  ins.run('Pro', 'Desain', 149000, JSON.stringify(['3 opsi konsep logo', '5x revisi', 'File PNG, SVG, dan PDF', 'Panduan warna & font', 'Selesai 2 hari']), 1);
  ins.run('Video Bisnis', 'Video', 349000, JSON.stringify(['1 video promosi 30 detik', 'Musik & teks animasi', 'Format vertikal untuk Reels/TikTok', '3x revisi', 'Selesai 3 hari']), 0);
}
module.exports = db;
