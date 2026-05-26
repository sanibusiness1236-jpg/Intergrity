"""
AI Question Extraction & Regeneration
--------------------------------------
Accepts raw text (already extracted by the backend) and uses the
Hugging Face Inference API to:
  - extract structured exam questions from a passage of text
  - regenerate / vary existing questions

Heavy work is done here in the ML service so the main exam backend
and student sessions are never affected.
"""

import re
import json
import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/ai", tags=["AI Questions"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class ExtractionRequest(BaseModel):
    text: str                   # raw text extracted from uploaded file
    course_name: Optional[str] = ""
    default_marks: Optional[float] = 1.0

class RegenerateRequest(BaseModel):
    question_text: str
    question_type: Optional[str] = "mcq"
    options: Optional[list] = None
    mode: str = "similar"       # similar | harder | easier

class ExtractedQuestion(BaseModel):
    question_text: str
    question_type: str          # mcq | fill_in_blank | theory
    options: list = []
    answer: str = ""
    marks: float = 1.0

class ExtractionResponse(BaseModel):
    success: bool
    questions: list
    raw_count: int
    message: str = ""

class RegenerateResponse(BaseModel):
    success: bool
    question: dict
    message: str = ""

# ---------------------------------------------------------------------------
# HF Inference API helper
# ---------------------------------------------------------------------------

HF_API_URL = "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3"
HF_FALLBACK_URL = "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta"
HF_TOKEN = os.getenv("HF_TOKEN", "")

async def call_hf(prompt: str, max_new_tokens: int = 1024) -> str:
    """
    Call HF Inference API.  Falls back to a simple regex parser if
    the model is unavailable or the token is missing.
    """
    if not HF_TOKEN:
        return ""

    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": max_new_tokens,
            "temperature": 0.4,
            "return_full_text": False,
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        for url in [HF_API_URL, HF_FALLBACK_URL]:
            try:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list) and data:
                        return data[0].get("generated_text", "")
                    if isinstance(data, dict):
                        return data.get("generated_text", "")
            except Exception:
                continue
    return ""

# ---------------------------------------------------------------------------
# Rule-based fallback extractor (works without AI token)
# ---------------------------------------------------------------------------

def _detect_type(text: str, options: list) -> str:
    t = text.lower()
    if options:
        return "mcq"
    if any(k in t for k in ["true or false", "true/false", "t/f"]):
        return "true_false"
    if any(k in t for k in ["fill in", "fill-in", "_____", "......"]):
        return "fill_in_blank"
    return "theory"

def regex_extract(raw_text: str, default_marks: float) -> list:
    """
    Fallback: split by numbered question patterns (1. / 1) / Q1:).
    Returns a list of ExtractedQuestion dicts.
    """
    pattern = re.compile(
        r'(?:^|\n)\s*(?:Q(?:uestion)?\s*)?(\d+)[.):\s]+(.+?)(?=\n\s*(?:Q(?:uestion)?\s*)?\d+[.):\s]|\Z)',
        re.DOTALL | re.IGNORECASE,
    )
    matches = pattern.findall(raw_text)
    questions = []
    for _, body in matches:
        body = body.strip()
        if len(body) < 10:
            continue
        lines = [l.strip() for l in body.split("\n") if l.strip()]
        q_text = lines[0]
        options = []
        answer = ""
        for line in lines[1:]:
            # Option lines: A. / a) / (a) etc.
            m = re.match(r'^[A-Da-d][.)]\s*(.+)', line)
            if m:
                options.append(m.group(1))
            # Answer hint
            am = re.match(r'^(?:ans(?:wer)?|key)\s*[:\-]\s*(.+)', line, re.IGNORECASE)
            if am:
                answer = am.group(1)

        questions.append({
            "question_text": q_text,
            "question_type": _detect_type(q_text, options),
            "options": options,
            "answer": answer,
            "marks": default_marks,
        })
    return questions

def parse_ai_json(raw: str, default_marks: float) -> list:
    """Extract JSON array from model output (may be surrounded by prose)."""
    # Try to find a JSON array anywhere in the output
    m = re.search(r'\[.*\]', raw, re.DOTALL)
    if not m:
        return []
    try:
        items = json.loads(m.group())
        questions = []
        for item in items:
            if not isinstance(item, dict):
                continue
            qt = item.get("question_type", "theory").lower()
            if "mcq" in qt or "multiple" in qt:
                qt = "mcq"
            elif "fill" in qt:
                qt = "fill_in_blank"
            elif "true" in qt:
                qt = "true_false"
            else:
                qt = "theory"
            questions.append({
                "question_text": str(item.get("question_text", item.get("question", ""))).strip(),
                "question_type": qt,
                "options": item.get("options", []) or [],
                "answer": str(item.get("answer", item.get("correct_answer", ""))).strip(),
                "marks": float(item.get("marks", default_marks)),
            })
        return [q for q in questions if q["question_text"]]
    except Exception:
        return []

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/extract-questions", response_model=ExtractionResponse)
async def extract_questions(req: ExtractionRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text provided")
    if len(text) > 40_000:
        text = text[:40_000]     # safety cap — HF models have context limits

    questions = []

    # Try AI path first
    if HF_TOKEN:
        prompt = f"""<s>[INST]
You are an academic question extractor.

Extract ALL exam questions from the text below.
Return a valid JSON array only. No prose, no markdown.

Each element must have exactly these keys:
- "question_text": full question string
- "question_type": one of "mcq", "fill_in_blank", "true_false", "theory"
- "options": array of strings (MCQ choices only, else empty array [])
- "answer": correct answer string (or "" if unknown)
- "marks": numeric marks (default 1)

TEXT:
{text[:6000]}

Return ONLY the JSON array.
[/INST]"""
        raw = await call_hf(prompt, max_new_tokens=1500)
        if raw:
            questions = parse_ai_json(raw, req.default_marks)

    # Fallback to regex if AI produced nothing
    if not questions:
        questions = regex_extract(text, req.default_marks)

    if not questions:
        return ExtractionResponse(
            success=False,
            questions=[],
            raw_count=0,
            message="No questions could be extracted. Check that your file contains numbered questions.",
        )

    return ExtractionResponse(
        success=True,
        questions=questions,
        raw_count=len(questions),
        message=f"Extracted {len(questions)} question(s) successfully.",
    )


@router.post("/regenerate-question", response_model=RegenerateResponse)
async def regenerate_question(req: RegenerateRequest):
    mode_desc = {
        "similar":  "Create a different question on the same topic with similar difficulty.",
        "harder":   "Create a harder version of this question with more complex reasoning.",
        "easier":   "Create a simpler version of this question.",
    }.get(req.mode, "Create a similar question.")

    options_text = ""
    if req.options:
        options_text = "\nOptions were:\n" + "\n".join(f"  {chr(65+i)}. {o}" for i, o in enumerate(req.options))

    if HF_TOKEN:
        prompt = f"""<s>[INST]
You are an academic exam question generator.

Original question ({req.question_type}):
{req.question_text}{options_text}

Task: {mode_desc}

Return a single JSON object with:
- "question_text": new question string
- "question_type": "{req.question_type}"
- "options": array of 4 choices if MCQ else []
- "answer": correct answer string
- "marks": 1

Return ONLY the JSON object.
[/INST]"""
        raw = await call_hf(prompt, max_new_tokens=512)
        if raw:
            m = re.search(r'\{.*\}', raw, re.DOTALL)
            if m:
                try:
                    obj = json.loads(m.group())
                    qt = obj.get("question_type", req.question_type).lower()
                    if "mcq" in qt or "multiple" in qt:
                        qt = "mcq"
                    elif "fill" in qt:
                        qt = "fill_in_blank"
                    elif "true" in qt:
                        qt = "true_false"
                    else:
                        qt = "theory"
                    return RegenerateResponse(
                        success=True,
                        question={
                            "question_text": str(obj.get("question_text", "")).strip(),
                            "question_type": qt,
                            "options": obj.get("options", []) or [],
                            "answer": str(obj.get("answer", "")).strip(),
                            "marks": float(obj.get("marks", 1)),
                        },
                    )
                except Exception:
                    pass

    # Fallback: return a placeholder so the UI can still show something
    suffix = {"similar": " (variation)", "harder": " (harder)", "easier": " (simplified)"}.get(req.mode, "")
    return RegenerateResponse(
        success=True,
        question={
            "question_text": req.question_text + suffix,
            "question_type": req.question_type,
            "options": req.options or [],
            "answer": "",
            "marks": 1.0,
        },
        message="AI unavailable — placeholder generated. Add HF_TOKEN for full AI regeneration.",
    )
