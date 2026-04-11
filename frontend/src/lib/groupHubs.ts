import type { DirectorySimilarity } from "@/api/types";

export interface PeerEntry {
  directory: string;
  similarity: number;
  relationship: string;
  sharedFiles: number;
  sharedSize: number;
  uniqueInHub: number;
  uniqueInPeer: number;
  peerFileCount: number;
  peerSize: number;
  originalPair: DirectorySimilarity;
  hubIsA: boolean;
}

export interface DirectoryHub {
  directory: string;
  fileCount: number;
  totalSize: number;
  peers: PeerEntry[];
  totalReclaimable: number;
}

function makePeerEntry(
  pair: DirectorySimilarity,
  hubIsA: boolean
): PeerEntry {
  return {
    directory: hubIsA ? pair.dir_b : pair.dir_a,
    similarity: pair.jaccard_similarity,
    relationship: hubIsA
      ? pair.relationship ?? "overlap"
      : pair.relationship === "subset"
        ? "superset"
        : pair.relationship === "superset"
          ? "subset"
          : pair.relationship ?? "overlap",
    sharedFiles: pair.shared_files,
    sharedSize: pair.shared_size,
    uniqueInHub: hubIsA ? pair.unique_to_a : pair.unique_to_b,
    uniqueInPeer: hubIsA ? pair.unique_to_b : pair.unique_to_a,
    peerFileCount: hubIsA ? pair.files_b : pair.files_a,
    peerSize: hubIsA ? pair.size_b : pair.size_a,
    originalPair: pair,
    hubIsA,
  };
}

/**
 * Build full adjacency map from flat pairs (exposed for exploded network lookups).
 */
export function buildAdjacency(
  pairs: DirectorySimilarity[]
): Map<string, PeerEntry[]> {
  const adjacency = new Map<string, PeerEntry[]>();
  for (const pair of pairs) {
    const peersA = adjacency.get(pair.dir_a) ?? [];
    peersA.push(makePeerEntry(pair, true));
    adjacency.set(pair.dir_a, peersA);

    const peersB = adjacency.get(pair.dir_b) ?? [];
    peersB.push(makePeerEntry(pair, false));
    adjacency.set(pair.dir_b, peersB);
  }
  return adjacency;
}

/**
 * Transform flat DirectorySimilarity pairs into deduplicated DirectoryHub[].
 *
 * Algorithm:
 * 1. Build adjacency map: each directory → all its peer entries
 * 2. Score each directory by total reclaimable GB
 * 3. Greedy hub selection: highest score first, claim its peers
 * 4. Directories already claimed as peers don't become their own hub
 */
export function groupIntoHubs(pairs: DirectorySimilarity[]): DirectoryHub[] {
  if (!pairs.length) return [];

  // Filter out noise:
  // 1. Sibling pairs (same parent on both sides) — these are intra-directory
  //    overlap, not cross-directory duplication. E.g. MobileSync ↔ Backup
  //    under the same Itunes folder share iPhone data but aren't duplicates.
  // 2. Leaf pairs covered by a rollup parent.
  const rollups = pairs.filter((p) => p.is_rollup);
  const filteredPairs = pairs.filter((pair) => {
    if (pair.is_rollup) return true;

    // Suppress sibling pairs (same parent directory on both sides)
    const idxA = pair.dir_a.lastIndexOf("/");
    const idxB = pair.dir_b.lastIndexOf("/");
    if (idxA > 0 && idxB > 0) {
      const pA = pair.dir_a.slice(0, idxA);
      const pB = pair.dir_b.slice(0, idxB);
      if (pA === pB) return false;
    }

    // Suppress this leaf if a rollup covers it
    return !rollups.some(
      (r) =>
        (pair.dir_a.startsWith(r.dir_a + "/") && pair.dir_b.startsWith(r.dir_b + "/")) ||
        (pair.dir_a.startsWith(r.dir_b + "/") && pair.dir_b.startsWith(r.dir_a + "/"))
    );
  });

  const adjacency = buildAdjacency(filteredPairs);

  // Score each directory by total reclaimable
  const scores = new Map<string, number>();
  for (const [dir, peers] of adjacency) {
    const score = peers.reduce(
      (sum, p) => sum + p.sharedSize * (p.similarity / 100),
      0
    );
    scores.set(dir, score);
  }

  // Sort directories by score descending
  const sorted = [...adjacency.keys()].sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0)
  );

  // Greedy hub selection — uses prefix matching so subdirectories
  // of already-claimed paths don't become separate hubs
  const claimed = new Set<string>();
  const hubs: DirectoryHub[] = [];

  function isSubdirOfClaimed(dir: string): boolean {
    if (claimed.has(dir)) return true;
    const dirSlash = dir + "/";
    for (const c of claimed) {
      if (dirSlash.startsWith(c + "/") || (c + "/").startsWith(dirSlash)) {
        return true;
      }
    }
    return false;
  }

  for (const dir of sorted) {
    if (isSubdirOfClaimed(dir)) continue;

    // Also check if this dir's peers are subdirectories of already-claimed paths.
    // If most peers are already covered by an existing hub, this hub is redundant.
    const dirPeers = adjacency.get(dir)!;
    const coveredPeers = dirPeers.filter((p) => isSubdirOfClaimed(p.directory));
    if (coveredPeers.length > 0 && coveredPeers.length >= dirPeers.length * 0.5) continue;

    const peers = adjacency.get(dir)!;
    const firstPeer = peers[0];

    const fileCount = firstPeer.hubIsA
      ? firstPeer.originalPair.files_a
      : firstPeer.originalPair.files_b;
    const totalSize = firstPeer.hubIsA
      ? firstPeer.originalPair.size_a
      : firstPeer.originalPair.size_b;

    const sortedPeers = [...peers].sort((a, b) => b.similarity - a.similarity);

    const totalReclaimable = sortedPeers.reduce(
      (sum, p) => sum + p.sharedSize * (p.similarity / 100),
      0
    );

    hubs.push({
      directory: dir,
      fileCount,
      totalSize,
      peers: sortedPeers,
      totalReclaimable,
    });

    // Claim the hub itself and all its peers
    claimed.add(dir);
    for (const peer of sortedPeers) {
      claimed.add(peer.directory);
    }
  }

  return hubs;
}

/**
 * For a given peer directory, find its other relationships
 * (for the "Exploded Network" feature).
 */
export function getExplodedPeers(
  peerDir: string,
  hubDir: string,
  adjacency: Map<string, PeerEntry[]>
): PeerEntry[] {
  const allPeers = adjacency.get(peerDir) ?? [];
  return allPeers.filter((p) => p.directory !== hubDir);
}
