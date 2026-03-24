# PoliGraph Data Analysis

Interface interactive pour analyser les données politiques de l'API PoliGraph.

## 🎯 Architecture

- **Backend** : FastAPI (Python 3.12)
- **Frontend** : React 18 + Recharts
- **Data** : Pipeline Python (Pandas, Matplotlib)
- **Containerization** : Docker Compose

## 📦 Structure

```
inseeProject/
├── api.py                    # Backend FastAPI
├── main.py                   # Orchestrateur pipeline
├── config.py                 # Configuration globale
├── fetching.py              # Récupération API
├── exploration.py           # Exploration données
├── cleaning.py              # Nettoyage données
├── mining.py                # Data Mining
├── logger_config.py         # Configuration logging
├── requirements.txt         # Dépendances Python
├── Dockerfile               # Container backend
├── docker-compose.yml       # Orchestration
├── poligraph-app/           # App React
│   ├── src/
│   │   ├── components/
│   │   ├── data/
│   │   ├── styles/
│   │   └── App.js
│   ├── package.json
│   └── Dockerfile
├── data/                    # Données générées
├── output/                  # Graphiques
└── logs/                    # Logs pipeline
```

## 🚀 Quick Start

### Sans Docker

```bash
# 1. Pipeline Python
python main.py

# 2. Backend (terminal 2)
python api.py

# 3. Frontend (terminal 3)
cd poligraph-app
npm install
npm start
```

### Avec Docker

```bash
docker compose up --build
```

## 📊 Features

- ✅ Récupération API automatisée
- ✅ Explorations + Visualisations
- ✅ Data Mining thématique
- ✅ Dashboard interactif React
- ✅ API REST FastAPI
- ✅ Containerization Docker

## 🔗 Endpoints API

- `GET /api/health` - Status
- `GET /api/data?limit=100&offset=0` - Données paginées
- `GET /api/metrics` - Métriques globales
- `GET /api/themes` - Thèmes détectés
- `GET /api/column/{col_name}` - Stats colonne

