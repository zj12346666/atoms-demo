-- Add signature and fileId fields to Symbol table
-- Add projectId and unique constraint to File table

-- AlterTable: Add signature, fileId, updatedAt to Symbol
ALTER TABLE "symbols" 
ADD COLUMN IF NOT EXISTS "signature" TEXT,
ADD COLUMN IF NOT EXISTS "fileId" TEXT,
ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: Add index on fileId
CREATE INDEX IF NOT EXISTS "symbols_fileId_idx" ON "symbols"("fileId");

-- CreateIndex: Add index on file
CREATE INDEX IF NOT EXISTS "symbols_file_idx" ON "symbols"("file");

-- AlterTable: Add projectId to File
ALTER TABLE "files"
ADD COLUMN IF NOT EXISTS "projectId" TEXT;

-- CreateIndex: Add index on projectId in File
CREATE INDEX IF NOT EXISTS "files_projectId_idx" ON "files"("projectId");

-- CreateUniqueConstraint: Ensure unique (sessionId, path) in File
CREATE UNIQUE INDEX IF NOT EXISTS "files_sessionId_path_key" ON "files"("sessionId", "path");
