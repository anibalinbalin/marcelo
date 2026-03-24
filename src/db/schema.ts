import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
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
  createdAt: timestamp('created_at').defaultNow(),
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
  extractedValues: many(extractedValues),
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
}));
