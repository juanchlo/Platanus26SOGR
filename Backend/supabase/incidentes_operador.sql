-- ============================================================
-- SOGR - Incidentes y Testimonios de Operador de Campo con IA
-- ============================================================

alter table if exists necesidades
  add column if not exists testimonio text,
  add column if not exists analisis_ia text,
  add column if not exists recursos_solicitados text,
  add column if not exists prioridad_sugerida int,
  add column if not exists operador_id uuid references public.users(id),
  add column if not exists origen_reporte text default 'operador_campo';
