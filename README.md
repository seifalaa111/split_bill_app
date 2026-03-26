# SplitCheck — Phase 1

**Protect the Vibe. Split the Bill.**

## Quick Start

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- PostgreSQL (local or hosted)

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Set Up the Database
```bash
# Copy and edit the env file
cp apps/server/.env.example apps/server/.env
# Edit DATABASE_URL in apps/server/.env to point to your PostgreSQL instance

# Generate Prisma client and run migrations
cd apps/server
npx prisma generate
npx prisma migrate dev --name init
cd ../..
```

### 3. Set Up the Frontend
```bash
cp apps/web/.env.local.example apps/web/.env.local
# Default API URL is http://localhost:3001 — change if needed
```

### 4. Build Shared Package
```bash
pnpm --filter @splitcheck/shared build
```

### 5. Run Everything
```bash
# Terminal 1: Start the API server
pnpm dev:server

# Terminal 2: Start the frontend
pnpm dev:web
```

- Frontend: http://localhost:3000
- API: http://localhost:3001
- Health check: http://localhost:3001/health

### 6. Run Tests
```bash
pnpm test
```

## Architecture

```
splitcheck/
├── apps/
│   ├── web/          # Next.js 14 frontend (App Router)
│   └── server/       # Fastify API server
├── packages/
│   └── shared/       # Shared types, constants, calculation engine
```

### Key Design Decisions
- **Calculation engine is pure functions** — no side effects, independently testable
- **Banker's rounding** throughout for financial accuracy
- **Host absorbs rounding remainder** — tax/service split remainder goes to index 0
- **Transactions for claims** — prevents race conditions on last available unit
- **Session code excludes confusing chars** — no I/O/0/1 to avoid misreads

## Acceptance Test (Phase 1)

The full acceptance test runs as a unit test in `packages/shared/src/__tests__/calculations.test.ts`.

**Scenario:** EGP 500 subtotal, 14% tax, 12% service, 3 guests, 5 items including 1 shared.

**Result:** Sum of personal totals = EGP 630.00 (exact match, host absorbs 0.01 tax remainder).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:code` | Get session by join code |
| PATCH | `/api/sessions/:id` | Update session status |
| POST | `/api/sessions/:id/items` | Add bill item |
| GET | `/api/sessions/:id/items` | Get session items |
| PUT | `/api/items/:id` | Edit item |
| DELETE | `/api/items/:id` | Delete item |
| POST | `/api/sessions/:id/join` | Join session |
| POST | `/api/items/:id/claim` | Claim item |
| DELETE | `/api/claims/:id` | Unclaim |
| POST | `/api/participants/:id/checkout` | Checkout |
| GET | `/api/sessions/:id/summary` | Get session summary |
