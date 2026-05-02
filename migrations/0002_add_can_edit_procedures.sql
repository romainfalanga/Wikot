-- Migration: Add can_edit_procedures permission to users
-- Allows admins to grant procedure editing rights to specific employees

ALTER TABLE users ADD COLUMN can_edit_procedures INTEGER NOT NULL DEFAULT 0;

-- Admins have this right by default (they already have full access)
-- Only employees with can_edit_procedures = 1 can create/edit/delete procedures
