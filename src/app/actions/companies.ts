"use server";

import { getDb } from "@/db";
import { companies } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getCompanies() {
  const db = getDb();
  return db.select().from(companies).orderBy(companies.name);
}

export async function getCompany(id: number) {
  const db = getDb();
  const [company] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, id));
  return company ?? null;
}

export async function createCompany(data: {
  name: string;
  ticker: string;
  sourceType: string;
}) {
  const db = getDb();
  const [company] = await db.insert(companies).values(data).returning();
  return company;
}

export async function updateCompany(
  id: number,
  data: Partial<{
    name: string;
    ticker: string;
    sourceType: string;
    modelTemplateBlobUrl: string;
    selectedFontColors: string;
  }>
) {
  const db = getDb();
  const [company] = await db
    .update(companies)
    .set(data)
    .where(eq(companies.id, id))
    .returning();
  return company;
}
