-- Audit chain v2 + quality/recontrol audit coverage
-- Applied to Supabase project SIDES S.A on 2026-10-01.
-- Existing legacy audit rows are not rewritten.
--
-- Main changes:
--   * adds actor UUID/role, event origin, explicit UTC timestamp,
--     chain version and monotonic chain sequence;
--   * starts chain v2 from an immutable SHA-256 snapshot of all legacy rows;
--   * classifies DB_TRIGGER / SEMANTIC_RPC / SYSTEM_MIGRATION events;
--   * adds audit triggers to Quality and Recontrol lifecycle tables;
--   * adds audit_integrity_status() for admin/auditor verification.
--
-- The authoritative function definitions are also present in Supabase migration
-- history under: iso_audit_chain_v2_and_quality_coverage.
--
-- IMPORTANT:
-- Do not backfill/rewrite legacy audit rows. The CHAIN_V2_START checkpoint
-- anchors their exact state as of the migration.

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS usuario_id uuid,
  ADD COLUMN IF NOT EXISTS usuario_rol varchar(30),
  ADD COLUMN IF NOT EXISTS origen_evento varchar(30),
  ADD COLUMN IF NOT EXISTS event_time_utc timestamptz,
  ADD COLUMN IF NOT EXISTS chain_version smallint,
  ADD COLUMN IF NOT EXISTS chain_seq bigint;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_chain_seq_v2
  ON public.audit_log(chain_seq)
  WHERE chain_version = 2 AND chain_seq IS NOT NULL;

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_chain_v2_required_chk,
  ADD CONSTRAINT audit_chain_v2_required_chk
  CHECK (
    chain_version IS DISTINCT FROM 2
    OR (chain_seq IS NOT NULL AND event_time_utc IS NOT NULL AND origen_evento IS NOT NULL)
  );

-- See Supabase migration history for the complete bodies of:
--   public._audit_append_v2(...)
--   public._audit_append(...)
--   public.registrar_evento_auditoria(...)
--   public.audit_integrity_status()
--
-- Quality/Recontrol tables with trg_audit_trail enabled:
--   controles_calidad
--   mediciones
--   controles_defectos
--   recontroles
--   recontrol_defectos
--   mermas
--   ordenes_maquina
--   sesiones_calidad
--
-- Existing audited tables remain:
--   pruebas
--   no_conformidades
--   usuarios
--   verificaciones_fisicas
--   calibraciones
