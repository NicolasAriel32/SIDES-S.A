// =================================================================
// Cliente Supabase
// =================================================================
// Las credenciales NUNCA van en el código fuente.
// Se cargan desde el archivo .env (ver .env.example).
// Vite expone solo las variables que empiezan con VITE_
// =================================================================

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Mensaje claro en consola cuando faltan las variables
  // (la app igualmente "monta", pero todas las consultas fallarán)
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Faltan variables de entorno.\n' +
    'Creá un archivo .env en la raíz del proyecto con:\n' +
    '  VITE_SUPABASE_URL=https://<proyecto>.supabase.co\n' +
    '  VITE_SUPABASE_ANON_KEY=<anon-public-key>'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // auth: usa los defaults de Supabase (persistSession=true, autoRefreshToken=true)
  // Esto es necesario para que auth.uid() funcione correctamente en RLS.
  realtime: {
    params: {
      eventsPerSecond: 5,    // Limita el throughput del canal Realtime
    },
  },
})
