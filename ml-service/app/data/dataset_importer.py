"""Parse imported CSV/JSON into venue payloads for GNN graphs."""

import csv
import io
import json
from typing import Any, Optional

FEATURE_KEYS = [
    "tab_switch_count",
    "paste_event_count",
    "window_blur_count",
    "usb_detected",
    "multi_device_login",
    "avg_answer_similarity",
    "time_per_question_std",
    "response_time_pattern",
    "ip_similarity_score",
]

# CSV column aliases → canonical field
_ALIASES: dict[str, str] = {
    "student_id": "student_id",
    "studentid": "student_id",
    "id": "student_id",
    "seat_x": "seat_x",
    "seatx": "seat_x",
    "seat_y": "seat_y",
    "seaty": "seat_y",
    "label": "label",
    "flagged": "label",
    "is_cheater": "label",
    "cheat": "label",
}


def _normalize_header(h: str) -> str:
    key = h.strip().lower().replace(" ", "_")
    return _ALIASES.get(key, key)


def _parse_label(raw: Any) -> Optional[int]:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool):
        return 1 if raw else 0
    if isinstance(raw, (int, float)):
        return 1 if int(raw) != 0 else 0
    s = str(raw).strip().lower()
    if s in ("1", "true", "yes", "flagged", "cheat", "cheater"):
        return 1
    if s in ("0", "false", "no", "clean", "honest"):
        return 0
    return None


def _coerce_float(val: Any, default: float = 0.0) -> float:
    if val is None or val == "":
        return default
    if isinstance(val, bool):
        return 1.0 if val else 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def row_to_student(row: dict[str, Any], index: int) -> dict[str, Any]:
    """Convert one normalized row into a student dict for graph_builder."""
    sid = row.get("student_id") or row.get("id") or f"student_{index + 1}"
    student: dict[str, Any] = {
        "student_id": str(sid),
        "seat_x": _coerce_float(row.get("seat_x"), (index % 10) * 0.1),
        "seat_y": _coerce_float(row.get("seat_y"), (index // 10) * 0.1),
    }
    for key in FEATURE_KEYS:
        if key in row:
            student[key] = _coerce_float(row[key], 0.0)
        else:
            student[key] = 0.0
    label = _parse_label(row.get("label"))
    if label is not None:
        student["label"] = label
    return student


def parse_json_payload(data: Any) -> tuple[list[dict[str, Any]], list[Optional[int]]]:
    """
    Accept:
      - { "students": [ {...}, ... ] }
      - [ {...}, ... ]
    """
    if isinstance(data, dict) and "students" in data:
        rows = data["students"]
    elif isinstance(data, list):
        rows = data
    else:
        raise ValueError("JSON must be an array of students or { students: [...] }")

    students = []
    labels: list[Optional[int]] = []
    for i, raw in enumerate(rows):
        if not isinstance(raw, dict):
            raise ValueError(f"Student at index {i} must be an object")
        norm = {_normalize_header(k): v for k, v in raw.items()}
        for fk in FEATURE_KEYS:
            if fk not in norm and fk.replace("_", "") in norm:
                pass
        st = row_to_student(norm, i)
        labels.append(st.pop("label", None))
        students.append(st)
    return students, labels


def parse_csv_text(text: str) -> tuple[list[dict[str, Any]], list[Optional[int]]]:
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")
    students = []
    labels: list[Optional[int]] = []
    for i, raw_row in enumerate(reader):
        norm = {_normalize_header(k): v for k, v in raw_row.items() if k}
        st = row_to_student(norm, i)
        labels.append(st.pop("label", None))
        students.append(st)
    if not students:
        raise ValueError("CSV contains no data rows")
    return students, labels


def build_venue_from_import(
    students: list[dict[str, Any]],
    dataset_id: str,
    name: str,
) -> dict[str, Any]:
    return {
        "venue_id": f"import-{dataset_id}",
        "exam_id": "",
        "name": name,
        "students": students,
    }
