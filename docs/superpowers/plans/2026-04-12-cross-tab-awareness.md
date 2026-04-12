# Cross-Tab Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-resolve duplicate file groups when directory-level sandbox decisions make the keeper obvious, with status badges and conflict warnings.

**Architecture:** A `useMemo` in DuplicateGroupsList cross-references `session.derived.taggedOriginals` and `session.derived.markedForDelete` with duplicate group files to compute auto-resolved keepers. DuplicateGroupCard displays per-file status badges and auto-resolution banners. No new files, no backend changes.

**Tech Stack:** React useMemo, existing sandbox derived state, existing component patterns

---

## File Structure

| File | Action | Change |
|---|---|---|
| `frontend/src/components/results/DuplicateGroupsList.tsx` | Modify | Add auto-resolution memo, update stats, pass data to cards |
| `frontend/src/components/results/DuplicateGroupCard.tsx` | Modify | Add per-file status badges, auto-resolved banner, conflict warning |

---

### Task 1: Auto-Resolution Logic in DuplicateGroupsList

**Files:**
- Modify: `frontend/src/components/results/DuplicateGroupsList.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/DuplicateGroupsList.tsx` to understand the current `keeperStats` memo and how groups are passed to cards.

- [ ] **Step 2: Add the auto-resolution memo**

After the existing `keeperStats` useMemo, add a new memo that computes auto-resolved keepers by cross-referencing sandbox directory decisions with duplicate group files.

```typescript
// Auto-resolve keepers from directory-level sandbox decisions
const autoResolved = useMemo(() => {
  const result = new Map<string, { fileId: number; reason: string }>();
  if (!groups) return result;

  const tagged = session.derived.taggedOriginals;
  const doomed = session.derived.markedForDelete;
  if (tagged.size === 0 && doomed.size === 0) return result;

  for (const group of groups) {
    // Skip groups the user already manually resolved
    if (session.derived.keepers.has(group.checksum)) continue;

    let candidateId: number | null = null;
    let candidateDir = "";
    let candidateCount = 0;
    let allOthersDoomed = true;

    for (const file of group.files) {
      const inOriginal = [...tagged].some((d) => file.path.startsWith(d + "/"));
      const inDoomed = [...doomed.keys()].some((d) => file.path.startsWith(d + "/"));

      if (inOriginal) {
        candidateId = file.id;
        candidateDir = [...tagged].find((d) => file.path.startsWith(d + "/"))!;
        candidateCount++;
      }
      if (!inOriginal && !inDoomed) {
        allOthersDoomed = false;
      }
    }

    // Auto-resolve: exactly one file in original dir
    if (candidateCount === 1 && candidateId !== null) {
      const dirName = candidateDir.split("/").pop() || candidateDir;
      result.set(group.checksum, {
        fileId: candidateId,
        reason: `Keeper is in tagged original: ${dirName}`,
      });
    }
  }

  return result;
}, [groups, session.derived.taggedOriginals, session.derived.markedForDelete, session.derived.keepers]);
```

- [ ] **Step 3: Compute effective keeper (manual > auto > none)**

Add a helper function inside the component (or before the return):

```typescript
const getEffectiveKeeper = (checksum: string): number | undefined => {
  return session.derived.keepers.get(checksum) ?? autoResolved.get(checksum)?.fileId;
};
```

- [ ] **Step 4: Update keeperStats to include auto-resolved groups**

Replace the existing `keeperStats` memo to count both manual and auto-resolved:

```typescript
const keeperStats = useMemo(() => {
  let manualCount = 0;
  let autoCount = 0;
  let totalReclaimable = 0;
  let totalDeleteFiles = 0;
  if (!groups) return { manualCount, autoCount, resolvedCount: 0, totalReclaimable, totalDeleteFiles };

  for (const group of groups) {
    const manualKeeper = session.derived.keepers.get(group.checksum);
    const autoKeeper = autoResolved.get(group.checksum)?.fileId;
    const effectiveKeeper = manualKeeper ?? autoKeeper;

    if (effectiveKeeper != null) {
      if (manualKeeper != null) manualCount++;
      else autoCount++;

      for (const file of group.files) {
        if (file.id !== effectiveKeeper) {
          totalDeleteFiles++;
          totalReclaimable += file.size;
        }
      }
    }
  }
  return {
    manualCount,
    autoCount,
    resolvedCount: manualCount + autoCount,
    totalReclaimable,
    totalDeleteFiles,
  };
}, [groups, session.derived.keepers, autoResolved]);
```

- [ ] **Step 5: Update toolbar stats display**

Find the stats display in the toolbar (the line showing "X of Y groups resolved"). Update it to show the breakdown:

```typescript
<span className="text-sm text-muted-foreground">
  {keeperStats.resolvedCount} of {totalGroups} resolved
  {keeperStats.autoCount > 0 && (
    <span className="text-success ml-1">
      ({keeperStats.autoCount} auto, {keeperStats.manualCount} manual)
    </span>
  )}
  {" · "}
  <span className="text-destructive font-medium">
    {formatBytes(keeperStats.totalReclaimable)} reclaimable
  </span>
</span>
```

- [ ] **Step 6: Pass auto-resolution data and file status to DuplicateGroupCard**

Update the props passed to each `DuplicateGroupCard`. Add `autoResolution` and `fileStatuses`:

First, compute file statuses for each group inline when mapping:

```typescript
{groups.map((group) => {
  const effectiveKeeper = getEffectiveKeeper(group.checksum);
  const auto = autoResolved.get(group.checksum);

  // Compute per-file status
  const fileStatuses = new Map<number, "original" | "doomed" | "neutral">();
  for (const file of group.files) {
    const inOriginal = [...session.derived.taggedOriginals].some((d) => file.path.startsWith(d + "/"));
    const inDoomed = [...session.derived.markedForDelete.keys()].some((d) => file.path.startsWith(d + "/"));
    fileStatuses.set(file.id, inOriginal ? "original" : inDoomed ? "doomed" : "neutral");
  }

  return (
    <DuplicateGroupCard
      key={group.checksum}
      group={group}
      keeperFileId={effectiveKeeper}
      suggestion={...existing suggestion logic...}
      autoResolution={auto}
      fileStatuses={fileStatuses}
      onSetKeeper={...}
      onClearKeeper={...}
      onAcceptSuggestion={...}
    />
  );
})}
```

Note: Keep the existing suggestion and callback logic unchanged. Just add the two new props.

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit --pretty 2>&1 | head -30`

This will fail because DuplicateGroupCard doesn't accept the new props yet — that's Task 2.

- [ ] **Step 8: Commit work in progress**

```bash
git add frontend/src/components/results/DuplicateGroupsList.tsx
git commit -m "feat(cross-tab): auto-resolution logic + effective keeper + stats breakdown"
```

---

### Task 2: Status Badges, Banner, and Conflict Warning in DuplicateGroupCard

**Files:**
- Modify: `frontend/src/components/results/DuplicateGroupCard.tsx`

- [ ] **Step 1: Read the current file**

Read `frontend/src/components/results/DuplicateGroupCard.tsx` to understand the props interface and file rendering.

- [ ] **Step 2: Add new props to the interface**

```typescript
interface DuplicateGroupCardProps {
  group: DuplicateGroup;
  keeperFileId: number | undefined;
  suggestion: SuggestedKeeper | undefined;
  autoResolution?: { fileId: number; reason: string };
  fileStatuses?: Map<number, "original" | "doomed" | "neutral">;
  onSetKeeper: (checksum: string, fileId: number) => void;
  onClearKeeper: (checksum: string) => void;
  onAcceptSuggestion: (checksum: string) => void;
}
```

- [ ] **Step 3: Add auto-resolved banner**

At the top of the card body (before the file list), if `autoResolution` exists and the current keeper matches the auto-resolved file:

```typescript
{autoResolution && keeperFileId === autoResolution.fileId && (
  <div className="px-4 py-2 bg-success/5 border-b border-success/20 flex items-center gap-2">
    <CheckCircle className="h-3.5 w-3.5 text-success" />
    <span className="text-xs text-success">
      {autoResolution.reason}
    </span>
  </div>
)}
```

Add `CheckCircle` to the lucide-react import.

- [ ] **Step 4: Add per-file status badges**

In the file row rendering, after the file path display, add a status badge based on `fileStatuses`:

```typescript
{fileStatuses?.get(file.id) === "original" && (
  <span className="text-[9px] font-medium text-success bg-success/10 px-1.5 py-0.5 rounded">
    Original dir
  </span>
)}
{fileStatuses?.get(file.id) === "doomed" && (
  <span className="text-[9px] font-medium text-destructive bg-destructive/10 px-1.5 py-0.5 rounded">
    Pending delete
  </span>
)}
```

- [ ] **Step 5: Add conflict warning**

If the user manually selects a keeper whose status is "doomed" (parent directory staged for deletion), show a warning below the file:

```typescript
{isKeeper && fileStatuses?.get(file.id) === "doomed" && (
  <div className="mt-1 flex items-center gap-1.5 text-[10px] text-amber-400">
    <AlertTriangle className="h-3 w-3" />
    Parent directory is staged for deletion — keeper will be lost
  </div>
)}
```

Add `AlertTriangle` to the lucide-react import.

- [ ] **Step 6: Visually subdue non-keeper files in auto-resolved groups**

When a group is auto-resolved, non-keeper files should be slightly faded:

```typescript
const isAutoResolved = autoResolution && keeperFileId === autoResolution.fileId;
// On each file row div:
className={cn(
  "...",
  isAutoResolved && !isKeeper && "opacity-50"
)}
```

- [ ] **Step 7: Verify TypeScript compiles and build**

Run: `cd /Users/jackf/Documents/Development/Collective/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: Both pass

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/results/DuplicateGroupCard.tsx
git commit -m "feat(cross-tab): status badges, auto-resolved banner, conflict warning"
```

---

### Task 3: Deploy and Verify

**Files:** None (deployment)

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy**

```bash
rsync -avz --exclude=node_modules --exclude=.git --exclude=__pycache__ --exclude='*.pyc' --exclude=dist --exclude=.venv /Users/jackf/Documents/Development/Collective/ root@192.168.50.45:/tmp/collective-build/
ssh root@192.168.50.45 "cd /tmp/collective-build && docker build --no-cache -f docker/Dockerfile -t collective:latest ."
ssh root@192.168.50.45 "docker stop collective && docker rm collective && docker run -d --name collective --restart unless-stopped -p 8080:8080 -v /mnt/user:/mnt/user -v /mnt/user/appdata/collective:/data collective:latest"
```

- [ ] **Step 3: Verify**

```bash
ssh root@192.168.50.45 "docker logs collective --tail 15 2>&1"
```

- [ ] **Step 4: Test the cross-tab flow**

1. Open a completed scan → Similar Directories tab
2. Tag a hub as original, mark peers for deletion via Tag & Move
3. Switch to Duplicate Files tab
4. Groups containing files from the tagged/deleted directories should show:
   - Auto-resolved banner (green) with "Keeper is in tagged original: {dirname}"
   - Green "Original dir" badge on keeper file
   - Red "Pending delete" badge on files in doomed directories
   - Toolbar: "X resolved (Y auto, Z manual)"
5. Manually override an auto-resolved group → the manual choice takes precedence
6. Undo the directory-level decision → auto-resolution disappears, group returns to unresolved
