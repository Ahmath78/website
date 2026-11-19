# Pixelku Studio: Website Toko Online (Node.js + Express + SQLite + Xendit)

Toko paket jasa desain dan video dengan pembayaran otomatis lewat Xendit Invoice
(QRIS, Virtual Account/transfer bank, e-wallet DANA/OVO/GoPay/ShopeePay).

## Struktur folder
```
pixelku/
├── server.js          API, integrasi Xendit, webhook, admin
├── db.js              SQLite + 3 paket dummy otomatis
├── package.json
├── .env.example       salin jadi .env
└── public/
    ├── index.html     Beranda
    ├── paket.html     Pilih paket (filter kategori)
    ├── pesan.html     Form pesan + ringkasan
    ├── status.html    Cek status lewat nomor invoice
    ├── kontak.html    Kontak + form pesan
    ├── admin.html     Panel admin
    └── js/app.js      Helper, header/footer, tombol WA melayang
```

## Setup lokal
1. Pasang Node.js 18+ (cek: `node -v`).
2. Di folder proyek: `npm install`
3. `cp .env.example .env`, lalu isi:
   - `XENDIT_SECRET_KEY`: Dashboard Xendit > Settings > Developers > API Keys (pakai key *Development* dulu).
   - `XENDIT_CALLBACK_TOKEN`: di menu Webhooks, salin Verification Token.
   - `STORE_WA`: nomor WA CS format `62812...` (tanpa + dan spasi).
   - `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET`: ganti semuanya.
4. `npm start`, lalu buka http://localhost:3000. Admin ada di `/admin.html`.

## Menyambungkan webhook Xendit
Webhook butuh URL publik. Untuk tes lokal pakai tunnel (misalnya `ngrok http 3000`), lalu:
1. Isi `BASE_URL` di `.env` dengan URL publik tadi.
2. Dashboard Xendit > Settings > Webhooks > **Invoices paid** dan **Invoices expired**:
   isi `https://DOMAIN-KAMU/api/webhook/xendit`.
3. Klik *Test and save*. Server membalas 200 jika token cocok, 401 jika salah.

## Alur sistem
Pesan > server membuat invoice unik (INV-YYYYMMDD-001) dan invoice Xendit > pelanggan dibayar via link >
Xendit memanggil webhook > status otomatis jadi *Dibayar* > admin ubah ke *Diproses* dan *Selesai*.
Pesanan yang tidak dibayar dalam 24 jam (`PAYMENT_EXPIRY_HOURS`) otomatis *Dibatalkan*.

## Deploy (VPS Ubuntu)
```bash
git clone <repo-kamu> pixelku && cd pixelku
npm install --omit=dev && cp .env.example .env && nano .env   # NODE_ENV=production, BASE_URL=https://domainmu
sudo npm i -g pm2 && pm2 start server.js --name pixelku && pm2 save && pm2 startup
```
Pasang Nginx sebagai reverse proxy ke `localhost:3000` dan HTTPS gratis dengan `certbot --nginx`.
Cadangkan folder `data/` (berisi database) secara rutin. Platform seperti Railway/Render juga bisa,
asalkan memakai persistent disk untuk `data/`.

## Keamanan yang sudah ada
API key di `.env` (jangan di-commit) · verifikasi token webhook (timing-safe) · query SQL terparameter ·
sanitasi input di server dan escape di tampilan · rate limit pesanan dan login · helmet · cookie sesi httpOnly.
Sebelum live: ganti key ke *Production*, pakai HTTPS, dan pakai password admin yang panjang.

## Mengganti tampilan
Nama, WA, email, jam buka: `.env`. Warna utama memakai kelas Tailwind `teal-700` (cari dan ganti di file HTML dan `app.js`).
Font: Plus Jakarta Sans (diatur di `public/js/app.js`).
