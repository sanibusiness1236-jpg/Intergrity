"""
File text-extraction endpoint
------------------------------
Accepts an uploaded file (PDF / DOCX / image) and returns the raw
extracted text, ready to be fed into the AI question extractor.
"""

import io
import os
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

router = APIRouter(tags=["AI Questions"])


class ExtractTextResponse(BaseModel):
    success: bool
    text: str
    chars: int


@router.post("/ai/extract-text", response_model=ExtractTextResponse)
async def extract_text(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()
    mime = file.content_type or ""

    text = ""

    # ── PDF ──────────────────────────────────────────────────────────────────
    if "pdf" in mime or filename.endswith(".pdf"):
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(stream=content, filetype="pdf")
            pages = [doc[i].get_text() for i in range(min(len(doc), 30))]
            text = "\n".join(pages)
        except ImportError:
            raise HTTPException(status_code=500, detail="PyMuPDF not installed on server")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"PDF extraction failed: {e}")

    # ── DOCX ─────────────────────────────────────────────────────────────────
    elif "word" in mime or filename.endswith(".docx") or filename.endswith(".doc"):
        try:
            from docx import Document
            doc = Document(io.BytesIO(content))
            text = "\n".join(p.text for p in doc.paragraphs)
        except ImportError:
            raise HTTPException(status_code=500, detail="python-docx not installed on server")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"DOCX extraction failed: {e}")

    # ── Image (OCR) ───────────────────────────────────────────────────────────
    elif any(x in mime for x in ("jpeg", "jpg", "png", "image")) or \
         any(filename.endswith(x) for x in (".jpg", ".jpeg", ".png")):
        try:
            from PIL import Image
            import pytesseract
            img = Image.open(io.BytesIO(content))
            text = pytesseract.image_to_string(img)
        except ImportError:
            raise HTTPException(status_code=500, detail="pytesseract / Pillow not installed on server")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"OCR failed: {e}")

    else:
        # Try plain UTF-8 decode as last resort
        try:
            text = content.decode("utf-8", errors="replace")
        except Exception:
            raise HTTPException(status_code=400, detail="Unsupported file type")

    text = text.strip()
    return ExtractTextResponse(success=True, text=text, chars=len(text))
