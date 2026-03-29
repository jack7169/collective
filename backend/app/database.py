from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=(settings.COLLECTIVE_ENV != "production"),
    connect_args={"check_same_thread": False},
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


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


async def init_db():
    from app.models import action, assimilate, duplicate, scan, settings as settings_model, similarity  # noqa: F811

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add new columns to existing tables (SQLite ALTER TABLE)
    async with engine.begin() as conn:
        for table, column, col_type in [
            ("scans", "interrupted_phase", "TEXT"),
        ]:
            try:
                await conn.execute(
                    __import__("sqlalchemy").text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
                )
            except Exception:
                pass  # Column already exists
