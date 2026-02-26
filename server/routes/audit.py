"""
Audit Log router — read and write audit logs for both channels.
Supports optional file upload (PDF / Word / Excel).
"""
from __future__ import annotations
import os
import json
import uuid
from pathlib import Path
from typing import Optional, List

from fastapi import APIRouter, Depends, Query, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import get_db
from models import (
    AuditLogQuotation, AuditLogWorkOrder,
    StageType, WorkingStatus,
)
from ws_manager import manager

router = APIRouter(prefix="/audit", tags=["audit"])

UPLOADS_PATH = os.getenv("UPLOADS_PATH", "/app/uploads")
ALLOWED_EXTENSIONS = {".pdf", ".doc", ".docx", ".xlsx"}


def _check_ext(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type '{ext}' not allowed. Use: pdf, doc, docx, xlsx")
    return ext


def _save_audit_file(original_name: str, data: bytes, channel: str, prefix: str = "") -> tuple[str, str, str]:
    """Save file, return (original_name, saved_path_url, extension_without_dot)."""
    ext  = _check_ext(original_name)
    subdir = "quotation" if channel == "Quotation" else "work_order"
    folder = Path(UPLOADS_PATH) / "audit" / subdir
    folder.mkdir(parents=True, exist_ok=True)
    unique_name = f"{prefix}{uuid.uuid4().hex}{ext}"
    (folder / unique_name).write_bytes(data)
    url = f"/audit/file/{subdir}/{unique_name}"
    return original_name, url, ext.lstrip(".")


# ── Quotation channel ────────────────────────────────────────────────────────

@router.get("/quotation")
def get_quotation_audit(
    quote_no:  Optional[str] = Query(None),
    list_id:   Optional[int] = Query(None),
    action:    Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLogQuotation).order_by(AuditLogQuotation.created_at.desc())
    if quote_no:
        q = q.filter(AuditLogQuotation.quote_no == quote_no)
    if list_id:
        q = q.filter(AuditLogQuotation.list_id == list_id)
    if action:
        q = q.filter(AuditLogQuotation.action == action)
    return [_qtn_log_to_dict(r) for r in q.limit(limit).all()]


def _qtn_log_to_dict(r: AuditLogQuotation) -> dict:
    return {
        "logId":           r.log_id,
        "quoteNo":         r.quote_no,
        "userId":          r.user_id,
        "listId":          r.list_id,
        "stage":           r.stage.value if r.stage else None,
        "assignment":      r.assignment,
        "working":         r.working.value if r.working else None,
        "remarks":         r.remarks,
        "tags":            r.tags or [],
        "approved":        r.approved,
        "terminated":      r.terminated,
        "remarksDepId":    r.remarks_dep_id,
        "remarksListId":   r.remarks_list_id,
        "uploadFileName":  r.upload_file_name,
        "uploadFilePath":  r.upload_file_path,
        "uploadFileType":  r.upload_file_type,
        "changeDetails":   r.change_details,
        "action":          r.action,
        "performedBy":     r.performed_by,
        "createdAt":       r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/quotation")
async def add_quotation_audit(
    action:         str            = Form(...),
    performed_by:   Optional[int]  = Form(None),
    quote_no:       Optional[str]  = Form(None),
    user_id:        Optional[int]  = Form(None),
    list_id:        Optional[int]  = Form(None),
    stage:          Optional[str]  = Form(None),
    assignment:     Optional[int]  = Form(None),
    working:        Optional[str]  = Form(None),
    remarks:        Optional[str]  = Form(None),
    tags:           Optional[str]  = Form(None),            # JSON array string
    approved:       bool           = Form(False),
    terminated:     bool           = Form(False),
    remarks_dep_id: Optional[int]  = Form(None),
    remarks_list_id:Optional[int]  = Form(None),
    change_details: Optional[str]  = Form(None),            # JSON string
    file:           Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    file_name = file_path = file_type = None
    if file and file.filename:
        data = await file.read()
        file_name, file_path, file_type = _save_audit_file(file.filename, data, "Quotation")

    log = AuditLogQuotation(
        action=action,
        performed_by=performed_by,
        quote_no=quote_no,
        user_id=user_id,
        list_id=list_id,
        stage=StageType(stage) if stage else None,
        assignment=assignment,
        working=WorkingStatus(working) if working else None,
        remarks=remarks,
        tags=json.loads(tags) if tags else None,
        approved=approved,
        terminated=terminated,
        remarks_dep_id=remarks_dep_id,
        remarks_list_id=remarks_list_id,
        upload_file_name=file_name,
        upload_file_path=file_path,
        upload_file_type=file_type,
        change_details=json.loads(change_details) if change_details else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    await manager.broadcast(json.dumps({"event": "audit_quotation", "action": action}))
    return _qtn_log_to_dict(log)


# ── Work Order channel ───────────────────────────────────────────────────────

@router.get("/work-order")
def get_work_order_audit(
    work_order_no:    Optional[str] = Query(None),
    order_details_id: Optional[int] = Query(None),
    action:           Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
):
    q = db.query(AuditLogWorkOrder).order_by(AuditLogWorkOrder.created_at.desc())
    if work_order_no:
        q = q.filter(AuditLogWorkOrder.work_order_no == work_order_no)
    if order_details_id:
        q = q.filter(AuditLogWorkOrder.order_details_id == order_details_id)
    if action:
        q = q.filter(AuditLogWorkOrder.action == action)
    return [_wo_log_to_dict(r) for r in q.limit(limit).all()]


def _wo_log_to_dict(r: AuditLogWorkOrder) -> dict:
    return {
        "logId":            r.log_id,
        "workOrderNo":      r.work_order_no,
        "userId":           r.user_id,
        "orderDetailsId":   r.order_details_id,
        "workOrderId":      r.work_order_id,
        "assignment":       r.assignment,
        "working":          r.working.value if r.working else None,
        "remarks":          r.remarks,
        "tags":             r.tags or [],
        "remarksDepId":     r.remarks_dep_id,
        "remarksListId":    r.remarks_list_id,
        "completed":        r.completed,
        "uploadWoFileName": r.upload_wo_file_name,
        "uploadWoFilePath": r.upload_wo_file_path,
        "uploadWoFileType": r.upload_wo_file_type,
        "uploadPoFileName": r.upload_po_file_name,
        "uploadPoFilePath": r.upload_po_file_path,
        "uploadPoFileType": r.upload_po_file_type,
        "changeDetails":    r.change_details,
        "action":           r.action,
        "performedBy":      r.performed_by,
        "createdAt":        r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/work-order")
async def add_work_order_audit(
    action:           str           = Form(...),
    performed_by:     Optional[int] = Form(None),
    work_order_no:    Optional[str] = Form(None),
    user_id:          Optional[int] = Form(None),
    order_details_id: Optional[int] = Form(None),
    work_order_id:    Optional[int] = Form(None),
    assignment:       Optional[int] = Form(None),
    working:          Optional[str] = Form(None),
    remarks:          Optional[str] = Form(None),
    tags:             Optional[str] = Form(None),           # JSON array string
    remarks_dep_id:   Optional[int] = Form(None),
    remarks_list_id:  Optional[int] = Form(None),
    completed:        bool          = Form(False),
    change_details:   Optional[str] = Form(None),           # JSON string
    file_wo:  Optional[UploadFile]  = File(None),           # Work Order document
    file_po:  Optional[UploadFile]  = File(None),           # Purchase Order document
    db: Session = Depends(get_db),
):
    wo_name = wo_path = wo_type = None
    po_name = po_path = po_type = None

    if file_wo and file_wo.filename:
        data = await file_wo.read()
        wo_name, wo_path, wo_type = _save_audit_file(file_wo.filename, data, "Work Order", prefix="wo_")

    if file_po and file_po.filename:
        data = await file_po.read()
        po_name, po_path, po_type = _save_audit_file(file_po.filename, data, "Work Order", prefix="po_")

    log = AuditLogWorkOrder(
        action=action,
        performed_by=performed_by,
        work_order_no=work_order_no,
        user_id=user_id,
        order_details_id=order_details_id,
        work_order_id=work_order_id,
        assignment=assignment,
        working=WorkingStatus(working) if working else None,
        remarks=remarks,
        tags=json.loads(tags) if tags else None,
        remarks_dep_id=remarks_dep_id,
        remarks_list_id=remarks_list_id,
        completed=completed,
        upload_wo_file_name=wo_name,
        upload_wo_file_path=wo_path,
        upload_wo_file_type=wo_type,
        upload_po_file_name=po_name,
        upload_po_file_path=po_path,
        upload_po_file_type=po_type,
        change_details=json.loads(change_details) if change_details else None,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    await manager.broadcast(json.dumps({"event": "audit_work_order", "action": action}))
    return _wo_log_to_dict(log)


# ── Serve audit files ────────────────────────────────────────────────────────

@router.get("/file/{channel_dir}/{filename}")
def serve_audit_file(channel_dir: str, filename: str):
    file_path = Path(UPLOADS_PATH) / "audit" / channel_dir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))
