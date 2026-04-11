from sqlalchemy import (
    BigInteger, Boolean, Column, Float, ForeignKey, Index, Integer,
    String, UniqueConstraint,
)
from app.database import Base


class DirectorySimilarity(Base):
    __tablename__ = "directory_similarities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    scan_id = Column(Integer, ForeignKey("scans.id", ondelete="CASCADE"), nullable=False)
    dir_a = Column(String, nullable=False)
    dir_b = Column(String, nullable=False)
    files_a = Column(Integer, nullable=False)
    files_b = Column(Integer, nullable=False)
    shared_files = Column(Integer, nullable=False)
    shared_size = Column(BigInteger, nullable=False)
    size_a = Column(BigInteger, nullable=False)
    size_b = Column(BigInteger, nullable=False)
    jaccard_similarity = Column(Float, nullable=False)
    a_subset_pct = Column(Float, nullable=False)
    b_subset_pct = Column(Float, nullable=False)
    structural_similarity = Column(Float, nullable=True)
    unique_to_a = Column(Integer, nullable=False)
    unique_to_b = Column(Integer, nullable=False)
    relationship = Column(String, nullable=True)
    is_rollup = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        UniqueConstraint("scan_id", "dir_a", "dir_b", name="uq_similarity_scan_dirs"),
        Index("ix_similarity_jaccard", "scan_id", jaccard_similarity.desc()),
        Index("ix_similarity_shared_size", "scan_id", shared_size.desc()),
    )
