import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronUp,
  Zap,
  Shield,
  Play,
} from "lucide-react";
import { useCreateScan } from "@/api/scans";
import { useScanners } from "@/hooks/useBrowse";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { PathPicker } from "@/components/scan/PathPicker";
import { cn } from "@/lib/utils";

export function NewScan() {
  const navigate = useNavigate();
  const createScan = useCreateScan();
  const { data: scanners } = useScanners();

  const [name, setName] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanner, setScanner] = useState<"rmlint" | "fclones">("rmlint");
  const [depth, setDepth] = useState(5);
  const [customFlags, setCustomFlags] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || selectedPaths.length === 0) return;

    try {
      const scan = await createScan.mutateAsync({
        name: name.trim(),
        scanner,
        target_paths: selectedPaths,
        scan_depth: depth,
        // Low threshold to capture everything — user filters post-scan
        similarity_threshold: 10,
      });
      navigate(`/scans/${scan.id}/progress`);
    } catch {
      // Error handled by mutation state
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">New Scan</h1>
        <p className="text-muted-foreground mt-1">
          Select directories to scan for duplicates. You can tag originals and
          fine-tune similarity after the scan completes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Scan name */}
        <Card>
          <CardHeader>
            <CardTitle>Scan Name</CardTitle>
            <CardDescription>
              Give this scan a descriptive name
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Input
              placeholder="e.g., Media server cleanup"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </CardContent>
        </Card>

        {/* Path picker */}
        <Card>
          <CardHeader>
            <CardTitle>Scan Paths</CardTitle>
            <CardDescription>
              Select directories to scan for duplicates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PathPicker
              selectedPaths={selectedPaths}
              onChange={setSelectedPaths}
            />
          </CardContent>
        </Card>

        {/* Advanced options */}
        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex w-full items-center justify-between"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <div className="text-left">
                <CardTitle>Advanced Options</CardTitle>
                <CardDescription>
                  Scanner engine, depth, and custom flags
                </CardDescription>
              </div>
              {showAdvanced ? (
                <ChevronUp className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              )}
            </button>
          </CardHeader>
          {showAdvanced && (
            <CardContent className="space-y-6">
              {/* Scanner selection */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Scanner Engine</label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setScanner("rmlint")}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                      scanner === "rmlint"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Shield className="h-5 w-5 text-primary" />
                      <span className="font-medium">rmlint</span>
                      <Badge variant="secondary" className="text-xs">
                        Default
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Native directory-level detection with Merkle trees.
                    </p>
                    {scanners?.rmlint?.installed && (
                      <span className="text-[10px] text-muted-foreground">
                        {scanners.rmlint.version}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setScanner("fclones")}
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
                      scanner === "fclones"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Zap className="h-5 w-5 text-warning" />
                      <span className="font-medium">fclones</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Fastest file hasher. HDD-optimized I/O.
                    </p>
                    {scanners?.fclones?.installed && (
                      <span className="text-[10px] text-muted-foreground">
                        {scanners.fclones.version}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              <Separator />

              {/* Scan depth */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">Scan Depth</label>
                  <span className="text-sm text-muted-foreground">
                    {depth}
                  </span>
                </div>
                <Slider
                  value={[depth]}
                  onValueChange={([v]) => setDepth(v ?? 5)}
                  min={1}
                  max={10}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  Directory depth for similarity grouping. Higher = more
                  granular.
                </p>
              </div>

              <Separator />

              {/* Custom flags */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Custom Flags</label>
                <textarea
                  value={customFlags}
                  onChange={(e) => setCustomFlags(e.target.value)}
                  placeholder="Additional command-line flags for the scanner..."
                  className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                />
              </div>
            </CardContent>
          )}
        </Card>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {selectedPaths.length === 0
              ? "Select at least one path to scan"
              : `${selectedPaths.length} path${selectedPaths.length > 1 ? "s" : ""} selected`}
          </p>
          <Button
            type="submit"
            size="lg"
            disabled={
              !name.trim() ||
              selectedPaths.length === 0 ||
              createScan.isPending
            }
          >
            {createScan.isPending ? (
              "Starting scan..."
            ) : (
              <>
                <Play className="h-5 w-5" />
                Start Scan
              </>
            )}
          </Button>
        </div>

        {createScan.isError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to start scan. Please check your configuration and try again.
          </div>
        )}
      </form>
    </div>
  );
}
