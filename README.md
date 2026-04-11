# Collective

Duplicate file detection and directory consolidation tool for Unraid and Docker. Scans large storage arrays to find duplicate files, analyzes directory similarities, and provides tools to safely deduplicate — via deletion, hardlinking, symlinking, or merging.

## Features

- **Multi-engine scanning** — supports [fclones](https://github.com/pkolaczk/fclones) (default, multi-threaded) and [rmlint](https://rmlint.readthedocs.io/) (native directory detection)
- **Pick the Keeper** — one-click sandbox model for resolving duplicate groups. Pick which copy to keep, all others are marked for deletion. Smart suggestions learn from your path preferences after 3+ decisions.
- **Directory similarity analysis** — card-based view with full directory paths, inline "Mark as Original" tagging, differences dropdown with date analysis and merge/version verdicts
- **Side-by-side comparison** — progressive-loading tree diff with smart folder collapsing, cached for instant revisits
- **Review & Apply** — two-column review popup showing files being kept vs deleted, grouped by directory, before committing changes to disk
- **Auto-save scans** — completed scans automatically saved as reusable configurations
- **Saved scans** — persistent scan configurations with optional scheduling
- **Real-time progress** — WebSocket-based live updates during scanning with elapsed timers
- **Dark mode** — full dark theme optimized for media server environments

## Quick Start

### Docker (recommended)

```bash
docker run -d \
  --name collective \
  -p 8080:8080 \
  -v /path/to/config:/data \
  -v /path/to/storage:/mnt/user:ro \
  -e PUID=99 \
  -e PGID=100 \
  ghcr.io/jackfranklin/collective:latest
```

Access the web UI at `http://localhost:8080`.

### Unraid

Install from Community Applications or use the Docker template in `docker/collective.xml`.

### Docker Compose

```bash
# Development
docker compose up

# Production
docker compose -f docker-compose.prod.yml up -d
```

## Development

### Prerequisites

- Python 3.12+
- Node.js 22+
- rmlint and/or fclones installed

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tests

```bash
cd backend
pip install pytest pytest-asyncio httpx
python -m pytest tests/ -v
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COLLECTIVE_DATABASE_URL` | `sqlite+aiosqlite:///config/collective.db` | Database connection string |
| `COLLECTIVE_CONFIG_DIR` | `/data` | Directory for config, database, and logs |
| `COLLECTIVE_DATA_DIR` | `/data` | Root data directory |
| `COLLECTIVE_BROWSE_PATHS` | `/mnt/user` | Comma-separated browsable root paths |
| `COLLECTIVE_SCANNER_DEFAULT` | `fclones` | Default scanner engine (`fclones` or `rmlint`) |
| `COLLECTIVE_SIMILARITY_THRESHOLD` | `50.0` | Default Jaccard similarity threshold (%) |
| `COLLECTIVE_SCAN_DEPTH` | `3` | Default directory depth for similarity analysis |
| `COLLECTIVE_LOG_LEVEL` | `INFO` | Logging level |
| `PUID` | `99` | User ID for file permissions (Unraid) |
| `PGID` | `100` | Group ID for file permissions (Unraid) |

## Architecture

```
Frontend (React 19 + TypeScript + Vite + Tailwind)
  |
  |-- WebSocket (scan progress)
  |-- REST API (TanStack Query)
  |
Backend (FastAPI + SQLAlchemy + SQLite)
  |
  |-- Scanners (fclones, rmlint)
  |-- Task Queue (Huey)
  |-- Scheduler (automatic scans)
  |
Docker (supervisord: fastapi + huey + scheduler)
```

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI (shadcn/ui), TanStack Query

**Backend**: FastAPI, SQLAlchemy 2.0 (async), Alembic, Huey, SQLite

**Scanners**: fclones (Rust, multi-threaded), rmlint (C, Merkle trees)

## License

MIT
