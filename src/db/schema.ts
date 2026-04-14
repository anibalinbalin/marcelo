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
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

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
// usageCount and confidence are promotion metadata — they do NOT update on
// every analyst override. Promotion happens in a separate pipeline (W2.3)
// that reads learning_events and writes here only when multiple corroborating
// events exist. See docs/superpowers/plans/2026-04-13-hardening-plan.md
// "Record vs promote split" for the rationale.
export const conceptAliases = pgTable(
  'concept_aliases',
  {
    id: serial('id').primaryKey(),
    conceptId: integer('concept_id').references(() => canonicalConcepts.id).notNull(),
    aliasText: text('alias_text').notNull(),
    language: text('language'),
    sourceCompanyId: integer('source_company_id').references(() => companies.id),
    confidence: real('confidence').default(0.5),
    usageCount: integer('usage_count').default(0).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex('concept_aliases_concept_alias_company_uniq').on(
      t.conceptId,
      t.aliasText,
      t.sourceCompanyId,
    ),
  ],
);

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
  // Self-FK: points at the mapping that replaced this one after a
  // correction was promoted. NULL for active mappings.
  supersededBy: integer('superseded_by').references((): AnyPgColumn => fieldMappings.id),
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
// Full audit trail for mapping changes. One row per state transition.
// Extended in W2.1 with explicit run/value/value fields so events can be
// traced back to the analyst action that produced them without JSONB
// spelunking. The old `previousValues` JSONB column is kept for
// backwards-compatibility with existing rows.
export const mappingHistory = pgTable('mapping_history', {
  id: serial('id').primaryKey(),
  mappingId: integer('mapping_id').references(() => fieldMappings.id).notNull(),
  runId: integer('run_id').references(() => extractionRuns.id),
  extractedValueId: integer('extracted_value_id').references(() => extractedValues.id),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  supersededByHistoryId: integer('superseded_by_history_id').references(
    (): AnyPgColumn => mappingHistory.id,
  ),
  confidenceDelta: real('confidence_delta'),
  previousValues: jsonb('previous_values').notNull(),
  changeReason: text('change_reason'),
  changedBy: text('changed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ── Learning Events ─────────────────────────────────────────────────────────
// Append-only event log for the extraction memory learning loop. Every
// analyst override, automatic promotion, lint flag, or confidence bump
// writes one row here. Writing is cheap and unconditional — promotion
// into concept_aliases/field_mappings is a separate pipeline that reads
// recent events and applies evidence gates.
//
// See docs/superpowers/plans/2026-04-13-hardening-plan.md "Record vs
// promote split" for the rationale. The key insight: recording an event
// is not the same as promoting knowledge into semantic memory; a single
// analyst correction may be company-specific, noise, or contradictory,
// and should not immediately mutate shared aliases/mappings.
export const learningEvents = pgTable(
  'learning_events',
  {
    id: serial('id').primaryKey(),
  // What happened. One of:
  //   override_applied, mapping_relinked, alias_created, alias_matched,
  //   concept_assigned, confidence_updated, mapping_superseded, lint_flagged
  eventType: text('event_type').notNull(),
  // Which kind of semantic-memory entity the event is about.
  //   field_mapping, concept_alias, canonical_concept, extracted_value
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id').notNull(),
  // Optional FKs: whichever semantic objects participated in the event.
  mappingId: integer('mapping_id').references(() => fieldMappings.id),
  conceptId: integer('concept_id').references(() => canonicalConcepts.id),
  aliasId: integer('alias_id').references(() => conceptAliases.id),
  runId: integer('run_id').references(() => extractionRuns.id),
  companyId: integer('company_id').references(() => companies.id),
  extractedValueId: integer('extracted_value_id').references(() => extractedValues.id),
  sourceLabel: text('source_label'),
  // Full JSONB snapshots of the entity before and after the event. Enables
  // replay and supersession-chain reconstruction without walking relational
  // FK chains.
  previousState: jsonb('previous_state'),
  newState: jsonb('new_state'),
  reason: text('reason'),
  // Why the event fired. One of:
  //   analyst_override, auto_merge, lint, migration, backfill
  trigger: text('trigger'),
  // Who caused it. One of:
  //   analyst, llm, system
  actorType: text('actor_type').notNull(),
  actorId: text('actor_id'),
    modelName: text('model_name'),
    promptVersion: text('prompt_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // Idempotency: the same (run, value, event kind) tuple cannot be
    // recorded twice. Protects W2.2's approveValues rewrite from
    // double-writing when Camila hits approve twice. Postgres treats
    // NULL as distinct in unique constraints, so events without a
    // run/value (e.g., manual backfills) are not affected.
    uniqueIndex('learning_events_run_value_type_uniq').on(
      t.runId,
      t.extractedValueId,
      t.eventType,
    ),
  ],
);

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
