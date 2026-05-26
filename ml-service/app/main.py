from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.models.registry import model_registry
from app.routes import health, predict, evaluate, models as models_route, datasets, ai_questions, file_extract


settings.trained_models_path.mkdir(parents=True, exist_ok=True)
settings.imported_datasets_path.mkdir(parents=True, exist_ok=True)
settings.static_path.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(application: FastAPI):
    model_registry.initialize()
    yield


app = FastAPI(
    title="INTEGRITY ML Service",
    description="GNN-based academic integrity prediction service",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=settings.static_dir), name="static")

app.include_router(health.router, tags=["Health"])
app.include_router(models_route.router, prefix="/models", tags=["Models"])
app.include_router(predict.router, tags=["Prediction"])
app.include_router(evaluate.router, tags=["Evaluation"])
app.include_router(datasets.router, tags=["Datasets"])
app.include_router(ai_questions.router)
app.include_router(file_extract.router)
