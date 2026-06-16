-- Migration: Drop role_name check constraint to allow custom roles
-- Created: 2026-06-16

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_name_check;
