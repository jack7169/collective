import { useState } from "react";
import { Save, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";

export function Settings() {
  const [scanner, setScanner] = useState("rmlint");
  const [threshold, setThreshold] = useState(50);
  const [depth, setDepth] = useState(5);
  const [readOnly, setReadOnly] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In a real app this would call an API
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure default scan parameters and application behavior
        </p>
      </div>

      {/* Default Scanner */}
      <Card>
        <CardHeader>
          <CardTitle>Default Scanner</CardTitle>
          <CardDescription>
            Scanner engine used for new scans by default
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={scanner} onValueChange={setScanner}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rmlint">rmlint (Recommended)</SelectItem>
              <SelectItem value="fclones">fclones</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Similarity Threshold */}
      <Card>
        <CardHeader>
          <CardTitle>Default Similarity Threshold</CardTitle>
          <CardDescription>
            Minimum Jaccard similarity for directory pairs to be reported
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Threshold</span>
            <span className="text-sm font-medium">{threshold}%</span>
          </div>
          <Slider
            value={[threshold]}
            onValueChange={([v]) => setThreshold(v ?? 50)}
            min={0}
            max={100}
            step={5}
          />
          <p className="text-xs text-muted-foreground">
            Lower values show more results but may include less relevant pairs.
            Higher values focus on very similar directories.
          </p>
        </CardContent>
      </Card>

      {/* Scan Depth */}
      <Card>
        <CardHeader>
          <CardTitle>Default Scan Depth</CardTitle>
          <CardDescription>
            Maximum directory depth for file scanning
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm">Depth</span>
            <span className="text-sm font-medium">{depth}</span>
          </div>
          <Slider
            value={[depth]}
            onValueChange={([v]) => setDepth(v ?? 5)}
            min={1}
            max={10}
            step={1}
          />
          <p className="text-xs text-muted-foreground">
            Controls how deep into subdirectories the scanner will look. Higher
            values scan more thoroughly but take longer.
          </p>
        </CardContent>
      </Card>

      {/* Read-only Mode */}
      <Card>
        <CardHeader>
          <CardTitle>Read-Only Mode</CardTitle>
          <CardDescription>
            Prevent any file modifications when enabled
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                When enabled, actions will only show dry-run results
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={readOnly}
              onClick={() => setReadOnly(!readOnly)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                readOnly ? "bg-primary" : "bg-input"
              }`}
            >
              <span
                className={`pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                  readOnly ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Data Directory */}
      <Card>
        <CardHeader>
          <CardTitle>Data Directory</CardTitle>
          <CardDescription>
            Location where scan results and metadata are stored
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value="/data/collective"
            readOnly
            className="font-mono text-sm bg-muted cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-2">
            This is configured via the COLLECTIVE_DATA_DIR environment variable
            and cannot be changed at runtime.
          </p>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center justify-between">
        {saved && (
          <span className="text-sm text-success">Settings saved successfully</span>
        )}
        {!saved && <span />}
        <Button onClick={handleSave}>
          <Save className="h-4 w-4" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
