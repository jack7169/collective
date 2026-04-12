# Collective

Duplicate file detection and directory consolidation tool for Unraid and Docker. Scans large storage arrays to find duplicate files, analyzes directory similarities, and provides tools to safely deduplicate — via deletion, hardlinking, symlinking, or merging.

## Features

- **Multi-engine scanning** — supports [fclones](https://github.com/pkolaczk/fclones) (default, multi-threaded) and [rmlint](https://rmlint.readthedocs.io/) (native directory detection)
- **Pick the Keeper** — one-click sandbox model for resolving duplicate groups. Pick which copy to keep, all others are marked for deletion. Smart suggestions learn from your path preferences after 3+ decisions.
- **Exploded Network hub view** — directories grouped by overlap cluster, sorted by reclaimable GB. Each hub shows all overlapping peers with similarity badges, relationship tags, and "Tag & Move" to extract canonical copies to an archive structure
- **Assimilate Duplicates** — side-by-side directory comparison with progressive-loading tree diff, smart folder collapsing, and LRU-cached results for instant revisits
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
  |-- Async engine (API server)
  |-- Shared sync engine (Huey workers + scheduler)
  |-- Scanners (fclones, rmlint)
  |-- Task Queue (Huey)
  |-- Scheduler (automatic scans)
  |
Docker (supervisord: fastapi + huey + scheduler)
```

### Database

SQLite with WAL mode, tuned for a 125GB RAM server:

- **Two engines** — async (API) and shared sync (workers/scheduler) with unified pragmas
- **WAL + busy_timeout** — 60-second lock retry, `synchronous=NORMAL` for performance
- **1GB page cache + 4GB mmap** — leverages available RAM for memory-mapped I/O
- **Indexed foreign keys** — composite indexes on `(scan_id, is_original)`, `(scan_id, group_id)`, `(scan_id, checksum)`, `(scan_id, path)` for fast queries
- **Batch operations** — large deletes (1M+ rows) processed in 50k batches to avoid lock contention
- **LRU-cached** comparison results for instant revisits
- **Versioned schema** — migrations tracked via `schema_version` in settings table

## Tech Stack

**Frontend**: React 19, TypeScript, Vite, Tailwind CSS, Radix UI (shadcn/ui), TanStack Query

**Backend**: FastAPI, SQLAlchemy 2.0 (async + sync), Huey, SQLite (WAL), orjson

**Scanners**: fclones (Rust, multi-threaded), rmlint (C, Merkle trees)

**Performance**: Producer/consumer thread pipeline overlaps JSON parsing (orjson, 5-10x faster than stdlib) with SQLite bulk inserts. Similarity analysis uses in-memory index built during parsing — skips re-reading millions of rows. Early Jaccard pruning eliminates impossible pairs before accumulation.

## License

MIT
