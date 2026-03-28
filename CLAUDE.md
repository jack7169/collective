# CLAUDE.md - Collective

## Project Overview
Duplicate file detection and consolidation tool for Unraid. Web UI with FastAPI backend, React frontend, SQLite database.

## Commands

### Backend
```bash
cd backend
python -m pytest tests/ -v                    # Run all tests
python -m pytest tests/test_scanners/ -v      # Scanner tests only
uvicorn app.main:app --reload --port 8080     # Dev server
```

### Frontend
```bash
cd frontend
npm install           # Install dependencies
npm run dev           # Dev server (port 5173, proxies to :8080)
npm run build         # Production build
```

### Docker
```bash
docker compose up                              # Development
docker compose -f docker-compose.prod.yml up   # Production
```

## Project Structure
```
backend/
  app/
    api/         # FastAPI route handlers (scans, results, compare, actions, system, browse)
    models/      # SQLAlchemy ORM models (scan, duplicate, similarity, action, saved_scan)
    scanners/    # Scanner backends (base ABC, fclones, rmlint)
    schemas/     # Pydantic request/response models
    services/    # Business logic (action_service, btrfs_service)
    tasks/       # Huey background tasks (scan_tasks, action_tasks, scheduler, worker)
    config.py    # Settings via pydantic-settings (env prefix: COLLECTIVE_)
    database.py  # SQLAlchemy async setup
    main.py      # FastAPI app initialization
  tests/         # pytest tests
  alembic/       # Database migrations

frontend/
  src/
    api/         # HTTP client, types, React Query hooks, WebSocket
    components/  # UI (shadcn/Radix), layout, results, common, scan
    hooks/       # Custom hooks (useActionQueue, useGroupSelection, useBrowse)
    lib/         # Utilities (format, colors, utils)
    pages/       # Route pages (Dashboard, NewScan, ScanResults, etc.)
```

## Conventions
- Backend uses async SQLAlchemy with SQLite
- Frontend uses TanStack React Query for server state
- UI components follow shadcn/Radix patterns in components/ui/
- Tailwind CSS with dark theme (custom variables in index.css)
- Scanner backends implement ScannerBackend ABC (base.py)
- Background tasks use Huey (lightweight task queue with SQLite storage)
- All env vars prefixed with COLLECTIVE_

## Key Patterns
- Scan lifecycle: pending → running → parsing → analyzing → completed/failed/cancelled
- Action lifecycle: planned → dry_run → confirmed → executing → completed/failed
- WebSocket at /api/scans/{id}/ws for live scan progress
- Results paginated via PaginatedResponse schema
- Directory similarity uses Jaccard coefficient on file checksums
