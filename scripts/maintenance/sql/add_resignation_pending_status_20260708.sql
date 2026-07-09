-- Migration: add 'pending' status to resignations table
-- Date: 2026-07-08
-- Purpose: support unit pre-notifications (單位預通知) as pending before HR formal notice

ALTER TABLE resignations
  DROP CONSTRAINT IF EXISTS resignations_status_check;

ALTER TABLE resignations
  ADD CONSTRAINT resignations_status_check
  CHECK(status IN ('pending','active','done','cancelled'));
