from sqlalchemy import (
    BigInteger, Boolean, Column, Float, ForeignKey, Index, Integer,
    String, UniqueConstraint,
)
from app.database import Base


class DuplicateFile(Base):
    __tablename__ = "duplicate_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    checksum = Column(String, nullable=False)
    path = Column(String, nullable=False)
    size = Column(BigInteger, nullable=False)
    mtime = Column(Float, nullable=True)
    is_original = Column(Boolean, default=False, nullable=False)
    group_id = Column(String, nullable=True)

    __table_args__ = (
        Index("ix_duplicate_files_scan_id", "scan_id"),
        Index("ix_duplicate_files_scan_checksum", "scan_id", "checksum"),
        Index("ix_duplicate_files_scan_path", "scan_id", "path"),
        Index("ix_duplicate_files_scan_is_original", "scan_id", "is_original"),
        Index("ix_duplicate_files_scan_group", "scan_id", "group_id"),
        UniqueConstraint("scan_id", "path", name="uq_duplicate_files_scan_path"),
    )


class DuplicateDirectory(Base):
    __tablename__ = "duplicate_directories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    group_id = Column(String, nullable=False)
    path = Column(String, nullable=False)
    file_count = Column(Integer, nullable=False)
    total_size = Column(BigInteger, nullable=False)
    is_original = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        Index("ix_duplicate_dirs_scan_id", "scan_id"),
        Index("ix_duplicate_dirs_scan_group", "scan_id", "group_id"),
        UniqueConstraint("scan_id", "path", name="uq_duplicate_dirs_scan_path"),
    )
