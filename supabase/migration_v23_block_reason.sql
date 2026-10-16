-- Executar após migration_v23_access.sql, incluindo instalações onde esse SQL já foi aplicado.
-- Apenas devolve o motivo de bloqueio da própria conta autenticada.
BEGIN;
CREATE OR REPLACE FUNCTION public.spawnvault_access_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE access_row public.spawnvault_user_access%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sessão necessária' USING ERRCODE='42501'; END IF;
 SELECT * INTO access_row FROM public.spawnvault_user_access WHERE user_id=auth.uid();
 RETURN jsonb_build_object('blocked',coalesce(access_row.blocked,false),
 'reason',CASE WHEN coalesce(access_row.blocked,false) THEN coalesce(access_row.reason,'') ELSE '' END);
END;
$$;
REVOKE ALL ON FUNCTION public.spawnvault_access_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spawnvault_access_status() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
