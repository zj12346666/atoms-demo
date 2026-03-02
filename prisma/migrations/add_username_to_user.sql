-- Migration: Add username field to User table
-- Run this SQL manually if Prisma migrate fails

-- Step 1: Add username column (nullable first)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username" TEXT;

-- Step 2: Create unique index on username (for existing NULL values, we'll handle them)
CREATE UNIQUE INDEX IF NOT EXISTS "users_username_key" ON "users" ("username") WHERE "username" IS NOT NULL;

-- Step 3: For existing users without username, generate temporary usernames
-- This is a one-time operation for existing data
-- UPDATE "users" SET "username" = 'user_' || "id" WHERE "username" IS NULL;

-- Step 4: Make username NOT NULL (uncomment after updating existing records)
-- ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

-- Step 5: Add index for faster lookups
CREATE INDEX IF NOT EXISTS "users_username_idx" ON "users" ("username");
