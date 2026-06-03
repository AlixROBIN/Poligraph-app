# Script pour déployer le stack Kubernetes sur Windows avec PowerShell

Write-Host "Deploying Poligraph to Kubernetes..." -ForegroundColor Green

# 1. Créer le namespace
Write-Host "`n1. Creating namespace..." -ForegroundColor Cyan
kubectl apply -f k8s/namespace.yaml

# 2. Déployer Zookeeper
Write-Host "`n2. Deploying Zookeeper..." -ForegroundColor Cyan
kubectl apply -f k8s/zookeeper.yaml
kubectl wait --for=condition=ready pod -l app=zookeeper -n poligraph --timeout=120s

# 3. Déployer Kafka
Write-Host "`n3. Deploying Kafka..." -ForegroundColor Cyan
kubectl apply -f k8s/kafka.yaml
kubectl wait --for=condition=ready pod -l app=kafka -n poligraph --timeout=120s

# 4. Initialiser les topics
Write-Host "`n4. Initializing Kafka topics..." -ForegroundColor Cyan
kubectl apply -f k8s/kafka-init.yaml
kubectl wait --for=condition=complete job -l app=kafka-init -n poligraph --timeout=60s

# 5. Déployer Backend
Write-Host "`n5. Deploying Backend..." -ForegroundColor Cyan
kubectl apply -f k8s/backend.yaml
kubectl wait --for=condition=ready pod -l app=backend -n poligraph --timeout=120s

# 6. Déployer Frontend
Write-Host "`n6. Deploying Frontend..." -ForegroundColor Cyan
kubectl apply -f k8s/frontend.yaml
kubectl wait --for=condition=ready pod -l app=frontend -n poligraph --timeout=120s

# 7. Déployer Kafka Producer
Write-Host "`n7. Deploying Kafka Producer..." -ForegroundColor Cyan
kubectl apply -f k8s/kafka-producer.yaml

# 8. Déployer Spark Streaming
Write-Host "`n8. Deploying Spark Streaming..." -ForegroundColor Cyan
kubectl apply -f k8s/spark-streaming.yaml

Write-Host "`n✓ Deployment complete!" -ForegroundColor Green
Write-Host "`nAccess your services:" -ForegroundColor Yellow
Write-Host "  Frontend:  http://localhost:30300"
Write-Host "  Backend:   http://localhost:30800"
Write-Host "  Zookeeper: localhost:30181"
Write-Host "  Kafka:     localhost:30092"

Write-Host "`nMonitor pods:" -ForegroundColor Yellow
Write-Host "  kubectl get pods -n poligraph -w"
Write-Host "  kubectl logs -n poligraph -l app=backend -f"
