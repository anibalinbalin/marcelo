"use client";

import { useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { FileDropzone } from "@/components/file-dropzone";
import { QuarterSelector } from "@/components/quarter-selector";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";

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
            onFileSelect={setFile}
            accept=".xlsx,.pdf"
            label="Drop quarterly report here or click to browse"
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
          <div className="space-y-2">
            <Progress value={uploadProgress} className="h-2" />
            <p className="text-xs text-muted-foreground">
              Uploading and creating extraction run...
            </p>
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
    </div>
  );
}
