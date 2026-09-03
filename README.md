# DS Mobile & Digital Hub Pro

Production-oriented POS, inventory, warranty, repair and shop-management application.

## Architecture
- React + TypeScript + Vite frontend
- Supabase Auth + PostgreSQL as cloud authority
- SQLite WASM + IndexedDB persistence for offline queue
- Server-authoritative invoice reservation and atomic sales
- FIFO batch consumption
- Durable Telegram outbox with retry and invoice PDF generation
- Gemini Vision (online AI) image scanning — single provider, staff confirms before save
- PWA offline assets and deep-link shortcuts

## Run
```bash
npm install
npm run dev
```

Set server secrets in `.env` from `.env.example`. Server-only secrets must never use the `VITE_` prefix.

## Production
```bash
npm run lint
npm run build
```

The project preserves the existing feature modules. Do not replace the application with a smaller rewrite.
