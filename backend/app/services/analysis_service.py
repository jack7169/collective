import logging
import os
from collections import defaultdict
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.duplicate import DuplicateFile
from app.models.similarity import DirectorySimilarity

logger = logging.getLogger(__name__)


class AnalysisService:
    @staticmethod
    async def compute_similarities(
        db: AsyncSession,
        scan_id: int,
        threshold: float = 50.0,
        depth: Optional[int] = None,
    ) -> int:
        """
        Compute Jaccard and structural similarity for all directory pairs
        that share duplicate files. Returns the number of similarity records created.
        """
        # Clear existing similarity records for this scan
        await db.execute(
            delete(DirectorySimilarity).where(DirectorySimilarity.scan_id == scan_id)
        )
        await db.flush()

        # Load all duplicate files for this scan
        result = await db.execute(
            select(DuplicateFile).where(DuplicateFile.scan_id == scan_id)
        )
        all_files = result.scalars().all()

        if not all_files:
            logger.info("No duplicate files found for scan %d", scan_id)
            return 0

        # Group files by parent directory (optionally truncated to depth)
        dir_checksums: dict[str, set[str]] = defaultdict(set)
        dir_sizes: dict[str, dict[str, int]] = defaultdict(dict)
        dir_file_count: dict[str, int] = defaultdict(int)
        dir_total_size: dict[str, int] = defaultdict(int)

        for f in all_files:
            parent = os.path.dirname(f.path)
            if depth is not None and depth > 0:
                parent = _truncate_to_depth(parent, depth)

            dir_checksums[parent].add(f.checksum)
            dir_sizes[parent][f.checksum] = f.size
            dir_file_count[parent] += 1
            dir_total_size[parent] += f.size

        directories = list(dir_checksums.keys())
        logger.info(
            "Analyzing %d directories for scan %d with threshold %.1f",
            len(directories), scan_id, threshold,
        )

        # Build inverted index: checksum -> set of directories containing it
        # This avoids O(n^2) comparison of all directory pairs
        checksum_to_dirs: dict[str, set[str]] = defaultdict(set)
        for dir_path, checksums in dir_checksums.items():
            for cksum in checksums:
                checksum_to_dirs[cksum].add(dir_path)

        # Find candidate pairs: directories that share at least one checksum
        candidate_pairs: set[tuple[str, str]] = set()
        for cksum, dirs in checksum_to_dirs.items():
            dirs_list = sorted(dirs)
            for i in range(len(dirs_list)):
                for j in range(i + 1, len(dirs_list)):
                    candidate_pairs.add((dirs_list[i], dirs_list[j]))

        logger.info("Found %d candidate directory pairs", len(candidate_pairs))

        # Compute structural similarity (bottom-up tree isomorphism)
        structural_scores = AnalysisService._compute_structural_similarity(
            dir_checksums, threshold
        )

        # Compute Jaccard similarity for each candidate pair
        similarity_records = []
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

            # Compute shared size
            shared_size = sum(
                dir_sizes[dir_a].get(cksum, dir_sizes[dir_b].get(cksum, 0))
                for cksum in shared
            )

            # Determine relationship type
            relationship = _classify_relationship(jaccard, a_subset_pct, b_subset_pct)

            # Get structural similarity score if available
            pair_key = (dir_a, dir_b) if dir_a < dir_b else (dir_b, dir_a)
            structural_sim = structural_scores.get(pair_key)

            unique_to_a = len(checksums_a - checksums_b)
            unique_to_b = len(checksums_b - checksums_a)

            record = DirectorySimilarity(
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
                structural_similarity=round(structural_sim, 2) if structural_sim is not None else None,
                unique_to_a=unique_to_a,
                unique_to_b=unique_to_b,
                relationship=relationship,
            )
            similarity_records.append(record)

        # Bulk insert
        if similarity_records:
            db.add_all(similarity_records)
            await db.flush()

        logger.info(
            "Created %d similarity records for scan %d",
            len(similarity_records), scan_id,
        )
        return len(similarity_records)

    @staticmethod
    def _compute_structural_similarity(
        dir_checksums: dict[str, set[str]],
        threshold: float,
    ) -> dict[tuple[str, str], float]:
        """
        Bottom-up structural isomorphism algorithm.

        1. Build a directory tree from all directory paths.
        2. Identify leaf directories (no children among our directories).
        3. Score leaf pairs by their Jaccard similarity.
        4. Propagate upward: parent score = fraction of matched children.

        Returns a dict mapping (dir_a, dir_b) -> structural_similarity_score.
        """
        all_dirs = set(dir_checksums.keys())
        if not all_dirs:
            return {}

        # Build parent->children mapping from the directory set
        children_map: dict[str, list[str]] = defaultdict(list)
        parent_map: dict[str, str] = {}

        for d in all_dirs:
            parent = os.path.dirname(d)
            if parent != d:
                children_map[parent].append(d)
                parent_map[d] = parent

        # Identify leaves: directories with no children in our directory set
        leaves = set()
        non_leaves = set()
        for d in all_dirs:
            child_dirs = [c for c in children_map.get(d, []) if c in all_dirs]
            if not child_dirs:
                leaves.add(d)
            else:
                non_leaves.add(d)

        # Score leaf pairs using Jaccard similarity
        leaf_scores: dict[tuple[str, str], float] = {}
        leaves_list = sorted(leaves)
        for i in range(len(leaves_list)):
            for j in range(i + 1, len(leaves_list)):
                a, b = leaves_list[i], leaves_list[j]
                checksums_a = dir_checksums.get(a, set())
                checksums_b = dir_checksums.get(b, set())
                if not checksums_a or not checksums_b:
                    continue
                union = checksums_a | checksums_b
                if not union:
                    continue
                jaccard = len(checksums_a & checksums_b) / len(union) * 100.0
                if jaccard >= threshold:
                    key = (a, b) if a < b else (b, a)
                    leaf_scores[key] = jaccard

        # Build the full structural scores starting from leaf scores
        structural_scores: dict[tuple[str, str], float] = dict(leaf_scores)

        # Propagate upward: find non-leaf directory pairs that share
        # structurally similar children
        # Collect all ancestor directories that are parents of our dirs
        ancestor_dirs: set[str] = set()
        for d in all_dirs:
            parent = os.path.dirname(d)
            while parent and parent != os.path.dirname(parent):
                ancestor_dirs.add(parent)
                parent = os.path.dirname(parent)

        # For each pair of ancestor directories, check if their children match
        matched_dirs: dict[str, set[str]] = defaultdict(set)

        # Build: for each directory, which other directories is it matched with?
        for (a, b), score in leaf_scores.items():
            if score >= threshold:
                matched_dirs[a].add(b)
                matched_dirs[b].add(a)

        # Propagate upward level by level
        # Group directories by depth (deeper first)
        def _depth(path: str) -> int:
            return path.rstrip("/").count("/")

        all_parents = set()
        for d in all_dirs:
            parent = os.path.dirname(d)
            if parent != d:
                all_parents.add(parent)

        # Process parents sorted by depth (deepest first for bottom-up)
        sorted_parents = sorted(all_parents, key=_depth, reverse=True)

        for parent_a in sorted_parents:
            children_a = [c for c in children_map.get(parent_a, []) if c in all_dirs or c in children_map]
            children_a_in_set = [c for c in children_a if c in all_dirs]
            if not children_a_in_set:
                continue

            for parent_b in sorted_parents:
                if parent_b <= parent_a:
                    continue
                children_b = [c for c in children_map.get(parent_b, []) if c in all_dirs or c in children_map]
                children_b_in_set = [c for c in children_b if c in all_dirs]
                if not children_b_in_set:
                    continue

                # Count how many children of parent_a have a match in children of parent_b
                matched_count = 0
                total_children = max(len(children_a_in_set), len(children_b_in_set))
                if total_children == 0:
                    continue

                used_b = set()
                for ca in children_a_in_set:
                    best_match = None
                    best_score = 0.0
                    for cb in children_b_in_set:
                        if cb in used_b:
                            continue
                        pair = (ca, cb) if ca < cb else (cb, ca)
                        score = structural_scores.get(pair, 0.0)
                        if score >= threshold and score > best_score:
                            best_match = cb
                            best_score = score
                    if best_match is not None:
                        matched_count += 1
                        used_b.add(best_match)

                if matched_count > 0:
                    structural_score = (matched_count / total_children) * 100.0
                    key = (parent_a, parent_b) if parent_a < parent_b else (parent_b, parent_a)
                    structural_scores[key] = structural_score

        return structural_scores


def _truncate_to_depth(path: str, depth: int) -> str:
    parts = path.rstrip("/").split("/")
    if depth <= 0 or len(parts) <= depth + 1:
        return path
    return "/".join(parts[: depth + 1])


def _classify_relationship(
    jaccard: float, a_subset_pct: float, b_subset_pct: float
) -> str:
    if jaccard >= 99.0:
        return "exact"
    elif a_subset_pct >= 95.0:
        return "subset"
    elif b_subset_pct >= 95.0:
        return "superset"
    else:
        return "overlap"
