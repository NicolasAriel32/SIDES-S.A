-- Fix Auth signup profile mapping for SIDES internal legajos.
-- users.legajo is varchar(4); the old fallback "LEGAJO-" || UUID prefix was 15 chars,
-- causing auth.users inserts to fail inside on_auth_user_created.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_legajo   TEXT;
  v_nombre   TEXT;
  v_apellido TEXT;
  v_rol      TEXT;
  v_maquina  TEXT;
BEGIN
  v_legajo := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data->>'legajo'), ''),
    CASE
      WHEN NEW.email ~* '^[0-9]{1,4}@sides[.]internal$'
      THEN split_part(NEW.email, '@', 1)
      ELSE NULL
    END
  );

  IF v_legajo IS NULL OR char_length(v_legajo) > 4 THEN
    RAISE EXCEPTION 'Legajo inválido: se requiere un legajo de hasta 4 caracteres';
  END IF;

  v_nombre   := COALESCE(NEW.raw_user_meta_data->>'nombre', 'Sin nombre');
  v_apellido := COALESCE(NEW.raw_user_meta_data->>'apellido', '');
  v_rol      := COALESCE(NEW.raw_user_meta_data->>'rol', 'operario');
  v_maquina  := NEW.raw_user_meta_data->>'maquina_asignada';

  INSERT INTO public.usuarios (
    id, legajo, nombre, apellido, email, rol, maquina_asignada, activo, fuerza_cambio
  )
  VALUES (
    NEW.id, v_legajo, v_nombre, v_apellido, NEW.email, v_rol, v_maquina, true, true
  )
  ON CONFLICT (legajo) DO UPDATE
    SET id = EXCLUDED.id;

  BEGIN
    INSERT INTO public.profiles (id, legajo, nombre, apellido, rol, maquina_asignada, activo)
    SELECT u.id, u.legajo, u.nombre, u.apellido, u.rol, u.maquina_asignada, u.activo
    FROM public.usuarios u
    WHERE u.legajo = v_legajo
    ON CONFLICT (legajo) DO UPDATE
      SET id = EXCLUDED.id,
          nombre = EXCLUDED.nombre,
          apellido = EXCLUDED.apellido,
          rol = EXCLUDED.rol,
          maquina_asignada = EXCLUDED.maquina_asignada,
          activo = EXCLUDED.activo;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NEW;
END;
$function$;
