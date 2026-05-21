"""Import datasets and run GNN predictions on them."""

import json
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.services import dataset_service

router = APIRouter(prefix="/datasets")


class ImportJsonBody(BaseModel):
    name: str = "imported_dataset"
    students: list[dict[str, Any]]


class ImportCsvTextBody(BaseModel):
    name: str = "imported_dataset"
    csv: str


@router.get("")
async def list_datasets():
    """List all imported datasets."""
    return {"datasets": dataset_service.list_datasets()}


@router.get("/{dataset_id}")
async def get_dataset(dataset_id: str):
    """Get metadata for one imported dataset."""
    try:
        meta = dataset_service.get_dataset(dataset_id)
        return {
            "id": meta["id"],
            "name": meta.get("name"),
            "created_at": meta.get("created_at"),
            "num_students": meta.get("num_students"),
            "has_labels": meta.get("has_labels"),
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/import")
async def import_dataset(
    file: Optional[UploadFile] = File(None),
    name: str = Form("imported_dataset"),
    payload: Optional[str] = Form(None),
):
    """
    Import a dataset from CSV file or JSON.

    CSV must include `student_id` and behavioral feature columns.
    Optional `label` column (0/1 or clean/flagged) enables training on this dataset.
    """
    try:
        if file is not None:
            raw = await file.read()
            text = raw.decode("utf-8-sig")
            fname = file.filename or name
            if not name or name == "imported_dataset":
                name = fname
            result = dataset_service.import_dataset(name=name, csv_text=text)
        elif payload:
            data = json.loads(payload)
            if isinstance(data, dict) and "students" in data:
                json_name = data.get("name", name)
                result = dataset_service.import_dataset(
                    name=json_name,
                    json_data=data,
                )
            else:
                result = dataset_service.import_dataset(name=name, json_data=data)
        else:
            raise HTTPException(
                status_code=400,
                detail="Upload a CSV file or send JSON via form field 'payload'.",
            )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in payload field")


@router.post("/import/csv-text")
async def import_dataset_csv_text(body: ImportCsvTextBody):
    """Import from raw CSV string (used by backend file upload proxy)."""
    try:
        return dataset_service.import_dataset(name=body.name, csv_text=body.csv)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/import/json")
async def import_dataset_json(body: ImportJsonBody):
    """Import dataset from JSON body: { name, students: [...] }."""
    try:
        return dataset_service.import_dataset(
            name=body.name,
            json_data={"students": body.students},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/{dataset_id}/predict")
async def predict_dataset(dataset_id: str):
    """Run GNN integrity predictions on an imported dataset."""
    try:
        return dataset_service.predict_on_dataset(dataset_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@router.post("/{dataset_id}/train")
async def train_dataset(
    dataset_id: str,
    epochs: Optional[int] = None,
    model: Optional[str] = None,
):
    """Train the active GNN on an imported dataset (requires label column)."""
    try:
        return dataset_service.train_on_dataset(
            dataset_id,
            epochs=epochs,
            model_name=model,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")
