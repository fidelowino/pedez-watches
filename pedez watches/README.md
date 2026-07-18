# Pedez Watch 🟡

Luxury watch e-commerce store built with Node.js, Express, and SQLite.

## Tech Stack
- **Backend:** Node.js + Express + SQLite3
- **Frontend:** Vanilla HTML/CSS/JS (no framework)
- **Auth:** JWT + bcryptjs
- **Payments:** M-Pesa (manual Send Money flow)
- **Currency:** KES (live exchange rate)

## Local Development

```bash
npm install
node server.js
```

Open: http://localhost:3001  
Admin: http://localhost:3001/admin  
Login: `admin@pedezwatch.com` / `admin123`

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```
PORT=3001
JWT_SECRET=your_long_random_secret_here
MERCHANT_PHONE=07XXXXXXXX
```

## Deploy to Railway (Free)

### Step 1 — Push to GitHub
1. Create a new repo on github.com (call it `pedez-watch`)
2. In your terminal inside the project folder:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pedez-watch.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to **railway.app** and sign up (free)
2. Click **New Project** → **Deploy from GitHub repo**
3. Select your `pedez-watch` repo
4. Railway auto-detects Node.js and deploys

### Step 3 — Set Environment Variables on Railway
In your Railway project → **Variables** tab, add:
```
JWT_SECRET=your_long_random_secret_here
MERCHANT_PHONE=07XXXXXXXX
NODE_ENV=production
```
(Railway sets PORT automatically — don't add it)

### Step 4 — Done!
Railway gives you a free URL like `pedez-watch-production.up.railway.app`

## Notes
- SQLite database is created automatically on first run
- Watch photos upload to `/uploads` folder
- On Railway, uploaded files reset on redeploy — use Cloudinary for permanent photo storage
- Admin account is seeded automatically: `admin@pedezwatch.com` / `admin123` — **change the password after first login**
