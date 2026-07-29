# KYRIEL WHATSAPP v2.0

## Setup

### 1. Railway (Backend)

**Environment Variables** (set di Railway Dashboard → Variables):
```
PORT=3000
JWT_SECRET=kyriel-whatsapp-secret-key-2026
GITHUB_TOKEN=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
```

**Deploy:**
```bash
git add .
git commit -m "v2.0"
git push origin main
```

### 2. Vercel (Frontend)

**Deploy:**
```bash
vercel --prod
```

No environment variables needed for frontend.

### 3. GitHub Setup

Create in your repo:
- `users.json` → `[]`
- `logs.json` → `[]`
- Folder `LOGSSYSTEM/`

## Security
- **NEVER** commit `.env` file (already in `.gitignore`)
- **NEVER** hardcode tokens in code
- Token is read from `process.env.GITHUB_TOKEN` only

## Architecture
| Service | Role |
|---------|------|
| Railway | Node.js backend + Baileys + Socket.IO |
| Vercel | Static frontend |
| GitHub | JSON database |
