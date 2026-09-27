# ─────────────────────────────────────────────────────────────
# Déploiement de l'API LocaFlow sur Vercel (serverless).
#
# Prérequis : être authentifié Vercel.
#   soit    : vercel login          (OAuth navigateur)
#   soit    : $env:VERCEL_TOKEN="vcp_..."  (jeton depuis vercel.com/account/tokens)
#
# Usage    :  pwsh -File backend/scripts/deploy-vercel.ps1 [-SkipEnv]
#   -SkipEnv : ne (re)crée pas les variables d'environnement (si déjà en place).
#
# Le script lit backend/.env, pousse chaque variable nécessaire sur le
# projet Vercel (production), puis déploie en production.
# ─────────────────────────────────────────────────────────────
param([switch]$SkipEnv)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # -> backend/
Set-Location $root
Write-Output "Contexte : $root"

# 1) Chargement du .env en hashtable
$map = @{}
Get-Content (Join-Path $root '.env') | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
    $map[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
  }
}

# 2) Variable à déployer : SECRET renforcé si jamais on est sur le secret dev
$envNames = 'DATABASE_URL', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'CORS_ORIGIN', 'NODE_ENV'
if (-not $SkipEnv) {
  $map['NODE_ENV'] = 'production'
  Write-Output '— Liaison du projet (réseau auto via dossier backend) —'
  foreach ($name in $envNames) {
    $value = $map[$name]
    if ([string]::IsNullOrEmpty($value)) { Write-Warning "$name vide dans .env, ignoré"; continue }
    Write-Output "  env add $name (production)"
    # retire une valeur existante homonyme pour éviter l'erreur de collision
    vercel env rm $name production --yes 2>$null | Out-Null
    $value | vercel env add $name production
  }
}

# 3) Déploiement production
Write-Output '— Déploiement (vercel deploy --prod) —'
vercel deploy --prod --yes

# 4) Récupération de l'URL du projet
$url = (vercel inspect --url 2>$null)
Write-Output ''
Write-Output '════════════════════════════════════════════════════════'
Write-Output " API en ligne : $url/api"
Write-Output " Santé        : $url/api/health"
Write-Output ''
Write-Output 'Compilez l''app Flutter avec cette URL :'
Write-Output "   flutter build web --release --dart-define=API_BASE_URL=$url/api"
Write-Output '════════════════════════════════════════════════════════'
