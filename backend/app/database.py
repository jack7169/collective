from sqlalchemy import create_engine, event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

# --- SQLite performance pragmas applied to ALL connections ---
_SQLITE_PRAGMAS = [
    "PRAGMA journal_mode=WAL",
    "PRAGMA foreign_keys=ON",
    "PRAGMA busy_timeout=60000",
    "PRAGMA synchronous=NORMAL",
    "PRAGMA cache_size=-1000000",    # 1GB cache (was 64MB) — leverage available RAM
    "PRAGMA temp_store=MEMORY",
    "PRAGMA mmap_size=4294967296",   # 4GB memory-mapped I/O
]


def _apply_pragmas(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    for pragma in _SQLITE_PRAGMAS:
        cursor.execute(pragma)
    cursor.close()


# --- Async engine (FastAPI API server) ---
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False, "timeout": 60},
)
event.listens_for(engine.sync_engine, "connect")(_apply_pragmas)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# --- Sync engine (Huey workers + scheduler) ---
_sync_url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
_sync_engine = create_engine(
    _sync_url,
    connect_args={"check_same_thread": False, "timeout": 60},
    pool_size=5,
    max_overflow=0,
    pool_pre_ping=True,
)
event.listens_for(_sync_engine, "connect")(_apply_pragmas)

_SyncSessionFactory = sessionmaker(bind=_sync_engine)


def get_sync_session() -> Session:
    """Return a sync session for Huey workers and the scheduler."""
    return _SyncSessionFactory()


# --- Base ---
class Base(DeclarativeBase):
    pass


# --- Dependency ---
async def get_db():
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# --- Initialization ---
async def init_db():
    from app.models import action, assimilate, duplicate, scan, settings as settings_model, similarity  # noqa: F811

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Versioned schema migrations for existing databases
    async with engine.begin() as conn:
        # Ensure settings table exists for version tracking
        try:
            result = await conn.execute(text("SELECT value FROM settings WHERE key = 'schema_version'"))
            row = result.first()
            current_version = int(row[0]) if row else 0
        except Exception:
            current_version = 0

        if current_version < 1:
            # v1: Add interrupt/resume columns
            for tbl, col, col_type in [
                ("scans", "interrupted_phase", "TEXT"),
                ("scans", "resumed_at", "TIMESTAMP"),
                ("scans", "accumulated_seconds", "INTEGER DEFAULT 0"),
            ]:
                try:
                    await conn.execute(text(f"ALTER TABLE {tbl} ADD COLUMN {col} {col_type}"))
                except Exception:
                    pass  # Column already exists

            # v1: Add missing indexes for performance
            for idx_sql in [
                "CREATE INDEX IF NOT EXISTS ix_duplicate_files_scan_id ON duplicate_files (scan_id)",
                "CREATE INDEX IF NOT EXISTS ix_duplicate_dirs_scan_id ON duplicate_directories (scan_id)",
                "CREATE INDEX IF NOT EXISTS ix_scans_created_at ON scans (created_at)",
                "CREATE INDEX IF NOT EXISTS ix_scans_saved_scan_id ON scans (saved_scan_id)",
                "CREATE INDEX IF NOT EXISTS ix_actions_scan_id ON actions (scan_id)",
                "CREATE INDEX IF NOT EXISTS ix_bookmarks_scan_id ON bookmarks (scan_id)",
            ]:
                try:
                    await conn.execute(text(idx_sql))
                except Exception:
                    pass

            await conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '1')"
            ))

        if current_version < 2:
            # v2: Add is_rollup column for parent-level directory rollup
            try:
                await conn.execute(text(
                    "ALTER TABLE directory_similarities ADD COLUMN is_rollup BOOLEAN DEFAULT 0"
                ))
            except Exception:
                pass

            await conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '2')"
            ))

        if current_version < 3:
            # v3: New indexes for performance
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_files_scan_is_original "
                "ON duplicate_files (scan_id, is_original)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_files_scan_group "
                "ON duplicate_files (scan_id, group_id)"
            ))
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_duplicate_dirs_scan_group "
                "ON duplicate_directories (scan_id, group_id)"
            ))
            await conn.execute(text(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('schema_version', '3')"
            ))
