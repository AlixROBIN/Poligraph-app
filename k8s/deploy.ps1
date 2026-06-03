# ============================================================
# deploy.ps1 — Deploiement Kubernetes complet de PoliGraph
# Usage : .\k8s\deploy.ps1
#         .\k8s\deploy.ps1 -SkipBuild    (reutilise les images)
#         .\k8s\deploy.ps1 -Teardown     (supprime tout)
# ============================================================

param(
    [switch]$SkipBuild,
    [switch]$Teardown
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path $PSScriptRoot -Parent

function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-OK($msg)       { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg)     { Write-Host "  /!\  $msg" -ForegroundColor Yellow }
function Write-Fail($msg)     { Write-Host "  ERR $msg" -ForegroundColor Red; exit 1 }

# ── Teardown ──────────────────────────────────────────────────────────────────
if ($Teardown) {
    Write-Host "`nSuppression du namespace poligraph..." -ForegroundColor Red
    kubectl delete namespace poligraph --ignore-not-found
    Write-OK "Supprime."
    exit 0
}

# ── Prerequis ─────────────────────────────────────────────────────────────────
Write-Step "0" "Verification des prerequis"

docker info > $null
if ($LASTEXITCODE -ne 0) { Write-Fail "Docker Desktop n'est pas demarre." }
Write-OK "Docker Desktop actif"

kubectl cluster-info > $null
if ($LASTEXITCODE -ne 0) { Write-Fail "Kubernetes non disponible. Active-le dans Docker Desktop > Settings > Kubernetes > Enable Kubernetes." }
Write-OK "kubectl connecte au cluster"

# ── Lecture du .env ───────────────────────────────────────────────────────────
$envFile     = Join-Path $ROOT ".env"
$ollamaUrl   = "http://host.docker.internal:11434"
$ollamaModel = "llama3.1:8b"

if (Test-Path $envFile) {
    foreach ($line in (Get-Content $envFile)) {
        if ($line -match "^OLLAMA_URL=(.+)")    { $ollamaUrl   = $Matches[1].Trim() }
        if ($line -match "^OLLAMA_MODEL=(.+)")  { $ollamaModel = $Matches[1].Trim() }
    }
}

# En k8s, localhost ne pointe pas vers le host — on remplace par host.docker.internal
if ($ollamaUrl -match "localhost") {
    $ollamaUrl = $ollamaUrl -replace "localhost", "host.docker.internal"
    Write-Warn "OLLAMA_URL: localhost remplace par host.docker.internal (requis en k8s)"
}

Write-OK "Backend LLM : Ollama  ->  $ollamaUrl  (modele : $ollamaModel)"

# ── Build des images Docker ───────────────────────────────────────────────────
if (-not $SkipBuild) {
    Write-Step "1" "Build des images Docker"
    Set-Location $ROOT

    Write-Host "  -> Backend + Producer..."
    docker build -t poligraph-backend:latest . --quiet
    Write-OK "poligraph-backend:latest"

    Write-Host "  -> Spark Streaming..."
    docker build -t poligraph-spark:latest spark/ --quiet
    Write-OK "poligraph-spark:latest"

    Write-Host "  -> Frontend React..."
    docker build -t poligraph-frontend:latest poligraph-app/ --quiet
    Write-OK "poligraph-frontend:latest"
} else {
    Write-Step "1" "Build ignore (-SkipBuild)"
}

# ── Namespace ─────────────────────────────────────────────────────────────────
Write-Step "2" "Namespace"
kubectl apply -f "$PSScriptRoot\namespace.yaml"
Write-OK "namespace poligraph"

# ── Secret ────────────────────────────────────────────────────────────────────
Write-Step "3" "Secret (cles API)"
kubectl create secret generic poligraph-secrets `
    --namespace=poligraph `
    --from-literal=LLM_BACKEND="ollama" `
    --from-literal=OLLAMA_URL="$ollamaUrl" `
    --from-literal=OLLAMA_MODEL="$ollamaModel" `
    --dry-run=client -o yaml | kubectl apply -f -
Write-OK "Secret poligraph-secrets"

# ── Infrastructure Kafka ──────────────────────────────────────────────────────
Write-Step "4" "Zookeeper"
kubectl apply -f "$PSScriptRoot\zookeeper.yaml"
Write-Host "  En attente de Zookeeper..."
kubectl rollout status statefulset/zookeeper -n poligraph --timeout=120s
Write-OK "Zookeeper pret"

Write-Step "5" "Kafka"
kubectl apply -f "$PSScriptRoot\kafka.yaml"
Write-Host "  En attente de Kafka (peut prendre ~60s)..."
kubectl rollout status statefulset/kafka -n poligraph --timeout=180s
Write-OK "Kafka pret"

Write-Step "6" "Creation des topics Kafka"
kubectl delete job kafka-init-topics -n poligraph --ignore-not-found
kubectl apply -f "$PSScriptRoot\kafka-init.yaml"
kubectl wait --for=condition=complete job/kafka-init-topics -n poligraph --timeout=120s
Write-OK "Topics raw-articles et features crees"

# ── Applications ──────────────────────────────────────────────────────────────
Write-Step "7" "Backend FastAPI"
kubectl apply -f "$PSScriptRoot\backend.yaml"
kubectl rollout status deployment/backend -n poligraph --timeout=180s
Write-OK "Backend pret -> http://localhost:30800/api/health"

Write-Step "8" "Frontend React"
kubectl apply -f "$PSScriptRoot\frontend.yaml"
Write-Host "  En attente du frontend (compilation React ~60s)..."
kubectl rollout status deployment/frontend -n poligraph --timeout=600s
Write-OK "Frontend pret -> http://localhost:30300"

Write-Step "9" "Kafka Producer (scraper RSS)"
kubectl apply -f "$PSScriptRoot\kafka-producer.yaml"
Write-OK "Producer deploye"

Write-Step "10" "Spark Streaming + NLP (DistilBERT)"
kubectl apply -f "$PSScriptRoot\spark-streaming.yaml"
Write-OK "Spark deploye (telechargement modele au 1er demarrage ~2 min)"

# ── Résumé ────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " PoliGraph deploye avec succes !" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend  -> http://localhost:30300"
Write-Host "  Backend   -> http://localhost:30800"
Write-Host "  API docs  -> http://localhost:30800/docs"
Write-Host ""
Write-Host "Pods :"
kubectl get pods -n poligraph
Write-Host ""
Write-Host "Commandes utiles :"
Write-Host "  kubectl get pods -n poligraph -w"
Write-Host "  kubectl logs -n poligraph -l app=backend -f"
Write-Host "  kubectl logs -n poligraph -l app=spark-streaming -f"
Write-Host "  .\k8s\deploy.ps1 -Teardown"
