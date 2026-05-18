"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { FileDropzone } from "@/components/file-dropzone";
import { QuarterSelector } from "@/components/quarter-selector";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { ArrowLeftIcon, Loader2Icon, AlertTriangleIcon } from "lucide-react";
import Link from "next/link";

function fileMatchesSourceType(file: File, sourceType: string): boolean {
  const name = file.name.toLowerCase();
  if (sourceType === "excel") return name.endsWith(".xlsx") || name.endsWith(".xls");
  if (sourceType === "pdf") return name.endsWith(".pdf");
  return true;
}

function expectedFormatLabel(sourceType: string): string {
  if (sourceType === "excel") return "XLSX";
  if (sourceType === "pdf") return "PDF";
  return sourceType.toUpperCase();
}

export default function UploadPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const companyId = params.id;

  const [file, setFile] = useState<File | null>(null);
  const [quarter, setQuarter] = useState("");
  const [analystName, setAnalystName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [sourceType, setSourceType] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [showFormatWarning, setShowFormatWarning] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    fetch(`/api/companies/${companyId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setSourceType(data.sourceType);
          setCompanyName(data.name);
        }
      })
      .catch(() => {});
  }, [companyId]);

  const acceptFile = useCallback(
    (f: File) => {
      setFile(f);
      setError(null);
    },
    []
  );

  const handleFileSelect = useCallback(
    (f: File) => {
      if (sourceType && !fileMatchesSourceType(f, sourceType)) {
        setPendingFile(f);
        setShowFormatWarning(true);
        return;
      }
      acceptFile(f);
    },
    [sourceType, acceptFile]
  );

  const acceptedExtensions = sourceType === "excel" ? ".xlsx" : sourceType === "pdf" ? ".pdf" : ".xlsx,.pdf";

  const canSubmit = file !== null && quarter !== "" && !isUploading;

  const handleSubmit = useCallback(async () => {
    if (!file || !quarter) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("companyId", companyId);
      formData.append("quarter", quarter);
      if (analystName.trim()) {
        formData.append("analystName", analystName.trim());
      }

      setUploadProgress(30);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      setUploadProgress(70);

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }

      const { runId } = await res.json();
      setUploadProgress(100);

      router.push(`/companies/${companyId}/runs/${runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [file, quarter, analystName, companyId, router]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Back link */}
      <Link
        href={`/companies/${companyId}`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeftIcon className="size-4" />
        Back to company
      </Link>

      <h1 className="mb-8 text-2xl font-semibold tracking-tight text-foreground">
        Upload Quarterly Report
      </h1>

      <div className="space-y-6">
        {/* File upload */}
        <div className="space-y-2">
          <Label>Source File</Label>
          <FileDropzone
            onFileSelect={handleFileSelect}
            accept={acceptedExtensions}
            label={
              sourceType
                ? `Drop ${expectedFormatLabel(sourceType)} quarterly report here or click to browse`
                : "Drop quarterly report here or click to browse"
            }
          />
        </div>

        {/* Quarter selector */}
        <div className="space-y-2">
          <Label>Target Quarter</Label>
          <QuarterSelector value={quarter} onChange={setQuarter} />
        </div>

        {/* Analyst name */}
        <div className="space-y-2">
          <Label htmlFor="analyst-name">Analyst Name</Label>
          <Input
            id="analyst-name"
            value={analystName}
            onChange={(e) => setAnalystName(e.target.value)}
            placeholder="For approval tracking"
            className="max-w-xs"
          />
        </div>

        {/* Upload progress */}
        {isUploading && (
          <div className="space-y-3">
            <Progress value={uploadProgress} className="h-1.5" />
            <div className="flex items-center gap-3">
              {uploadProgress >= 30 && <ThinkingDots count={5} />}
              <p className="text-xs text-muted-foreground">
                {uploadProgress < 30
                  ? "Uploading file..."
                  : "Extracting financial data..."}
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit}
          size="lg"
          className="w-full"
        >
          {isUploading ? (
            <>
              <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              Uploading...
            </>
          ) : (
            "Extract & Review"
          )}
        </Button>
      </div>

      {/* Format mismatch warning dialog */}
      <Dialog open={showFormatWarning} onOpenChange={setShowFormatWarning}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="size-5 text-warning" />
              Unsupported file format
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <strong>{companyName || "This company"}</strong> is configured
                  to extract from <strong>{expectedFormatLabel(sourceType ?? "")}</strong> files,
                  but you selected a <strong>{pendingFile?.name.split(".").pop()?.toUpperCase()}</strong> file.
                </p>
                <p>
                  Extraction mappings have not been analyzed for this format and
                  the run will likely fail or produce incorrect results.
                </p>
                <p>
                  Please request analysis for this format before uploading, or
                  upload a {expectedFormatLabel(sourceType ?? "")} file instead.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowFormatWarning(false);
                setPendingFile(null);
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
