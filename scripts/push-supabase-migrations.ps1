# Push SQL migrations from supabase/migrations/ to remote Postgres.
# Requires: SUPABASE_DB_URL environment variable (URI from Supabase Dashboard -> Database).
# Run from repo root:  .\scripts\push-supabase-migrations.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not $env:SUPABASE_DB_URL) {
    Write-Host "Set SUPABASE_DB_URL to your Postgres connection URI (Supabase Dashboard -> Database -> URI)." -ForegroundColor Yellow
    Write-Host "Example: `$env:SUPABASE_DB_URL = 'postgresql://postgres.xxx:PASSWORD@...'" -ForegroundColor Gray
    exit 1
}

npx --yes supabase@latest db push --db-url $env:SUPABASE_DB_URL --yes
