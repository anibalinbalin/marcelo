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

function StatusBadge({ status }: { status: string | null }) {
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
    case "fail":
      return (
        <Badge className="bg-destructive/15 text-destructive border-destructive/25">
          fail
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
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
    ? values.filter(
        (v) => v.validationStatus === "warning" || v.validationStatus === "fail"
      )
    : values;

  if (filtered.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {showFlaggedOnly
          ? "No flagged values in this sheet."
          : "No extracted values in this sheet."}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow className="border-zinc-800">
          <TableHead className="text-xs">Field Name</TableHead>
          <TableHead className="text-xs">Source Section</TableHead>
          <TableHead className="text-xs">Extracted Value</TableHead>
          <TableHead className="text-xs">Confidence</TableHead>
          <TableHead className="text-xs">Status</TableHead>
          <TableHead className="text-xs">Override</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filtered.map((v) => (
          <TableRow key={v.id} className="border-zinc-800/50">
            <TableCell className="text-sm font-medium">
              {v.sourceLabel}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {v.sourceSection ?? "--"}
            </TableCell>
            <TableCell className="font-[family-name:var(--font-geist-mono)] text-sm">
              {v.extractedValue}
            </TableCell>
            <TableCell>
              <ConfidenceDot confidence={v.confidence} />
            </TableCell>
            <TableCell>
              <StatusBadge status={v.validationStatus} />
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
      </TableBody>
    </Table>
  );
}
