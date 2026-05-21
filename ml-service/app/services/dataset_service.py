"""Store and manage imported datasets for GNN training / prediction."""

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import torch

from app.config import settings
from app.data.dataset_importer import (
    build_venue_from_import,
    parse_csv_text,
    parse_json_payload,
)
from app.data.graph_builder import build_graph_from_live_data
from app.data.mock_generator import _split_masks
from app.models.registry import model_registry
from app.services.prediction_service import run_prediction


def _datasets_dir() -> Path:
    d = settings.imported_datasets_path
    d.mkdir(parents=True, exist_ok=True)
    return d


def _meta_path(dataset_id: str) -> Path:
    return _datasets_dir() / f"{dataset_id}.json"


def list_datasets() -> list[dict[str, Any]]:
    out = []
    for path in sorted(_datasets_dir().glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(path.read_text(encoding="utf-8"))
            out.append({
                "id": meta["id"],
                "name": meta.get("name", meta["id"]),
                "created_at": meta.get("created_at"),
                "num_students": meta.get("num_students", 0),
                "has_labels": meta.get("has_labels", False),
            })
        except Exception:
            continue
    return out


def get_dataset(dataset_id: str) -> dict[str, Any]:
    path = _meta_path(dataset_id)
    if not path.exists():
        raise ValueError(f"Dataset '{dataset_id}' not found")
    return json.loads(path.read_text(encoding="utf-8"))


def import_dataset(
    *,
    name: str,
    csv_text: Optional[str] = None,
    json_data: Optional[Any] = None,
) -> dict[str, Any]:
    if csv_text:
        students, labels = parse_csv_text(csv_text)
    elif json_data is not None:
        students, labels = parse_json_payload(json_data)
    else:
        raise ValueError("Provide CSV file or JSON body")

    dataset_id = str(uuid.uuid4())[:8]
    venue = build_venue_from_import(students, dataset_id, name)
    has_labels = any(l is not None for l in labels)

    meta = {
        "id": dataset_id,
        "name": name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "num_students": len(students),
        "has_labels": has_labels,
        "labels": labels if has_labels else None,
        "venue": venue,
    }
    _meta_path(dataset_id).write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return {
        "id": dataset_id,
        "name": name,
        "num_students": len(students),
        "has_labels": has_labels,
        "message": "Dataset imported. Use POST /datasets/{id}/predict to run GNN predictions.",
    }


def _build_graph_with_labels(venue: dict[str, Any], labels: Optional[list[Optional[int]]]) -> Any:
    data = build_graph_from_live_data(venue)
    if labels and any(l is not None for l in labels):
        y = torch.tensor(
            [int(l if l is not None else 0) for l in labels],
            dtype=torch.long,
        )
        masks = _split_masks(data.num_nodes)
        data.y = y
        data.train_mask = masks["train"]
        data.val_mask = masks["val"]
        data.test_mask = masks["test"]
    return data


def predict_on_dataset(dataset_id: str) -> dict[str, Any]:
    meta = get_dataset(dataset_id)
    venue = meta["venue"]
    result = run_prediction(venue_payload=venue)
    result["dataset_id"] = dataset_id
    result["dataset_name"] = meta.get("name")
    return result


def train_on_dataset(
    dataset_id: str,
    epochs: Optional[int] = None,
    model_name: Optional[str] = None,
) -> dict[str, Any]:
    meta = get_dataset(dataset_id)
    if not meta.get("has_labels"):
        raise ValueError(
            "Dataset has no labels. Include a 'label' column (0/1 or clean/flagged) to train."
        )

    labels = meta.get("labels") or []
    data = _build_graph_with_labels(meta["venue"], labels)

    from app.config import ModelName

    if model_name:
        mname = ModelName(model_name)
        model = model_registry.get(mname)
    else:
        mname = model_registry.active_name
        model = model_registry.active_model

    ep = epochs or settings.default_epochs
    train_result = model.train_model(data, epochs=ep, lr=settings.learning_rate)

    weight_path = settings.trained_models_path / f"{mname.value}.pt"
    model.save(str(weight_path))

    return {
        "dataset_id": dataset_id,
        "dataset_name": meta.get("name"),
        "model": mname.value,
        "epochs": ep,
        "train_acc": train_result["train_acc"],
        "final_loss": train_result["loss_history"][-1] if train_result["loss_history"] else None,
        "weights_saved": str(weight_path),
        "message": "Model trained on imported dataset. Predictions will use updated weights.",
    }
