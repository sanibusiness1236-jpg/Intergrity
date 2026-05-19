"""Orchestrates graph building and inference for live or test predictions."""

from typing import Any, Optional

from app.config import AppMode, settings
from app.data.graph_builder import build_graph_from_live_data
from app.data.mock_generator import generate_mock_venue
from app.models.registry import model_registry


def run_prediction(
    venue_payload: Optional[dict[str, Any]] = None,
) -> dict:
    """
    Run integrity prediction on a venue.

    Resolution rules:
      * If a venue payload with students is supplied, ALWAYS use it (live mode).
        This is what the examiner UI uses to score real exam sessions, even when
        the service is started in TEST mode for development convenience.
      * Otherwise, fall back to a freshly-generated mock venue so the dashboard
        still has something to demo / benchmark against.
      * Production mode without a payload is an explicit error.
    """
    has_live_data = (
        venue_payload is not None
        and isinstance(venue_payload.get("students"), list)
        and len(venue_payload["students"]) > 0
    )

    if has_live_data:
        data = build_graph_from_live_data(venue_payload)
        student_ids = data.student_ids
        data_source = "live"
    else:
        if settings.mode == AppMode.PRODUCTION:
            raise ValueError("Production mode requires venue_payload with students")
        data = generate_mock_venue()
        student_ids = [f"mock_student_{i}" for i in range(data.num_nodes)]
        data_source = "mock"

    model = model_registry.active_model
    probs = model.predict(data)

    predictions = []
    for i in range(data.num_nodes):
        predictions.append({
            "student_id": student_ids[i],
            "clean_prob": round(float(probs[i, 0]), 4),
            "flagged_prob": round(float(probs[i, 1]), 4),
            "prediction": "flagged" if probs[i, 1] > 0.5 else "clean",
        })

    flagged_count = sum(1 for p in predictions if p["prediction"] == "flagged")

    return {
        "model_used": model_registry.active_name.value,
        "mode": settings.mode.value,
        "data_source": data_source,
        "num_students": data.num_nodes,
        "num_flagged": flagged_count,
        "num_clean": data.num_nodes - flagged_count,
        "predictions": predictions,
    }
