from __future__ import annotations

import logging
from typing import Dict, Optional

from app.config import ModelName, settings

logger = logging.getLogger(__name__)


class ModelRegistry:
    """Singleton registry for loading, caching, and switching GNN models."""

    def __init__(self):
        self._models: Dict[str, object] = {}
        self._active_name: Optional[ModelName] = None
        self._trained_status: Dict[str, bool] = {}

    def initialize(self):
        from app.models.vanilla_gcn import VanillaGCN
        from app.models.h2gcn import H2GCNModel
        from app.models.fagcn import FAGCNModel
        from app.models.graphsage import GraphSAGEModel
        from app.data.mock_generator import generate_mock_venue

        num_features = settings.num_node_features
        num_classes = settings.num_classes
        hidden = settings.hidden_channels
        dropout = settings.dropout

        self._models = {
            ModelName.VANILLA_GCN: VanillaGCN(num_features, hidden, num_classes, dropout),
            ModelName.H2GCN: H2GCNModel(num_features, hidden, num_classes, dropout),
            ModelName.FAGCN: FAGCNModel(num_features, hidden, num_classes, dropout),
            ModelName.GRAPHSAGE: GraphSAGEModel(num_features, hidden, num_classes, dropout),
        }
        self._active_name = settings.default_model
        settings.trained_models_path.mkdir(parents=True, exist_ok=True)

        needs_training = []
        for name, model in self._models.items():
            weight_path = settings.trained_models_path / f"{name.value}.pt"
            if weight_path.exists():
                try:
                    model.load(str(weight_path))
                    self._trained_status[name.value] = True
                    logger.info("Loaded cached weights for %s", name.value)
                except Exception as exc:
                    logger.warning("Could not load %s: %s — will retrain", name.value, exc)
                    needs_training.append((name, model, weight_path))
            else:
                needs_training.append((name, model, weight_path))

        if needs_training:
            logger.info("Auto-training %d model(s) on synthetic data for live predictions...",
                        len(needs_training))
            shared_data = generate_mock_venue(
                num_students=settings.mock_venue_size,
                cheat_ratio=settings.mock_cheat_ratio,
                seed=42,
            )
            for name, model, weight_path in needs_training:
                try:
                    result = model.train_model(
                        shared_data,
                        epochs=settings.default_epochs,
                        lr=settings.learning_rate,
                    )
                    model.save(str(weight_path))
                    self._trained_status[name.value] = True
                    logger.info("  %s trained — final acc %.3f, weights saved",
                                name.value, result.get("train_acc", 0.0))
                except Exception as exc:
                    logger.error("Failed to train %s: %s", name.value, exc)
                    self._trained_status[name.value] = False

    @property
    def active_model(self):
        return self._models[self._active_name]

    @property
    def active_name(self) -> ModelName:
        return self._active_name

    def switch(self, name: ModelName):
        if name not in self._models:
            raise ValueError(f"Unknown model: {name}")
        self._active_name = name

    def get(self, name: ModelName):
        if name not in self._models:
            raise ValueError(f"Unknown model: {name}")
        return self._models[name]

    def list_models(self):
        return {
            "models": [n.value for n in self._models],
            "active": self._active_name.value,
            "trained": dict(self._trained_status),
        }


model_registry = ModelRegistry()
