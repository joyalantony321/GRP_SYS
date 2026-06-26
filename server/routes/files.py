"""
Files router — upload and serve PO, Quotation, Completion documents.
Files are stored on the server filesystem under /app/uploads/.
After upload the URL is saved on the card and a WebSocket event is broadcast.
"""
from __future__ import annotations
import os
import json
import uuid
from pathlib import Path

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import Card, Channel, AuditLogQuotation, AuditLogWorkOrder, User
from ws_manager import manager

router = APIRouter(prefix="/files", tags=["files"])

UPLOADS_PATH = os.getenv("UPLOADS_PATH", "/app/uploads")
DOC_TYPES = {
    "po":         ("po_docs",         "purchase_order_doc_name",  "purchase_order_doc_url"),
    "qtn":        ("qtn_docs",        "quotation_doc_name",       "quotation_doc_url"),
    "completion": ("completion_docs", "completion_doc_name",      "completion_doc_url"),
}

ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xlsx", ".jpg", ".jpeg", ".png"}


def _validated_performed_by(db: Session, performed_by: Optional[int]) -> Optional[int]:
    """Return a valid, non-deleted user_id for audit logs, else None."""
    if performed_by is None:
        return None
    exists = db.query(User.user_id).filter(User.user_id == performed_by, User.is_deleted == False).first()
    return performed_by if exists else None


def _save_file(doc_type: str, original_name: str, data: bytes) -> tuple[str, str, str]:
    """Save bytes to disk. Returns (saved_filename, url_path, ext_without_dot)."""
    ext = Path(original_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed")

    subdir, _, _ = DOC_TYPES[doc_type]
    folder = Path(UPLOADS_PATH) / subdir
    folder.mkdir(parents=True, exist_ok=True)

    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = folder / unique_name
    file_path.write_bytes(data)

    url = f"/files/serve/{doc_type}/{unique_name}"
    return original_name, url, ext.lstrip(".")


@router.post("/upload/{card_id}/{doc_type}")
async def upload_doc(
    card_id: str,
    doc_type: str,
    file: UploadFile = File(...),
    performed_by: Optional[int] = None,
    db: Session = Depends(get_db),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown doc_type '{doc_type}'. Use: po, qtn, completion")

    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    safe_performed_by = _validated_performed_by(db, performed_by)

    data = await file.read()
    saved_name, url, file_type = _save_file(doc_type, file.filename or "document", data)

    _, name_col, url_col = DOC_TYPES[doc_type]
    setattr(card, name_col, saved_name)
    setattr(card, url_col, url)

    # Resolve channel name from FK
    channel_obj  = db.query(Channel).filter(Channel.channel_id == card.channel_id).first()
    channel_name = channel_obj.channel_name if channel_obj else "Quotation"

    action = f"{doc_type}_doc_uploaded"
    if channel_name == "Work Order":
        db.add(AuditLogWorkOrder(
            action=action,
            performed_by=safe_performed_by,
            upload_wo_file_name=saved_name,
            upload_wo_file_path=url,
            upload_wo_file_type=file_type,
        ))
    else:
        db.add(AuditLogQuotation(
            action=action,
            performed_by=safe_performed_by,
            upload_file_name=saved_name,
            upload_file_path=url,
            upload_file_type=file_type,
        ))

    db.commit()
    db.refresh(card)

    await manager.broadcast(json.dumps({
        "event":       "doc_uploaded",
        "channelName": channel_name,
        "cardId":      card_id,
        "docType":     doc_type,
        "fileName":    saved_name,
        "url":         url,
    }))
    return {"fileName": saved_name, "url": url}


MEDIA_TYPES: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".doc":  "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@router.get("/serve/{doc_type}/{filename}")
def serve_file(doc_type: str, filename: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown doc type")
    subdir, _, _ = DOC_TYPES[doc_type]
    file_path = Path(UPLOADS_PATH) / subdir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    ext = file_path.suffix.lower()
    media_type = MEDIA_TYPES.get(ext, "application/octet-stream")
    # inline so PDFs open directly in the browser tab; Word/Excel prompt the OS
    return FileResponse(
        str(file_path),
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename=\"{file_path.name}\""},
    )


@router.delete("/{card_id}/{doc_type}")
async def delete_doc(
    card_id: str,
    doc_type: str,
    performed_by: Optional[int] = None,
    db: Session = Depends(get_db),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Unknown doc_type '{doc_type}'")
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    safe_performed_by = _validated_performed_by(db, performed_by)

    subdir, name_col, url_col = DOC_TYPES[doc_type]
    current_url: Optional[str] = getattr(card, url_col)
    if current_url:
        # Extract saved filename and delete from disk
        saved_filename = current_url.rstrip("/").split("/")[-1]
        file_path = Path(UPLOADS_PATH) / subdir / saved_filename
        if file_path.exists():
            try:
                file_path.unlink()
            except OSError:
                pass  # Non-fatal — DB record is cleared regardless

    setattr(card, name_col, None)
    setattr(card, url_col, None)

    channel_obj  = db.query(Channel).filter(Channel.channel_id == card.channel_id).first()
    channel_name = channel_obj.channel_name if channel_obj else "Quotation"

    action = f"{doc_type}_doc_deleted"
    if channel_name == "Work Order":
        db.add(AuditLogWorkOrder(action=action, performed_by=safe_performed_by))
    else:
        db.add(AuditLogQuotation(action=action, performed_by=safe_performed_by))

    db.commit()
    db.refresh(card)

    await manager.broadcast(json.dumps({
        "event":       "doc_deleted",
        "channelName": channel_name,
        "cardId":      card_id,
        "docType":     doc_type,
    }))
    return {"ok": True}
