"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, BrainIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MappingCandidate } from "@/lib/onboarding/suggest-mappings";

type Props = {
  company: { id: number; name: string; ticker: string };
};

type SuggestResponse = {
  success: boolean;
  candidateCount: number;
  durationMs: number;
  candidates: MappingCandidate[];
  error?: string;
};

export function OnboardingClient({ company }: Props) {
  const [quarter, setQuarter] = useState("1Q26");
  const [baseModelFile, setBaseModelFile] = useState<File | null>(null);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [candidates, setCandidates] = useState<MappingCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ created: number; superseded: number } | null>(null);

  const sortedCandidates = useMemo(
    () =>
      [...candidates].sort((a, b) => {
        if (a.target.row !== b.target.row) return a.target.row - b.target.row;
        return b.confidence - a.confidence;
      }),
    [candidates],
  );

  async function suggest() {
    if (!baseModelFile || !sourceFile) return;
    setIsSuggesting(true);
    setError(null);
    setConfirmed(null);
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
      if (!response.ok || body.error) throw new Error(body.error ?? "Suggestion failed");
      setCandidates(body.candidates ?? []);
      setSelected(new Set((body.candidates ?? []).map((candidate) => candidateKey(candidate))));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suggestion failed");
    } finally {
      setIsSuggesting(false);
    }
  }

  async function confirm() {
    if (!baseModelFile) return;
    const chosen = sortedCandidates.filter((candidate) => selected.has(candidateKey(candidate)));
    if (chosen.length === 0) return;
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
          candidates: chosen,
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
      if (!response.ok || body.error) throw new Error(body.error ?? "Confirm failed");
      setConfirmed({
        created: body.mappingsCreated ?? 0,
        superseded: body.mappingsSuperseded ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirm failed");
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <Link
          href={`/companies/${company.id}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" />
          Back to company
        </Link>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">{company.ticker}</span>
              <Badge variant="outline">XLSX learning setup</Badge>
            </div>
          </div>
          <Button onClick={suggest} disabled={!baseModelFile || !sourceFile || isSuggesting}>
            {isSuggesting ? <Loader2Icon className="size-4 animate-spin" /> : <BrainIcon className="size-4" />}
            Analyze
          </Button>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Base Learning Files</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="quarter">Base quarter</Label>
              <Input id="quarter" value={quarter} onChange={(event) => setQuarter(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="base-model">Camila completed model</Label>
              <Input
                id="base-model"
                type="file"
                accept=".xlsx"
                onChange={(event) => setBaseModelFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="source-file">Matching source XLSX</Label>
              <Input
                id="source-file"
                type="file"
                accept=".xlsx"
                onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
              />
            </div>
          </CardContent>
        </Card>

        {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
        {confirmed && (
          <div className="mb-4 flex items-center gap-2 text-sm text-success">
            <CheckIcon className="size-4" />
            {confirmed.created} mappings saved, {confirmed.superseded} old mappings superseded.
          </div>
        )}

        {sortedCandidates.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">
                Suggested Mappings
              </CardTitle>
              <Button onClick={confirm} disabled={isConfirming || selected.size === 0}>
                {isConfirming ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                Confirm Selected
              </Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Target</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Transform</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead>Evidence</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedCandidates.map((candidate) => {
                    const key = candidateKey(candidate);
                    return (
                      <TableRow key={key}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selected.has(key)}
                            onChange={(event) => {
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (event.target.checked) next.add(key);
                                else next.delete(key);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{candidate.target.label}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {candidate.evidence?.targetAddress ?? `${candidate.target.sheet}:${candidate.target.row}`}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>{candidate.sourceLabel}</div>
                          <div className="font-mono text-xs text-muted-foreground">
                            {candidate.sourceSection} row {candidate.sourceRow ?? "--"}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {candidate.valueTransform ?? "none"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {(candidate.confidence * 100).toFixed(0)}%
                        </TableCell>
                        <TableCell className="max-w-md text-xs text-muted-foreground">
                          {candidate.reasoning}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function candidateKey(candidate: MappingCandidate): string {
  return [
    candidate.target.sheet,
    candidate.target.row,
    candidate.sourceSection,
    candidate.sourceRow ?? candidate.sourceLabel,
    candidate.valueTransform ?? "none",
  ].join(":");
}
