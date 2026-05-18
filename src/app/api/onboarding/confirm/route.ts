/**
 * API endpoint to confirm and save mapping candidates.
 *
 * After analyst reviews the suggestions, they confirm which mappings to save.
 * This endpoint creates the field_mappings records in the database.
 */
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { fieldMappings, companies, learningEvents, mappingHistory } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { candidatesToMappings, type MappingCandidate } from "@/lib/onboarding/suggest-mappings";

interface ConfirmRequest {
  companyId?: number;
  companyName?: string;
  companyTicker?: string;
  baseQuarter: string;
  applyMode?: "same_company" | "append_only";
  candidates: MappingCandidate[];
}

async function readConfirmRequest(request: NextRequest): Promise<{
  body: ConfirmRequest;
  templateFile: File | null;
}> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const payload = formData.get("payload");
    if (typeof payload !== "string") {
      throw new Error("Missing multipart payload");
    }
    return {
      body: JSON.parse(payload) as ConfirmRequest,
      templateFile: formData.get("templateFile") as File | null,
    };
  }
  return { body: (await request.json()) as ConfirmRequest, templateFile: null };
}

export async function POST(request: NextRequest) {
  try {
    const { body, templateFile } = await readConfirmRequest(request);

    if (!body.candidates || body.candidates.length === 0) {
      return NextResponse.json(
        { error: "No candidates to confirm" },
        { status: 400 }
      );
    }

    if (!body.baseQuarter) {
      return NextResponse.json(
        { error: "baseQuarter is required" },
        { status: 400 }
      );
    }

    const db = getDb();
    let companyId = body.companyId;

    // Create new company if needed
    if (!companyId && body.companyName) {
      const [newCompany] = await db
        .insert(companies)
        .values({
          name: body.companyName,
          ticker: body.companyTicker ?? body.companyName.toUpperCase().slice(0, 6),
          sourceType: "excel",
        })
        .returning();
      companyId = newCompany.id;
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId or companyName is required" },
        { status: 400 }
      );
    }

    // Convert candidates to mapping records
    const mappingValues = candidatesToMappings(
      body.candidates,
      companyId,
      body.baseQuarter
    ).map((mapping, index) => ({
      ...mapping,
      confidenceScore: body.candidates[index]?.confidence ?? 0.75,
      lastVerifiedAt: new Date(),
    }));

    const activeMappings = await db
      .select()
      .from(fieldMappings)
      .where(
        and(
          eq(fieldMappings.companyId, companyId),
          eq(fieldMappings.isActive, true),
        ),
      );

    // Insert mappings
    const inserted = await db
      .insert(fieldMappings)
      .values(mappingValues)
      .returning();

    const insertedByTarget = new Map(
      inserted.map((mapping) => [`${mapping.targetSheet}:${mapping.targetRow}`, mapping]),
    );

    if (body.applyMode !== "append_only") {
      for (const existing of activeMappings) {
        const replacement = insertedByTarget.get(`${existing.targetSheet}:${existing.targetRow}`);
        if (!replacement) continue;

        await db
          .update(fieldMappings)
          .set({
            isActive: false,
            supersededBy: replacement.id,
            updatedAt: new Date(),
          })
          .where(eq(fieldMappings.id, existing.id));

        await db.insert(mappingHistory).values({
          mappingId: existing.id,
          oldValue: `${existing.sourceSection ?? ""}:${existing.sourceLabel}`,
          newValue: `${replacement.sourceSection ?? ""}:${replacement.sourceLabel}`,
          confidenceDelta:
            (replacement.confidenceScore ?? 0.75) - (existing.confidenceScore ?? 0.5),
          previousValues: {
            sourceSection: existing.sourceSection,
            sourceLabel: existing.sourceLabel,
            sourceRow: existing.sourceRow,
            sourceCol: existing.sourceCol,
            targetSheet: existing.targetSheet,
            targetRow: existing.targetRow,
            valueTransform: existing.valueTransform,
          },
          changeReason: "onboarding_confirmed",
          changedBy: "onboarding",
        });

        await db.insert(learningEvents).values({
          eventType: "mapping_superseded",
          entityType: "field_mapping",
          entityId: existing.id,
          mappingId: existing.id,
          companyId,
          sourceLabel: replacement.sourceLabel,
          previousState: {
            id: existing.id,
            sourceSection: existing.sourceSection,
            sourceLabel: existing.sourceLabel,
            confidenceScore: existing.confidenceScore,
          },
          newState: {
            id: replacement.id,
            sourceSection: replacement.sourceSection,
            sourceLabel: replacement.sourceLabel,
            confidenceScore: replacement.confidenceScore,
          },
          reason: "onboarding_confirmed",
          trigger: "analyst_override",
          actorType: "analyst",
          actorId: "onboarding",
        });
      }
    }

    let templateUrl: string | null = null;
    if (templateFile) {
      const safeName = templateFile.name.replace(/[^a-z0-9._-]+/gi, "_");
      const blob = await put(
        `templates/${companyId}/${safeName}`,
        templateFile,
        { access: "public", allowOverwrite: true },
      );
      templateUrl = blob.url;
      await db
        .update(companies)
        .set({ modelTemplateBlobUrl: blob.url, sourceType: "excel" })
        .where(eq(companies.id, companyId));
    }

    return NextResponse.json({
      success: true,
      companyId,
      mappingsCreated: inserted.length,
      mappingsSuperseded:
        body.applyMode === "append_only"
          ? 0
          : activeMappings.filter((mapping) =>
              insertedByTarget.has(`${mapping.targetSheet}:${mapping.targetRow}`),
            ).length,
      templateUrl,
      mappings: inserted,
    });
  } catch (error) {
    console.error("[onboarding/confirm] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Confirmation failed" },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to retrieve existing mappings for a company.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json(
      { error: "companyId query param is required" },
      { status: 400 }
    );
  }

  const db = getDb();
  const mappings = await db
    .select()
    .from(fieldMappings)
    .where(eq(fieldMappings.companyId, parseInt(companyId, 10)));

  return NextResponse.json({
    companyId: parseInt(companyId, 10),
    mappingCount: mappings.length,
    mappings,
  });
}
