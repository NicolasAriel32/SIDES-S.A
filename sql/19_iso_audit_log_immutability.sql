-- ISO-oriented audit_log immutability hardening
-- Applied to Supabase project SIDES S.A on 2026-10-01.

CREATE OR REPLACE FUNCTION public.fn_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

REVOKE ALL ON FUNCTION public.fn_audit_log_immutable() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_audit_log_no_update_delete ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_update_delete
BEFORE UPDATE OR DELETE ON public.audit_log
FOR EACH ROW
EXECUTE FUNCTION public.fn_audit_log_immutable();

DROP TRIGGER IF EXISTS trg_audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER trg_audit_log_no_truncate
BEFORE TRUNCATE ON public.audit_log
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_audit_log_immutable();

REVOKE ALL PRIVILEGES ON TABLE public.audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log FROM authenticated;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_log FROM service_role;
GRANT SELECT ON TABLE public.audit_log TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_hash_evento
  ON public.audit_log(hash_evento)
  WHERE hash_evento IS NOT NULL;

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_hash_len_chk,
  ADD CONSTRAINT audit_hash_len_chk
  CHECK (hash_evento IS NULL OR length(hash_evento)=64);

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_prev_hash_len_chk,
  ADD CONSTRAINT audit_prev_hash_len_chk
  CHECK (hash_evento_anterior IS NULL OR length(hash_evento_anterior)=64);

ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_firma_len_chk,
  ADD CONSTRAINT audit_firma_len_chk
  CHECK (firma_evento IS NULL OR length(firma_evento)=64);
