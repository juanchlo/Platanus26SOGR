import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';

// Anon key pública del CLI local (supabase start). En prod sobreescribir con NEXT_PUBLIC_SUPABASE_ANON_KEY.
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

type SupabaseClient = ReturnType<typeof createClient>;
const g = globalThis as typeof globalThis & { _supabase?: SupabaseClient };

export const supabase =
  g._supabase ??
  (g._supabase = createClient(supabaseUrl, supabaseAnonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  }));
