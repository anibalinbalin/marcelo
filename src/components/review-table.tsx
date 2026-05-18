"use client";

import { useState, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ExtractedValueWithMapping {
  id: number;
  extractedValue: string;
  confidence: number;
  validationStatus: string | null;
  validationMessage: string | null;
  analystOverride: string | null;
  sourceLabel: string;
  sourceSection: string | null;
  sourceRow: number | null;
  sourceCol: string | null;
  valueTransform: string | null;
  mappingConfidence: number;
  targetCellAddress: string;
  targetSheet: string;
  targetRow: number;
}

interface ReviewTableProps {
  values: ExtractedValueWithMapping[];
  showFlaggedOnly: boolean;
  onOverride: (id: number, value: string) => void;
}

function ConfidenceDot({ confidence }: { confidence: number }) {
  const color =
    confidence >= 0.8
      ? "bg-success"
      : confidence >= 0.5
        ? "bg-warning"
        : "bg-destructive";

  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-block size-2 rounded-full", color)} />
      <span className="font-[family-name:var(--font-geist-mono)] text-xs text-muted-foreground tabular-nums">
        {(confidence * 100).toFixed(0)}%
      </span>
    </span>
  );
}

const FLAGGED_STATUSES = new Set([
  "warning",
  "fail",
  "needs_review",
  "error",
  "source_guard_failed",
  "deepseek_judge_failed",
  "deepseek_judge_needs_review",
]);

function isExceptionValue(value: ExtractedValueWithMapping): boolean {
  return Boolean(
    value.analystOverride ||
      value.mappingConfidence < 0.95 ||
      (value.validationStatus && FLAGGED_STATUSES.has(value.validationStatus)),
  );
}

function StatusCell({
  status,
  message,
}: {
  status: string | null;
  message: string | null;
}) {
  const badge = (() => {
    if (!status) return <Badge variant="secondary">--</Badge>;
    switch (status) {
      case "pass":
        return (
          <Badge className="bg-success/15 text-success border-success/25">
            pass
          </Badge>
        );
      case "warning":
        return (
          <Badge className="bg-warning/15 text-warning border-warning/25">
            warning
          </Badge>
        );
      case "needs_review":
        return (
          <Badge className="bg-warning/15 text-warning border-warning/25">
            needs review
          </Badge>
        );
      case "fail":
        return (
          <Badge className="bg-destructive/15 text-destructive border-destructive/25">
            fail
          </Badge>
        );
      case "error":
        return (
          <Badge className="bg-destructive/15 text-destructive border-destructive/25">
            error
          </Badge>
        );
      case "source_guard_failed":
        return (
          <Badge className="bg-destructive/15 text-destructive border-destructive/25">
            source guard failed
          </Badge>
        );
      case "deepseek_judge_failed":
        return (
          <Badge className="bg-destructive/15 text-destructive border-destructive/25">
            DeepSeek blocked
          </Badge>
        );
      case "deepseek_judge_needs_review":
        return (
          <Badge className="bg-destructive/15 text-destructive border-destructive/25">
            DeepSeek review
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  })();

  const showMessage = message && status && FLAGGED_STATUSES.has(status);

  return (
    <div className="flex flex-col gap-1">
      {badge}
      {showMessage && (
        <span className="max-w-[220px] text-[11px] leading-tight text-muted-foreground">
          {message}
        </span>
      )}
    </div>
  );
}

function OverrideCell({
  id,
  currentOverride,
  onOverride,
}: {
  id: number;
  currentOverride: string | null;
  onOverride: (id: number, value: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(currentOverride ?? "");

  const handleCommit = useCallback(() => {
    setIsEditing(false);
    if (draft !== (currentOverride ?? "")) {
      onOverride(id, draft);
    }
  }, [draft, currentOverride, id, onOverride]);

  if (isEditing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCommit();
          if (e.key === "Escape") {
            setDraft(currentOverride ?? "");
            setIsEditing(false);
          }
        }}
        className="h-7 w-32 font-[family-name:var(--font-geist-mono)] text-xs"
      />
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className="min-h-[40px] min-w-[80px] rounded px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-zinc-800 hover:text-foreground"
    >
      {currentOverride || "click to override"}
    </button>
  );
}

export function ReviewTable({
  values,
  showFlaggedOnly,
  onOverride,
}: ReviewTableProps) {
  const filtered = showFlaggedOnly
    ? values.filter(isExceptionValue)
    : values;
  const hiddenCount = values.length - filtered.length;

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {showFlaggedOnly
          ? "No exceptions in this sheet."
          : "No extracted values in this sheet."}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-zinc-800">
          <TableHead className="text-xs">Field Name</TableHead>
          <TableHead className="text-xs">Target Cell</TableHead>
          <TableHead className="text-xs">Source Section</TableHead>
          <TableHead className="text-xs">Extracted Value</TableHead>
          <TableHead className="text-xs">Confidence</TableHead>
          <TableHead className="text-xs">Status</TableHead>
          <TableHead className="text-xs">Reasoning</TableHead>
          <TableHead className="text-xs">Override</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((v) => (
          <TableRow key={v.id} className="border-zinc-800/50">
            <TableCell className="text-sm font-medium">
              {v.sourceLabel}
            </TableCell>
            <TableCell className="font-[family-name:var(--font-geist-mono)] text-xs text-muted-foreground">
              {v.targetCellAddress}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              <div>{v.sourceSection ?? "--"}</div>
              {v.sourceRow && (
                <div className="font-[family-name:var(--font-geist-mono)] text-[11px] text-muted-foreground">
                  row {v.sourceRow}
                  {v.sourceCol ? ` / ${v.sourceCol}` : ""}
                </div>
              )}
            </TableCell>
            <TableCell className="font-[family-name:var(--font-geist-mono)] text-sm">
              {v.extractedValue}
            </TableCell>
            <TableCell>
              <div className="space-y-1">
                <ConfidenceDot confidence={v.confidence} />
                <div className="font-[family-name:var(--font-geist-mono)] text-[11px] text-muted-foreground">
                  map {(v.mappingConfidence * 100).toFixed(0)}%
                </div>
              </div>
            </TableCell>
            <TableCell>
              <StatusCell
                status={v.validationStatus}
                message={v.validationMessage}
              />
            </TableCell>
            <TableCell className="max-w-72 text-xs text-muted-foreground">
              <div>
                {v.valueTransform ?? "no transform"} into {v.targetCellAddress}
              </div>
              {v.validationMessage && (
                <div className="mt-1 line-clamp-2">{v.validationMessage}</div>
              )}
            </TableCell>
            <TableCell>
              <OverrideCell
                id={v.id}
                currentOverride={v.analystOverride}
                onOverride={onOverride}
              />
            </TableCell>
          </TableRow>
        ))}
        {showFlaggedOnly && hiddenCount > 0 && (
          <TableRow className="border-zinc-800/50">
            <TableCell colSpan={8} className="py-3 text-center text-xs text-muted-foreground">
              {hiddenCount} high-confidence values hidden in exceptions view.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
