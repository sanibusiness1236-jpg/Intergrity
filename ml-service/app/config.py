from pydantic_settings import BaseSettings
from enum import Enum
from pathlib import Path


class AppMode(str, Enum):
    TEST = "test"
    PRODUCTION = "production"


class ModelName(str, Enum):
    VANILLA_GCN = "vanilla_gcn"
    H2GCN = "h2gcn"
    FAGCN = "fagcn"
    GRAPHSAGE = "graphsage"


class Settings(BaseSettings):
    mode: AppMode = AppMode.TEST
    default_model: ModelName = ModelName.VANILLA_GCN
    host: str = "0.0.0.0"
    port: int = 8000
    trained_models_dir: str = "trained_models"
    imported_datasets_dir: str = "imported_datasets"
    static_dir: str = "static"

    num_node_features: int = 9
    num_classes: int = 2
    hidden_channels: int = 64
    dropout: float = 0.3
    learning_rate: float = 0.01
    default_epochs: int = 200

    mock_venue_size: int = 80
    mock_cheat_ratio: float = 0.2

    model_config = {"env_prefix": "INTEGRITY_", "env_file": ".env"}

    @property
    def trained_models_path(self) -> Path:
        return Path(self.trained_models_dir)

    @property
    def static_path(self) -> Path:
        return Path(self.static_dir)

    @property
    def imported_datasets_path(self) -> Path:
        return Path(self.imported_datasets_dir)


settings = Settings()
