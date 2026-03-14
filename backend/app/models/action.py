from sqlalchemy import (
    BigInteger, Column, DateTime, ForeignKey, Integer, String, Text, func,
)
from app.database import Base


class Action(Base):
    __tablename__ = "actions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="SET NULL"), nullable=True)
    similarity_id = Column(
        Integer, ForeignKey("directory_similarities.id", ondelete="SET NULL"), nullable=True
    )
    action_type = Column(String, nullable=False)
    source_path = Column(String, nullable=False)
    dest_path = Column(String, nullable=True)
    status = Column(String, default="planned", nullable=False)
    dry_run_output = Column(Text, nullable=True)
    files_affected = Column(Integer, nullable=True)
    bytes_affected = Column(BigInteger, nullable=True)
    executed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    dir_path = Column(String, nullable=False)
    label = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    color = Column(String, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
