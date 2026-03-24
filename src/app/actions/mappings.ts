"use server";

import { getDb } from "@/db";
import { fieldMappings } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function getMappings(companyId: number) {
  const db = getDb();
  return db
    .select()
    .from(fieldMappings)
    .where(
      and(eq(fieldMappings.companyId, companyId), eq(fieldMappings.isActive, true))
    )
    .orderBy(fieldMappings.targetSheet, fieldMappings.targetRow);
}

export async function createMapping(data: {
  companyId: number;
  colMode?: string;
  sourceSection?: string;
  sourceLabel: string;
  sourceRow?: number;
  sourceCol?: string;
  targetSheet: string;
  targetRow: number;
  targetColBase: string;
  targetColStep?: number;
  baseQuarter: string;
  expectedCurrency?: string;
  valueTransform?: string;
  validationSign?: string;
}) {
  const db = getDb();
  const [mapping] = await db.insert(fieldMappings).values(data).returning();
  return mapping;
}

export async function createMappingsBulk(
  mappings: {
    companyId: number;
    colMode?: string;
    sourceSection?: string;
    sourceLabel: string;
    sourceRow?: number;
    sourceCol?: string;
    targetSheet: string;
    targetRow: number;
    targetColBase: string;
    targetColStep?: number;
    baseQuarter: string;
    expectedCurrency?: string;
    valueTransform?: string;
    validationSign?: string;
  }[]
) {
  const db = getDb();
  return db.insert(fieldMappings).values(mappings).returning();
}

export async function updateMapping(
  id: number,
  data: Partial<{
    sourceSection: string;
    sourceLabel: string;
    sourceRow: number;
    sourceCol: string;
    targetSheet: string;
    targetRow: number;
    targetColBase: string;
    targetColStep: number;
    baseQuarter: string;
    expectedCurrency: string;
    valueTransform: string;
    validationSign: string;
    colMode: string;
    isActive: boolean;
  }>
) {
  const db = getDb();
  const [mapping] = await db
    .update(fieldMappings)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(fieldMappings.id, id))
    .returning();
  return mapping;
}

export async function deleteMapping(id: number) {
  const db = getDb();
  const [mapping] = await db
    .update(fieldMappings)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(fieldMappings.id, id))
    .returning();
  return mapping;
}
