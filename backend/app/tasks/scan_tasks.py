import logging
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone

from sqlalchemy import create_engine, select, delete, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import Base
from app.models.duplicate import DuplicateDirectory, DuplicateFile
from app.models.scan import Scan
from app.models.similarity import DirectorySimilarity
from app.scanners.base import DuplicateDirResult, DuplicateFileResult
from app.scanners.fclones import FclonesBackend
from app.scanners.rmlint import RmlintBackend
from app.tasks.worker import huey

logger = logging.getLogger(__name__)


def _get_sync_session() -> Session:
    """Create a synchronous SQLAlchemy session for Huey worker context."""
    settings = get_settings()
    sync_url = settings.DATABASE_URL.replace("sqlite+aiosqlite:", "sqlite:")
    engine = create_engine(sync_url, connect_args={"check_same_thread": False})
    return Session(engine)


def _update_progress(session: Session, scan_id: int, **kwargs):
    """Update scan progress fields."""
    scan = session.get(Scan, scan_id)
    if scan:
        for key, value in kwargs.items():
            if hasattr(scan, key):
                setattr(scan, key, value)
        session.commit()


@huey.task()
def run_scan_task(scan_id: int):
    """Execute full scan pipeline synchronously (runs in Huey worker)."""
    session = _get_sync_session()
    try:
        scan = session.get(Scan, scan_id)
        if not scan:
            logger.error("Scan %d not found", scan_id)
            return

        if scan.status == "cancelled":
            logger.info("Scan %d was cancelled before starting", scan_id)
            return

        # Update status to running
        scan.status = "running"
        scan.started_at = datetime.now(timezone.utc)
        scan.progress_percent = 0.0
        scan.progress_message = "Starting scan..."
        session.commit()

        # Select scanner backend
        if scan.scanner == "fclones":
            backend = FclonesBackend()
        else:
            backend = RmlintBackend()

        # Create temp output file
        settings = get_settings()
        os.makedirs(settings.CONFIG_DIR, exist_ok=True)
        output_path = os.path.join(settings.CONFIG_DIR, f"scan_{scan_id}_output.json")

        # Build command
        cmd = backend.build_command(
            target_paths=scan.target_paths,
            tagged_paths=scan.tagged_paths,
            extra_flags=scan.scanner_flags,
            output_path=output_path,
        )
        logger.info("Running command: %s", " ".join(cmd))

        # Run subprocess
        try:
            import threading
            import pty
            import select
            import re as _re

            # Use Python's pty module so rmlint thinks it has a terminal
            # and outputs its progress bar in real-time
            master_fd, slave_fd = pty.openpty()

            # Set terminal size so rmlint progress bar renders
            import struct, fcntl, termios
            winsize = struct.pack("HHHH", 24, 80, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)

            proc = subprocess.Popen(
                cmd,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                close_fds=True,
            )
            os.close(slave_fd)

            scan.progress_message = f"Starting {scan.scanner} on {', '.join(scan.target_paths)}..."
            session.commit()

            # Background thread reads PTY output
            output_lines: list[str] = []
            _lock = threading.Lock()

            def _reader():
                buf = ""
                while True:
                    try:
                        ready, _, _ = select.select([master_fd], [], [], 1.0)
                        if not ready:
                            if proc.poll() is not None:
                                break
                            continue
                        chunk = os.read(master_fd, 4096)
                        if not chunk:
                            break
                    except OSError:
                        # EIO = slave closed (process exited) — normal
                        break
                    text = chunk.decode("utf-8", errors="replace")
                    buf += text
                    while "\n" in buf or "\r" in buf:
                        idx = -1
                        for sep in ("\n", "\r"):
                            i = buf.find(sep)
                            if i >= 0 and (idx < 0 or i < idx):
                                idx = i
                        if idx < 0:
                            break
                        line = buf[:idx]
                        buf = buf[idx + 1:]
                        line = _re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", line)
                        line = _re.sub(r"\x1b\[\?[0-9]*[a-zA-Z]", "", line)
                        line = line.strip()
                        if line:
                            with _lock:
                                output_lines.append(line)

            reader_thread = threading.Thread(target=_reader, daemon=True)
            reader_thread.start()

            # Poll loop — update DB every second
            poll_count = 0
            log_buffer: list[str] = []  # rolling log of last 20 lines

            while proc.poll() is None:
                time.sleep(1)
                poll_count += 1

                # Check cancellation
                session.refresh(scan)
                if scan.status == "cancelled":
                    proc.kill()
                    logger.info("Scan %d cancelled during execution", scan_id)
                    return

                # Drain new lines
                new_lines: list[str] = []
                with _lock:
                    new_lines = list(output_lines)
                    output_lines.clear()

                last_parsed_msg = None
                for line in new_lines:
                    progress = backend.parse_progress(line)
                    if progress:
                        if progress.percent is not None:
                            scan.progress_percent = progress.percent
                        if progress.total_files is not None:
                            scan.total_files = progress.total_files
                        if progress.total_dirs is not None:
                            scan.total_dirs = progress.total_dirs
                        if progress.total_size is not None:
                            scan.total_size = progress.total_size
                        if progress.message:
                            last_parsed_msg = progress.message
                    else:
                        # Only non-progress lines go in the log buffer
                        clean = _re.sub(r"[▕▏░▒▓█<=>[\]|#\-]+", "", line).strip()
                        if clean and len(clean) > 5:
                            log_buffer.append(clean)
                            if len(log_buffer) > 30:
                                log_buffer.pop(0)

                # Build progress message
                elapsed_min = poll_count // 60
                elapsed_sec = poll_count % 60
                time_str = f"{elapsed_min}m {elapsed_sec}s" if elapsed_min > 0 else f"{elapsed_sec}s"

                if last_parsed_msg:
                    scan.progress_message = f"[{time_str}] {last_parsed_msg}"
                elif log_buffer:
                    # Deduplicate and show last unique lines
                    seen = []
                    for l in reversed(log_buffer):
                        if l not in seen:
                            seen.append(l)
                        if len(seen) >= 5:
                            break
                    seen.reverse()
                    scan.progress_message = f"[{time_str}]\n" + "\n".join(seen)
                else:
                    scan.progress_message = f"Scanner running... {time_str} elapsed"

                session.commit()

            reader_thread.join(timeout=5)
            try:
                os.close(master_fd)
            except OSError:
                pass

            if proc.returncode not in (0, None):
                stderr_out = "\n".join(log_buffer) if log_buffer else ""
                # rmlint returns non-zero when it finds duplicates, which is expected
                if scan.scanner == "rmlint" and proc.returncode in (1, 2):
                    logger.info("rmlint returned %d (found duplicates)", proc.returncode)
                else:
                    raise RuntimeError(
                        f"Scanner exited with code {proc.returncode}: {stderr_out}"
                    )

        except FileNotFoundError:
            scan.status = "failed"
            scan.error_message = f"Scanner '{scan.scanner}' not found. Is it installed?"
            scan.completed_at = datetime.now(timezone.utc)
            session.commit()
            return

        # Parsing phase
        scan.status = "parsing"
        scan.progress_percent = 60.0
        scan.progress_message = "Parsing scanner output..."
        session.commit()

        if not os.path.exists(output_path):
            scan.status = "failed"
            scan.error_message = "Scanner output file not found"
            scan.completed_at = datetime.now(timezone.utc)
            session.commit()
            return

        # Parse output and insert records
        file_records = []
        dir_records = []
        total_files = 0
        total_size = 0
        duplicates = 0
        unique_dirs: set[str] = set()

        for result in backend.parse_output(output_path):
            if isinstance(result, DuplicateFileResult):
                file_records.append(DuplicateFile(
                    scan_id=scan_id,
                    checksum=result.checksum,
                    path=result.path,
                    size=result.size,
                    mtime=result.mtime,
                    is_original=result.is_original,
                    group_id=result.group_id,
                ))
                total_files += 1
                total_size += result.size
                unique_dirs.add(os.path.dirname(result.path))
                if not result.is_original:
                    duplicates += 1
            elif isinstance(result, DuplicateDirResult):
                dir_records.append(DuplicateDirectory(
                    scan_id=scan_id,
                    group_id=result.group_id,
                    path=result.path,
                    file_count=result.file_count,
                    total_size=result.total_size,
                    is_original=result.is_original,
                ))
                unique_dirs.add(result.path)

        # Bulk insert in batches
        batch_size = 1000
        for i in range(0, len(file_records), batch_size):
            session.add_all(file_records[i:i + batch_size])
            session.flush()

        for i in range(0, len(dir_records), batch_size):
            session.add_all(dir_records[i:i + batch_size])
            session.flush()

        session.commit()

        scan.total_files = total_files
        scan.total_dirs = len(unique_dirs)
        scan.total_size = total_size
        scan.duplicates_found = duplicates
        scan.space_recoverable = sum(
            r.size for r in file_records if not r.is_original
        )

        # Analysis phase
        scan.status = "analyzing"
        scan.progress_percent = 80.0
        scan.progress_message = "Computing directory similarities..."
        session.commit()

        # Run synchronous similarity analysis
        similarity_count = _compute_similarities_sync(
            session,
            scan_id,
            threshold=scan.similarity_threshold or 50.0,
            depth=scan.scan_depth,
        )

        # Complete
        scan.status = "completed"
        scan.progress_percent = 100.0
        scan.progress_message = f"Done. Found {duplicates} duplicates, {similarity_count} similar directory pairs."
        scan.completed_at = datetime.now(timezone.utc)
        session.commit()

        # Clean up output file
        try:
            os.remove(output_path)
        except OSError:
            pass

        logger.info("Scan %d completed successfully", scan_id)

    except Exception as e:
        logger.exception("Scan %d failed: %s", scan_id, e)
        try:
            scan = session.get(Scan, scan_id)
            if scan:
                scan.status = "failed"
                scan.error_message = str(e)
                scan.completed_at = datetime.now(timezone.utc)
                session.commit()
        except Exception:
            logger.exception("Failed to update scan status after error")
    finally:
        session.close()


@huey.task()
def run_reanalysis_task(scan_id: int):
    """Re-run similarity analysis on existing scan data."""
    session = _get_sync_session()
    try:
        scan = session.get(Scan, scan_id)
        if not scan:
            logger.error("Scan %d not found", scan_id)
            return

        scan.status = "analyzing"
        scan.progress_percent = 50.0
        scan.progress_message = "Re-computing directory similarities..."
        session.commit()

        # Clear existing similarities
        session.execute(
            delete(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan_id)
        )
        session.commit()

        similarity_count = _compute_similarities_sync(
            session,
            scan_id,
            threshold=scan.similarity_threshold or 50.0,
            depth=scan.scan_depth,
        )

        scan.status = "completed"
        scan.progress_percent = 100.0
        scan.progress_message = f"Reanalysis complete. Found {similarity_count} similar directory pairs."
        scan.completed_at = datetime.now(timezone.utc)
        session.commit()

    except Exception as e:
        logger.exception("Reanalysis for scan %d failed: %s", scan_id, e)
        try:
            scan = session.get(Scan, scan_id)
            if scan:
                scan.status = "failed"
                scan.error_message = str(e)
                session.commit()
        except Exception:
            pass
    finally:
        session.close()


def _compute_similarities_sync(
    session: Session,
    scan_id: int,
    threshold: float,
    depth: int | None,
) -> int:
    """Synchronous version of similarity computation for Huey worker."""
    from collections import defaultdict

    # Load all duplicate files
    files = session.execute(
        select(DuplicateFile).where(DuplicateFile.scan_id == scan_id)
    ).scalars().all()

    if not files:
        return 0

    # Group by parent directory
    dir_checksums: dict[str, set[str]] = defaultdict(set)
    dir_sizes: dict[str, dict[str, int]] = defaultdict(dict)
    dir_total_size: dict[str, int] = defaultdict(int)

    for f in files:
        parent = os.path.dirname(f.path)
        if depth is not None and depth > 0:
            parts = parent.rstrip("/").split("/")
            if len(parts) > depth + 1:
                parent = "/".join(parts[:depth + 1])

        dir_checksums[parent].add(f.checksum)
        dir_sizes[parent][f.checksum] = f.size
        dir_total_size[parent] += f.size

    # Build inverted index
    checksum_to_dirs: dict[str, set[str]] = defaultdict(set)
    for dir_path, checksums in dir_checksums.items():
        for cksum in checksums:
            checksum_to_dirs[cksum].add(dir_path)

    # Find candidate pairs
    candidate_pairs: set[tuple[str, str]] = set()
    for cksum, dirs in checksum_to_dirs.items():
        dirs_list = sorted(dirs)
        for i in range(len(dirs_list)):
            for j in range(i + 1, len(dirs_list)):
                candidate_pairs.add((dirs_list[i], dirs_list[j]))

    # Compute similarities
    records = []
    for dir_a, dir_b in candidate_pairs:
        checksums_a = dir_checksums[dir_a]
        checksums_b = dir_checksums[dir_b]

        shared = checksums_a & checksums_b
        union = checksums_a | checksums_b
        if not union:
            continue

        shared_count = len(shared)
        jaccard = (shared_count / len(union)) * 100.0
        if jaccard < threshold:
            continue

        a_subset_pct = (shared_count / len(checksums_a)) * 100.0 if checksums_a else 0.0
        b_subset_pct = (shared_count / len(checksums_b)) * 100.0 if checksums_b else 0.0

        shared_size = sum(
            dir_sizes[dir_a].get(cksum, dir_sizes[dir_b].get(cksum, 0))
            for cksum in shared
        )

        if jaccard >= 99.0:
            relationship = "exact"
        elif a_subset_pct >= 95.0:
            relationship = "subset"
        elif b_subset_pct >= 95.0:
            relationship = "superset"
        else:
            relationship = "overlap"

        records.append(DirectorySimilarity(
            scan_id=scan_id,
            dir_a=dir_a,
            dir_b=dir_b,
            files_a=len(checksums_a),
            files_b=len(checksums_b),
            shared_files=shared_count,
            shared_size=shared_size,
            size_a=dir_total_size[dir_a],
            size_b=dir_total_size[dir_b],
            jaccard_similarity=round(jaccard, 2),
            a_subset_pct=round(a_subset_pct, 2),
            b_subset_pct=round(b_subset_pct, 2),
            structural_similarity=None,
            unique_to_a=len(checksums_a - checksums_b),
            unique_to_b=len(checksums_b - checksums_a),
            relationship=relationship,
        ))

    # Bulk insert
    batch_size = 1000
    for i in range(0, len(records), batch_size):
        session.add_all(records[i:i + batch_size])
        session.flush()
    session.commit()

    return len(records)
