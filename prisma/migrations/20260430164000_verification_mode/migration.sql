ALTER TABLE "Experiment"
  ADD COLUMN IF NOT EXISTS "verificationMode" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "verificationSwapSeconds" INTEGER;
