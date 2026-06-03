# ============================================================
# deploy.ps1 — Déploiement Kubernetes complet de PoliGraph
# Usage : .\k8s\deploy.ps1
#         .\k8s\deploy.ps1 -SkipBuild      (réutilise les images existantes)
#         .\k8s\deploy.ps1 -Teardown       (supprime tout)
# ============================================================

param(
    [switch]$SkipBuild,
    [switch]$Teardown
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

function Write-Step($n, $msg) {
    Write-Host "`n[$n] $msg" -ForegroundColor Cyan
}
function Write-OK($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

# ── Teardown ──────────────────────────────────────────────────────────────────
if ($Teardown) {
    Write-Host "`nSuppression du namespace poligraph..." -ForegroundColor Red
    kubectl delete namespace poligraph --ignore-not-found
    Write-OK "Supprimé."
    exit 0
}

# ── Prérequis ─────────────────────────────────────────────────────────────────
Write-Step "0" "Vérification des prérequis"

try { docker info | Out-Null } catch { Write-Fail "Docker Desktop n'est pas démarré. Lance-le d'abord." }
Write-OK "Docker Desktop actif"

try { kubectl cluster-info | Out-Null } catch { Write-Fail "Kubernetes non disponible. Active-le dans Docker Desktop → Settings → Kubernetes → Enable Kubernetes." }
Write-OK "kubectl connecté au cluster"

# ── Lecture de la config depuis .env ─────────────────────────────────────────
$envFile = Join-Path $ROOT ".env"
$groqKey    = ""
$llmBackend = "ollama"
$ollamaUrl  = "http://host.docker.internal:11434"
$ollamaModel = "llama3.1:8b"
$groqModel  = "llama-3.1-8b-instant"

if (Test-Path $envFile) {
    $envLines = Get-Content $envFile
    foreach ($line in $envLines) {
        if ($line -match "^GROQ_API_KEY=(.+)")   { $groqKey     = $Matches[1].Trim() }
        if ($line -match "^LLM_BACKEND=(.+)")    { $llmBackend  = $Matches[1].Trim() }
        if ($line -match "^OLLAMA_URL=(.+)")     { $ollamaUrl   = $Matches[1].Trim() }
        if ($line -match "^OLLAMA_MODEL=(.+)")   { $ollamaModel = $Matches[1].Trim() }
        if ($line -match "^GROQ_MODEL=(.+)")     { $groqModel   = $Matches[1].Trim() }
    }
}

# En k8s, localhost ne pointe pas vers le host — on force host.docker.internal
if ($ollamaUrl -match "localhost") {
    $ollamaUrl = $ollamaUrl -replace "localhost", "host.docker.internal"
    Write-Warn "OLLAMA_URL: localhost → host.docker.internal (nécessaire en k8s)"
}

Write-OK "LLM_BACKEND=$llmBackend  OLLAMA=$ollamaUrl"
if ($llmBackend -eq "groq" -and -not $groqKey) {
    Write-Warn "GROQ_API_KEY non trouvée — PoliBot dégradé"
}

# ── Build des images Docker ───────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step "1" "Build des images Docker"

    Set-Location $ROOT
    Write-Host "  → Backend + Producer..."
    docker build -t poligraph-backend:latest . --quiet
    Write-OK "poligraph-backend:latest"

    Write-Host "  → Spark Streaming..."
    docker build -t poligraph-spark:latest spark/ --quiet
    Write-OK "poligraph-spark:latest"

    Write-Host "  → Frontend React..."
    docker build -t poligraph-frontend:latest poligraph-app/ --quiet
    Write-OK "poligraph-frontend:latest"
} else {
    Write-Step "1" "Build ignoré (--SkipBuild)"
}

# ── Namespace ─────────────────────────────────────────────────────────────────
Write-Step "2" "Namespace"
kubectl apply -f "$PSScriptRoot\namespace.yaml"
Write-OK "namespace poligraph"

# ── Secret (clés API) ─────────────────────────────────────────────────────────
Write-Step "3" "Secret (GROQ_API_KEY)"
kubectl create secret generic poligraph-secrets `
    --namespace=poligraph `
    --from-literal=GROQ_API_KEY="$groqKey" `
    --from-literal=LLM_BACKEND="$llmBackend" `
    --from-literal=OLLAMA_URL="$ollamaUrl" `
    --from-literal=OLLAMA_MODEL="$ollamaModel" `
    --from-literal=GROQ_MODEL="$groqModel" `
    --dry-run=client -o yaml | kubectl apply -f -
Write-OK "Secret poligraph-secrets"

# ── Infrastructure Kafka ──────────────────────────────────────────────────────
Write-Step "4" "Zookeeper"
kubectl apply -f "$PSScriptRoot\zookeeper.yaml"
Write-Host "  En attente de Zookeeper..."
kubectl wait --for=condition=ready pod -l app=zookeeper -n poligraph --timeout=120s
Write-OK "Zookeeper prêt"

Write-Step "5" "Kafka"
kubectl apply -f "$PSScriptRoot\kafka.yaml"
Write-Host "  En attente de Kafka (peut prendre ~60s)..."
kubectl wait --for=condition=ready pod -l app=kafka -n poligraph --timeout=180s
Write-OK "Kafka prêt"

Write-Step "6" "Création des topics Kafka"
kubectl delete job kafka-init -n poligraph --ignore-not-found
kubectl apply -f "$PSScriptRoot\kafka-init.yaml"
kubectl wait --for=condition=complete job/kafka-init -n poligraph --timeout=120s
Write-OK "Topics raw-articles et features créés"

# ── Applications ──────────────────────────────────────────────────────────────
Write-Step "7" "Backend FastAPI"
kubectl apply -f "$PSScriptRoot\backend.yaml"
kubectl wait --for=condition=ready pod -l app=backend -n poligraph --timeout=180s
Write-OK "Backend prêt → http://localhost:30800/api/health"

Write-Step "8" "Frontend React"
kubectl apply -f "$PSScriptRoot\frontend.yaml"
Write-Host "  En attente du frontend (compilation React ~60s)..."
kubectl wait --for=condition=ready pod -l app=frontend -n poligraph --timeout=300s
Write-OK "Frontend prêt → http://localhost:30300"

Write-Step "9" "Kafka Producer (scraper RSS)"
kubectl apply -f "$PSScriptRoot\kafka-producer.yaml"
Write-OK "Producer déployé"

Write-Step "10" "Spark Streaming + NLP (DistilBERT)"
kubectl apply -f "$PSScriptRoot\spark-streaming.yaml"
Write-OK "Spark déployé (téléchargement du modèle au 1er démarrage ~2 min)"

# ── Résumé ────────────────────────────────────────────────────────────────────
Write-Host "`n" + "="*60 -ForegroundColor Green
Write-Host " PoliGraph déployé avec succès !" -ForegroundColor Green
Write-Host "="*60 -ForegroundColor Green
Write-Host @"

  Frontend  → http://localhost:30300
  Backend   → http://localhost:30800
  API docs  → http://localhost:30800/docs

  Pods :
"@
kubectl get pods -n poligraph

Write-Host @"

  Commandes utiles :
    kubectl get pods -n poligraph -w              # surveiller
    kubectl logs -n poligraph -l app=backend -f   # logs backend
    kubectl logs -n poligraph -l app=spark-streaming -f  # logs Spark
    .\k8s\deploy.ps1 -Teardown                   # tout supprimer
"@
