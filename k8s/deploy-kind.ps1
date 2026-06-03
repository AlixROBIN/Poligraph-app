# k8s/deploy-kind.ps1 — Deploiement complet sur Kind (Windows PowerShell)
# Usage : .\k8s\deploy-kind.ps1

$ErrorActionPreference = "Stop"
$PROJECT = Split-Path -Parent $PSScriptRoot

Write-Host "==> Creation cluster Kind" -ForegroundColor Cyan
kind create cluster --name poligraph --config "$PSScriptRoot\kind-config.yaml"
kubectl config use-context kind-poligraph

Write-Host "==> Chargement des images locales dans Kind" -ForegroundColor Cyan
kind load docker-image poligraph-backend:latest  --name poligraph
kind load docker-image poligraph-frontend:latest --name poligraph

Write-Host "==> Namespace" -ForegroundColor Cyan
kubectl apply -f "$PSScriptRoot\namespace.yaml"

Write-Host "==> ZooKeeper + Kafka" -ForegroundColor Cyan
kubectl apply -f "$PSScriptRoot\zookeeper.yaml"
kubectl apply -f "$PSScriptRoot\kafka.yaml"

Write-Host "==> Attente readiness Kafka (max 120s)..." -ForegroundColor Yellow
kubectl wait --namespace=poligraph `
  --for=condition=ready pod `
  --selector=app=kafka `
  --timeout=120s

Write-Host "==> Creation des topics" -ForegroundColor Cyan
kubectl apply -f "$PSScriptRoot\kafka-init.yaml"
kubectl wait --namespace=poligraph `
  --for=condition=complete job/kafka-init-topics `
  --timeout=60s

Write-Host "==> Services applicatifs" -ForegroundColor Cyan
kubectl apply -f "$PSScriptRoot\kafka-producer.yaml"
kubectl apply -f "$PSScriptRoot\spark-streaming.yaml"
kubectl apply -f "$PSScriptRoot\backend.yaml"
kubectl apply -f "$PSScriptRoot\frontend.yaml"

Write-Host ""
Write-Host "==> Stack deployee ! Acces via port-forward :" -ForegroundColor Green
Write-Host "    Backend  : kubectl port-forward -n poligraph svc/backend 8000:8000"
Write-Host "    Frontend : kubectl port-forward -n poligraph svc/frontend 3000:3000"
Write-Host ""
Write-Host "    Logs backend : kubectl logs -n poligraph -l app=backend -f"
