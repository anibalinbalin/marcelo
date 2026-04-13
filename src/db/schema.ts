import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

// ── Companies ───────────────────────────────────────────────────────────────
export const companies = pgTable('companies', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  ticker: text('ticker').notNull(),
  sourceType: text('source_type').notNull().default('pdf'),
  modelTemplateBlobUrl: text('model_template_blob_url'),
  selectedFontColors: text('selected_font_colors'), // JSON array of hex strings
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Canonical Concepts ──────────────────────────────────────────────────────
export const canonicalConcepts = pgTable('canonical_concepts', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  category: text('category').notNull(), // "income_statement" | "balance_sheet" | "cash_flow"
  typicalSign: text('typical_sign'),    // "positive" | "negative" | "either"
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Concept Aliases ─────────────────────────────────────────────────────────
export const conceptAliases = pgTable('concept_aliases', {
  id: serial('id').primaryKey(),
  conceptId: integer('concept_id').references(() => canonicalConcepts.id).notNull(),
  aliasText: text('alias_text').notNull(),
  language: text('language'),
  sourceCompanyId: integer('source_company_id').references(() => companies.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Field Mappings ──────────────────────────────────────────────────────────
export const fieldMappings = pgTable('field_mappings', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  colMode: text('col_mode').notNull().default('quarterly_offset'),
  sourceSection: text('source_section'),
  sourceLabel: text('source_label').notNull(),
  sourceRow: integer('source_row'),
  sourceCol: text('source_col'),
  targetSheet: text('target_sheet').notNull(),
  targetRow: integer('target_row').notNull(),
  targetColBase: text('target_col_base').notNull(),
  targetColStep: integer('target_col_step').default(1),
  baseQuarter: text('base_quarter').notNull(),
  expectedCurrency: text('expected_currency'),
  valueTransform: text('value_transform'),
  validationSign: text('validation_sign'),
  isActive: boolean('is_active').default(true),
  conceptId: integer('concept_id').references(() => canonicalConcepts.id),
  confidenceScore: real('confidence_score').default(0.5),
  lastVerifiedAt: timestamp('last_verified_at'),
  correctionCount: integer('correction_count').default(0),
  supersededBy: integer('superseded_by'),
  updatedAt: timestamp('updated_at').defaultNow(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Extraction Runs ─────────────────────────────────────────────────────────
export const extractionRuns = pgTable('extraction_runs', {
  id: serial('id').primaryKey(),
  companyId: integer('company_id').references(() => companies.id),
  quarter: text('quarter').notNull(),
  sourceFileUrl: text('source_file_url'),
  status: text('status').default('pending'),
  extractedAt: timestamp('extracted_at'),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  outputFileUrl: text('output_file_url'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Extracted Values ────────────────────────────────────────────────────────
export const extractedValues = pgTable('extracted_values', {
  id: serial('id').primaryKey(),
  runId: integer('run_id').references(() => extractionRuns.id),
  mappingId: integer('mapping_id').references(() => fieldMappings.id),
  extractedValue: text('extracted_value'), // stored as text for precision
  confidence: real('confidence'),
  validationStatus: text('validation_status'),
  validationMessage: text('validation_message'),
  analystOverride: text('analyst_override'),
  matchedAliasId: integer('matched_alias_id').references(() => conceptAliases.id),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Mapping History ─────────────────────────────────────────────────────────
export const mappingHistory = pgTable('mapping_history', {
  id: serial('id').primaryKey(),
  mappingId: integer('mapping_id').references(() => fieldMappings.id).notNull(),
  previousValues: jsonb('previous_values').notNull(),
  changeReason: text('change_reason'),
  changedBy: text('changed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Relations ───────────────────────────────────────────────────────────────
export const companiesRelations = relations(companies, ({ many }) => ({
  fieldMappings: many(fieldMappings),
  extractionRuns: many(extractionRuns),
}));

export const fieldMappingsRelations = relations(fieldMappings, ({ one, many }) => ({
  company: one(companies, {
    fields: [fieldMappings.companyId],
    references: [companies.id],
  }),
  concept: one(canonicalConcepts, {
    fields: [fieldMappings.conceptId],
    references: [canonicalConcepts.id],
  }),
  extractedValues: many(extractedValues),
  history: many(mappingHistory),
}));

export const extractionRunsRelations = relations(extractionRuns, ({ one, many }) => ({
  company: one(companies, {
    fields: [extractionRuns.companyId],
    references: [companies.id],
  }),
  extractedValues: many(extractedValues),
}));

export const extractedValuesRelations = relations(extractedValues, ({ one }) => ({
  run: one(extractionRuns, {
    fields: [extractedValues.runId],
    references: [extractionRuns.id],
  }),
  mapping: one(fieldMappings, {
    fields: [extractedValues.mappingId],
    references: [fieldMappings.id],
  }),
  matchedAlias: one(conceptAliases, {
    fields: [extractedValues.matchedAliasId],
    references: [conceptAliases.id],
  }),
}));

export const canonicalConceptsRelations = relations(canonicalConcepts, ({ many }) => ({
  aliases: many(conceptAliases),
  fieldMappings: many(fieldMappings),
}));

export const conceptAliasesRelations = relations(conceptAliases, ({ one }) => ({
  concept: one(canonicalConcepts, {
    fields: [conceptAliases.conceptId],
    references: [canonicalConcepts.id],
  }),
  sourceCompany: one(companies, {
    fields: [conceptAliases.sourceCompanyId],
    references: [companies.id],
  }),
}));

export const mappingHistoryRelations = relations(mappingHistory, ({ one }) => ({
  mapping: one(fieldMappings, {
    fields: [mappingHistory.mappingId],
    references: [fieldMappings.id],
  }),
}));
