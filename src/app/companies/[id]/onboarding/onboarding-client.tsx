"use client";

import { useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  FileSpreadsheetIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { ThinkingDots } from "@/components/ui/thinking-dots";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileDropzone } from "@/components/file-dropzone";
import { cn } from "@/lib/utils";
import type { MappingCandidate } from "@/lib/onboarding/suggest-mappings";

type Props = {
  company: { id: number; name: string; ticker: string };
  mappingCount: number;
};

type Stage = "upload" | "analyzing" | "review" | "confirmed";

type SuggestResponse = {
  success: boolean;
  candidateCount: number;
  durationMs: number;
  candidates: MappingCandidate[];
  error?: string;
};

const CONFIDENCE_THRESHOLD = 0.85;

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            value >= 0.9
              ? "bg-success"
              : value >= 0.7
                ? "bg-warning"
                : "bg-destructive",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-[family-name:var(--font-geist-mono)] text-xs tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

export function OnboardingClient({ company, mappingCount }: Props) {
  const [stage, setStage] = useState<Stage>("upload");
  const [quarter, setQuarter] = useState("1Q26");
  const [baseModelFile, setBaseModelFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<MappingCandidate[]>([]);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{
    created: number;
    superseded: number;
  } | null>(null);
  const [showAutoAccepted, setShowAutoAccepted] = useState(false);

  const { autoAccepted, needsReview } = useMemo(() => {
    const sorted = [...candidates].sort((a, b) => {
      if (a.target.row !== b.target.row) return a.target.row - b.target.row;
      return b.confidence - a.confidence;
    });
    const auto: MappingCandidate[] = [];
    const review: MappingCandidate[] = [];
    for (const c of sorted) {
      if (c.confidence >= CONFIDENCE_THRESHOLD) auto.push(c);
      else review.push(c);
    }
    return { autoAccepted: auto, needsReview: review };
  }, [candidates]);

  const accepted = useMemo(() => {
    return [...candidates].filter(
      (c) => !rejected.has(candidateKey(c)),
    );
  }, [candidates, rejected]);

  const toggleReject = useCallback((c: MappingCandidate) => {
    const key = candidateKey(c);
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const analyze = useCallback(async () => {
    if (!baseModelFile || !sourceFile) return;
    setStage("analyzing");
    setError(null);
    setConfirmed(null);
    setRejected(new Set());
    try {
      const formData = new FormData();
      formData.append("companyId", String(company.id));
      formData.append("quarter", quarter);
      formData.append("sourceType", "xlsx");
      formData.append("baseModelFile", baseModelFile);
      formData.append("sourceFile", sourceFile);
      const response = await fetch("/api/onboarding/suggest", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as SuggestResponse;
      if (!response.ok || body.error)
        throw new Error(body.error ?? "Analysis failed");
      setCandidates(body.candidates ?? []);
      setStage("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setStage("upload");
    }
  }, [baseModelFile, sourceFile, company.id, quarter]);

  const confirm = useCallback(async () => {
    if (!baseModelFile || accepted.length === 0) return;
    setIsConfirming(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("templateFile", baseModelFile);
      formData.append(
        "payload",
        JSON.stringify({
          companyId: company.id,
          baseQuarter: quarter,
          applyMode: "same_company",
          candidates: accepted,
        }),
      );
      const response = await fetch("/api/onboarding/confirm", {
        method: "POST",
        body: formData,
      });
      const body = (await response.json()) as {
        error?: string;
        mappingsCreated?: number;
        mappingsSuperseded?: number;
      };
      if (!response.ok || body.error)
        throw new Error(body.error ?? "Confirm failed");
      setConfirmed({
        created: body.mappingsCreated ?? 0,
        superseded: body.mappingsSuperseded ?? 0,
      });
      setStage("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setIsConfirming(false);
    }
  }, [baseModelFile, accepted, company.id, quarter]);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Nav */}
        <Link
          href={`/companies/${company.id}`}
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          {company.name}
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Teach mappings
            </h1>
            {mappingCount > 0 && (
              <Badge variant="outline" className="text-xs tabular-nums">
                {mappingCount} existing
              </Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Upload a model you already completed and the matching source file.
            The system will learn which rows map where, so future uploads
            extract automatically.
          </p>
        </div>

        {/* ── Stage: Upload ─────────────────────────────────────────── */}
        {stage === "upload" && (
          <div className="space-y-6">
            {/* Two file zones side by side */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileSpreadsheetIcon className="size-3.5 text-success" />
                  Your completed model
                </Label>
                <p className="text-xs text-muted-foreground">
                  The XLSX you already reviewed and approved
                </p>
                <FileDropzone
                  onFileSelect={setBaseModelFile}
                  accept=".xlsx"
                  label="Drop your completed XLSX"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <FileSpreadsheetIcon className="size-3.5 text-info" />
                  Company source file
                </Label>
                <p className="text-xs text-muted-foreground">
                  The quarterly report the company published
                </p>
                <FileDropzone
                  onFileSelect={setSourceFile}
                  accept=".xlsx"
                  label="Drop the source XLSX"
                />
              </div>
            </div>

            {/* Quarter */}
            <div className="max-w-[200px] space-y-2">
              <Label htmlFor="quarter">Quarter</Label>
              <Input
                id="quarter"
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="e.g. 1Q26"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {/* Analyze CTA */}
            <div className="flex items-center justify-between">
              {mappingCount > 0 ? (
                <p className="text-xs text-muted-foreground">
                  This will update existing mappings where the system finds
                  better matches.
                </p>
              ) : (
                <div />
              )}
              <Button
                onClick={analyze}
                disabled={!baseModelFile || !sourceFile}
              >
                <BrainIcon className="size-4" />
                Analyze & find mappings
              </Button>
            </div>
          </div>
        )}

        {/* ── Stage: Analyzing ──────────────────────────────────────── */}
        {stage === "analyzing" && (
          <div className="flex flex-col items-center gap-4 py-16">
            <ThinkingDots count={6} />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Comparing your model against the source file...
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Matching rows, checking transforms, scoring confidence
              </p>
            </div>
          </div>
        )}

        {/* ── Stage: Review ─────────────────────────────────────────── */}
        {stage === "review" && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Found {candidates.length} mapping
                    {candidates.length === 1 ? "" : "s"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {autoAccepted.length} high confidence
                    {needsReview.length > 0 && (
                      <>
                        {" "}&middot;{" "}
                        <span className="text-warning">
                          {needsReview.length} need your review
                        </span>
                      </>
                    )}
                    {rejected.size > 0 && (
                      <>
                        {" "}&middot;{" "}
                        <span className="text-destructive">
                          {rejected.size} rejected
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStage("upload")}
                  >
                    Re-analyze
                  </Button>
                  <Button
                    size="sm"
                    onClick={confirm}
                    disabled={isConfirming || accepted.length === 0}
                  >
                    {isConfirming ? (
                      <ThinkingDots count={3} />
                    ) : (
                      <CheckIcon className="size-4" />
                    )}
                    {isConfirming
                      ? "Saving..."
                      : `Confirm ${accepted.length} mapping${accepted.length === 1 ? "" : "s"}`}
                  </Button>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            {/* Needs review section */}
            {needsReview.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-medium text-warning">
                  Needs your review ({needsReview.length})
                </h2>
                <div className="space-y-2">
                  {needsReview.map((c) => {
                    const key = candidateKey(c);
                    const isRejected = rejected.has(key);
                    return (
                      <CandidateCard
                        key={key}
                        candidate={c}
                        isRejected={isRejected}
                        onToggle={() => toggleReject(c)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Auto-accepted section */}
            {autoAccepted.length > 0 && (
              <div className="space-y-3">
                <button
                  onClick={() => setShowAutoAccepted((v) => !v)}
                  className="flex w-full items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-4 transition-transform",
                      !showAutoAccepted && "-rotate-90",
                    )}
                  />
                  High confidence — auto-accepted ({autoAccepted.length})
                </button>
                {showAutoAccepted && (
                  <div className="space-y-2">
                    {autoAccepted.map((c) => {
                      const key = candidateKey(c);
                      const isRejected = rejected.has(key);
                      return (
                        <CandidateCard
                          key={key}
                          candidate={c}
                          isRejected={isRejected}
                          onToggle={() => toggleReject(c)}
                          compact
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Stage: Confirmed ──────────────────────────────────────── */}
        {stage === "confirmed" && confirmed && (
          <div className="flex flex-col items-center gap-6 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-success/10">
              <SparklesIcon className="size-7 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {confirmed.created} mapping
                {confirmed.created === 1 ? "" : "s"} saved
              </h2>
              {confirmed.superseded > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {confirmed.superseded} outdated mapping
                  {confirmed.superseded === 1 ? "" : "s"} replaced
                </p>
              )}
              <p className="mx-auto mt-4 max-w-sm text-sm text-muted-foreground">
                Next time you upload a quarterly report for{" "}
                <strong className="text-foreground">{company.name}</strong>,
                the system will extract these fields automatically.
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStage("upload")}>
                Teach more
              </Button>
              <Button asChild>
                <Link href={`/companies/${company.id}/upload`}>
                  Upload a quarter
                  <ArrowRightIcon className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CandidateCard({
  candidate: c,
  isRejected,
  onToggle,
  compact = false,
}: {
  candidate: MappingCandidate;
  isRejected: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 transition-colors",
        isRejected
          ? "border-destructive/25 bg-destructive/5 opacity-60"
          : "border-zinc-800 bg-zinc-900/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Source → Target */}
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium text-foreground">
              {c.sourceLabel}
            </span>
            <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">
              {c.target.label}
            </span>
          </div>

          {/* Metadata row */}
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="font-[family-name:var(--font-geist-mono)]">
              {c.evidence?.sourceAddress ?? `${c.sourceSection} row ${c.sourceRow ?? "?"}`}
            </span>
            <span className="font-[family-name:var(--font-geist-mono)]">
              → {c.evidence?.targetAddress ?? `${c.target.sheet}:${c.target.row}`}
            </span>
            {c.valueTransform && (
              <Badge variant="outline" className="text-[11px]">
                {c.valueTransform.replace(/_/g, " ")}
              </Badge>
            )}
            <ConfidenceBar value={c.confidence} />
          </div>

          {/* Evidence values */}
          {!compact && c.evidence?.sourceValue != null && (
            <div className="mt-2 flex items-center gap-2 font-[family-name:var(--font-geist-mono)] text-xs">
              <span className="text-muted-foreground">
                {formatNumber(c.evidence.sourceValue)}
              </span>
              {c.evidence.transformedValue != null && (
                <>
                  <ArrowRightIcon className="size-3 text-muted-foreground/50" />
                  <span className="text-foreground">
                    {formatNumber(c.evidence.transformedValue)}
                  </span>
                </>
              )}
              {c.evidence.targetValue != null && (
                <span className="text-success/70">
                  (expected {formatNumber(c.evidence.targetValue)})
                </span>
              )}
            </div>
          )}

          {/* Reasoning */}
          {!compact && c.reasoning && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80">
              {c.reasoning}
            </p>
          )}
          {!compact && c.reviewReasons && c.reviewReasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {c.reviewReasons.map((reason) => (
                <Badge key={reason} variant="outline" className="text-[11px] text-warning">
                  {reason}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Accept/Reject toggle */}
        <button
          onClick={onToggle}
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border transition-colors",
            isRejected
              ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "border-zinc-700 bg-zinc-800/50 text-success hover:bg-zinc-800",
          )}
          aria-label={isRejected ? "Re-accept mapping" : "Reject mapping"}
        >
          {isRejected ? (
            <XIcon className="size-3.5" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function candidateKey(c: MappingCandidate): string {
  return [
    c.target.sheet,
    c.target.row,
    c.sourceSection,
    c.sourceRow ?? c.sourceLabel,
    c.valueTransform ?? "none",
  ].join(":");
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(n);
}
