---
title: Integrity ML Service
emoji: 🛡️
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 8000
pinned: false
license: mit
short_description: GNN-based academic integrity prediction API
---

# INTEGRITY ML Service

GNN-based academic integrity prediction service used by the
[INTEGRITY platform](https://github.com/sanibusiness1236-jpg/Intergrity).

## What this Space exposes

| Endpoint | Description |
| --- | --- |
| `GET /health` | Service health and current mode |
| `GET /models` | List available GNN architectures and which one is active |
| `POST /predict` | Run an integrity prediction over a venue graph |
| `POST /evaluate` | Run evaluation metrics over a labelled venue graph |
| `GET /docs` | Auto-generated Swagger UI |

## Available models

The registry pre-loads four graph neural network architectures with
checkpoints committed to this repo so cold starts are fast:

- **Vanilla GCN** (default)
- **H2GCN** — heterophily-aware
- **FAGCN** — frequency-adaptive
- **GraphSAGE**

## Local development

```bash
python -m venv .venv
.\.venv\Scripts\activate          # (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Deployment

This folder is shaped for Hugging Face Spaces (Docker SDK). The
`Dockerfile` at the root of this directory is what HF will build.
The trained `.pt` files under `trained_models/` are committed so the
service is ready to serve predictions the moment the container starts.
