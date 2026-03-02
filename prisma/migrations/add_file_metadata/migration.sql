-- Add symbol_hash and last_validation fields to File table
-- This migration adds support for self-healing Code Agent features

-- Add symbol_hash column (for tracking code content changes)
ALTER TABLE "files" 
ADD COLUMN IF NOT EXISTS "symbolHash" TEXT;

-- Add last_validation column (for storing sandbox validation results)
ALTER TABLE "files" 
ADD COLUMN IF NOT EXISTS "lastValidation" JSONB;

-- Create index on symbolHash for fast lookups
CREATE INDEX IF NOT EXISTS "files_symbolHash_idx" ON "files"("symbolHash");

-- Add comment to explain the new fields
COMMENT ON COLUMN "files"."symbolHash" IS 'Hash of code content for detecting changes and re-indexing symbols';
COMMENT ON COLUMN "files"."lastValidation" IS 'Last sandbox validation result (tsc errors, etc.)';
