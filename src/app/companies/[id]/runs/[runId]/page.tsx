import { getRun, getExtractedValues } from "@/app/actions/runs";
import { getCompany } from "@/app/actions/companies";
import { getMappings } from "@/app/actions/mappings";
import { notFound } from "next/navigation";
import { ReviewClient } from "./review-client";

interface Props {
  params: Promise<{ id: string; runId: string }>;
}

export default async function RunReviewPage({ params }: Props) {
  const { id, runId } = await params;

  const companyId = parseInt(id, 10);
  const parsedRunId = parseInt(runId, 10);

  if (isNaN(companyId) || isNaN(parsedRunId)) notFound();

  const [company, run] = await Promise.all([
    getCompany(companyId),
    getRun(parsedRunId),
  ]);

  if (!company || !run) notFound();
  if (run.companyId !== companyId) notFound();

  // Fetch extracted values and mappings in parallel
  const [rawValues, mappings] = await Promise.all([
    getExtractedValues(parsedRunId),
    getMappings(companyId),
  ]);

  // Build a mapping lookup
  const mappingById = new Map(mappings.map((m) => [m.id, m]));

  // Join values with their mapping info
  const valuesWithMappings = rawValues
    .map((v) => {
      const mapping = v.mappingId ? mappingById.get(v.mappingId) : null;
      if (!mapping) return null;
      return {
        id: v.id,
        extractedValue: v.extractedValue ?? "",
        confidence: v.confidence ?? 0,
        validationStatus: v.validationStatus,
        validationMessage: v.validationMessage,
        analystOverride: v.analystOverride,
        sourceLabel: mapping.sourceLabel,
        sourceSection: mapping.sourceSection,
        targetSheet: mapping.targetSheet,
        targetRow: mapping.targetRow,
      };
    })
    .filter((v) => v !== null);

  return (
    <ReviewClient
      company={{ id: company.id, name: company.name, ticker: company.ticker }}
      run={{
        id: run.id,
        quarter: run.quarter,
        status: run.status ?? "pending",
        approvedBy: run.approvedBy,
        approvedAt: run.approvedAt?.toISOString() ?? null,
        outputFileUrl: run.outputFileUrl,
        errorMessage: run.errorMessage,
      }}
      values={valuesWithMappings}
    />
  );
}
