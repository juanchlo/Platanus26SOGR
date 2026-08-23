#!/usr/bin/env bash
# ============================================================
# dev_db.sh — Levanta Supabase local y aplica migraciones + seed
#
# Uso:
#   bash scripts/dev_db.sh           # levanta (o reutiliza) Supabase y migra
#   bash scripts/dev_db.sh reset     # reinicia DB desde cero y migra
#
# Requiere: supabase CLI (yay -S supabase-bin) y Docker corriendo.
# ============================================================
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BACKEND_DIR"

LOCAL_DB_URL="postgresql+asyncpg://postgres:postgres@localhost:54322/postgres"

if [[ "${1:-}" == "reset" ]]; then
  echo "→ Reiniciando Supabase local (DB limpia)..."
  supabase stop --no-backup 2>/dev/null || true
  supabase start
elif supabase status 2>/dev/null | grep -q "54322"; then
  echo "✓ Supabase local ya está corriendo."
else
  echo "→ Iniciando Supabase local..."
  supabase start
fi

echo ""
echo "→ Aplicando migraciones y seed..."
DATABASE_URL="$LOCAL_DB_URL" DB_SSL_REQUIRED=false \
  uv run python scripts/apply_supabase_migrations.py

echo ""
echo "→ Sembrando usuarios demo..."
DATABASE_URL="$LOCAL_DB_URL" DB_SSL_REQUIRED=false \
  uv run python scripts/seed_users.py

echo ""
echo "✓ Base de datos de desarrollo lista."
echo ""
echo "Supabase Studio:  http://localhost:54323"
echo "DB directa:       postgresql://postgres:postgres@localhost:54322/postgres"
echo ""
echo "Para correr el backend apuntando a la DB local:"
echo "  set -a && source .env.dev && set +a && uv run uvicorn backend.main:app --reload"
