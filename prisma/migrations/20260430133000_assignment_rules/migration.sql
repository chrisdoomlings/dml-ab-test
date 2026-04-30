DO $$ BEGIN
  CREATE TYPE "AssignmentMode" AS ENUM ('STICKY', 'SESSION');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AudienceRule" AS ENUM ('ALL_VISITORS', 'NEW_VISITORS', 'RETURNING_VISITORS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "Experiment"
  ADD COLUMN IF NOT EXISTS "assignmentMode" "AssignmentMode" NOT NULL DEFAULT 'STICKY',
  ADD COLUMN IF NOT EXISTS "assignmentTtlDays" INTEGER,
  ADD COLUMN IF NOT EXISTS "audienceRule" "AudienceRule" NOT NULL DEFAULT 'ALL_VISITORS';
