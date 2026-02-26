"""
Cards router — CRUD for both Quotation and Work Order channel cards.
All mutations broadcast a WebSocket event so the frontend gets live updates.
Uses integer FK model: list_id, channel_id, assigned_to (user_id).
"""
from __future__ import annotations
import json
from datetime import date as date_type, datetime, timezone
from typing import Any, Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Card, Channel, List as ListModel, Remark, ListHistory,
    WorkOrderDetails, OrderConfirmationDetails,
    AuditLogQuotation, AuditLogWorkOrder,
    User, WorkingStatus, StageType,
)
from ws_manager import manager

router = APIRouter(prefix="/cards", tags=["cards"])


# ── Pydantic schemas ────────────────────────────────────────────────────────

class RemarkIn(BaseModel):
    id: str
    list_name: str
    type: str                                      # StageType value
    tags: List[str] = []
    description: Optional[str] = None
    created_by_username: Optional[str] = None
    visible_dep_ids: Optional[List[int]] = None


class ListHistoryIn(BaseModel):
    list_name: str
    entered_at: Optional[str] = None


class CardIn(BaseModel):
    id: Optional[str] = None
    quote_number: Optional[str] = None
    revision_number: Optional[int] = None
    work_order_number: Optional[str] = None
    company_code: Optional[str] = None
    date: str                                      # yyyy-MM-dd string
    sales_person: Optional[str] = None
    subject: Optional[str] = None
    project_location: Optional[str] = None
    list_name: str                                 # human-readable, resolved → list_id
    channel_name: str                              # human-readable, resolved → channel_id
    approved: bool = False
    terminated: bool = False
    assigned_to_username: Optional[str] = None    # resolved → user_id
    user_work_status: Optional[str] = None        # WorkingStatus value
    completed_at: Optional[str] = None
    purchase_order_doc_name: Optional[str] = None
    purchase_order_doc_url: Optional[str] = None
    quotation_doc_name: Optional[str] = None
    quotation_doc_url: Optional[str] = None
    completion_doc_name: Optional[str] = None
    completion_doc_url: Optional[str] = None
    remarks: List[RemarkIn] = []
    list_history: List[ListHistoryIn] = []


# ── Lookup helpers ───────────────────────────────────────────────────────────

def _resolve_channel(db: Session, channel_name: str) -> Channel:
    ch = db.query(Channel).filter(Channel.channel_name == channel_name).first()
    if not ch:
        raise HTTPException(status_code=400, detail=f"Channel '{channel_name}' not found")
    return ch


def _resolve_list(db: Session, list_name: str, channel_id: int) -> ListModel:
    lst = db.query(ListModel).filter(
        ListModel.list_name == list_name, ListModel.channel_id == channel_id
    ).first()
    if not lst:
        raise HTTPException(status_code=400, detail=f"List '{list_name}' not found in channel {channel_id}")
    return lst


def _resolve_user_id(db: Session, username: Optional[str]) -> Optional[int]:
    if not username:
        return None
    u = db.query(User).filter(User.username == username, User.is_deleted == False).first()
    return u.user_id if u else None


# ── Output helpers ───────────────────────────────────────────────────────────

def _card_to_dict(card: Card) -> dict:
    return {
        "id":                   card.id,
        "quoteNumber":          card.quote_number,
        "revisionNumber":       card.revision_number,
        "workOrderNumber":      card.work_order_number,
        "companyCode":          card.company_code,
        "date":                 card.date.isoformat() if isinstance(card.date, date_type) else card.date,
        "salesPerson":          card.sales_person,
        "subject":              card.subject,
        "projectLocation":      card.project_location,
        "listId":               card.list_id,
        "listName":             card.list_rel.list_name if card.list_rel else None,
        "channelId":            card.channel_id,
        "channelName":          card.channel_rel.channel_name if card.channel_rel else None,
        "approved":             card.approved,
        "terminated":           card.terminated,
        "assignedTo":           card.assigned_to,
        "assignedToUsername":   card.assigned_user.username if card.assigned_user else None,
        "userWorkStatus":       card.user_work_status.value if card.user_work_status else None,
        "completedAt":          card.completed_at.isoformat() if card.completed_at else None,
        "purchaseOrderDocName": card.purchase_order_doc_name,
        "purchaseOrderDocUrl":  card.purchase_order_doc_url,
        "quotationDocName":     card.quotation_doc_name,
        "quotationDocUrl":      card.quotation_doc_url,
        "completionDocName":    card.completion_doc_name,
        "completionDocUrl":     card.completion_doc_url,
        "createdAt":            card.created_at.isoformat() if card.created_at else None,
        "updatedAt":            card.updated_at.isoformat() if card.updated_at else None,
        "remarks": [
            {
                "id":            r.id,
                "listId":        r.list_id,
                "listName":      r.list_rel.list_name if r.list_rel else None,
                "type":          r.type.value if r.type else None,
                "tags":          r.tags or [],
                "description":   r.description,
                "createdBy":     r.created_by,
                "createdByUsername": r.author.username if r.author else (r.created_by_name or None),
                "visibleDepIds": r.visible_dep_ids,
                "createdAt":     r.created_at.isoformat() if r.created_at else None,
                "updatedAt":     r.updated_at.isoformat() if r.updated_at else None,
            }
            for r in (card.remarks or [])
        ],
        "listHistory": [
            {
                "listId":    h.list_id,
                "listName":  h.list_rel.list_name if h.list_rel else None,
                "enteredAt": h.entered_at.isoformat() if h.entered_at else None,
            }
            for h in (card.list_history or [])
        ],
    }


def _write_audit(db: Session, channel_name: str, action: str, performed_by_id: Optional[int],
                 card_id: str, details: Any = None):
    if channel_name == "Work Order":
        log = AuditLogWorkOrder(
            action=action, performed_by=performed_by_id,
            change_details=details,
        )
    else:
        log = AuditLogQuotation(
            action=action, performed_by=performed_by_id,
            change_details=details,
        )
    db.add(log)


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/{channel_name}")
def list_cards(channel_name: str, db: Session = Depends(get_db)):
    """Return all cards for a given channel by name: 'Quotation' or 'Work Order'."""
    ch = db.query(Channel).filter(Channel.channel_name == channel_name).first()
    if not ch:
        return []
    cards = db.query(Card).filter(Card.channel_id == ch.channel_id).all()
    return [_card_to_dict(c) for c in cards]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_card(card_in: CardIn, performed_by: Optional[int] = None, db: Session = Depends(get_db)):
    ch   = _resolve_channel(db, card_in.channel_name)
    lst  = _resolve_list(db, card_in.list_name, ch.channel_id)
    uid  = _resolve_user_id(db, card_in.assigned_to_username)
    status_val = WorkingStatus(card_in.user_work_status) if card_in.user_work_status else None

    try:
        card_date = date_type.fromisoformat(card_in.date)
    except ValueError:
        card_date = None

    card = Card(
        id=card_in.id or f"{int(datetime.now(timezone.utc).timestamp() * 1000)}",
        quote_number=card_in.quote_number,
        revision_number=card_in.revision_number,
        work_order_number=card_in.work_order_number,
        company_code=card_in.company_code,
        date=card_date,
        sales_person=card_in.sales_person,
        subject=card_in.subject,
        project_location=card_in.project_location,
        list_id=lst.list_id,
        channel_id=ch.channel_id,
        approved=card_in.approved,
        terminated=card_in.terminated,
        assigned_to=uid,
        user_work_status=status_val,
        purchase_order_doc_name=card_in.purchase_order_doc_name,
        purchase_order_doc_url=card_in.purchase_order_doc_url,
        quotation_doc_name=card_in.quotation_doc_name,
        quotation_doc_url=card_in.quotation_doc_url,
        completion_doc_name=card_in.completion_doc_name,
        completion_doc_url=card_in.completion_doc_url,
    )
    db.add(card)
    db.flush()  # get card.id without full commit

    for r in card_in.remarks:
        r_list = _resolve_list(db, r.list_name, ch.channel_id)
        r_uid  = _resolve_user_id(db, r.created_by_username)
        db.add(Remark(
            id=r.id, card_id=card.id, list_id=r_list.list_id,
            type=StageType(r.type), tags=r.tags or None,
            description=r.description, created_by=r_uid,
            created_by_name=r.created_by_username if r_uid is None else None,
            visible_dep_ids=r.visible_dep_ids or None,
        ))

    for h in card_in.list_history:
        h_list = _resolve_list(db, h.list_name, ch.channel_id)
        h_entered_at = None
        if h.entered_at:
            try:
                h_entered_at = datetime.fromisoformat(h.entered_at.rstrip('Z'))
            except (ValueError, TypeError):
                pass
        db.add(ListHistory(card_id=card.id, list_id=h_list.list_id, entered_at=h_entered_at))

    _write_audit(db, card_in.channel_name, "card_created", performed_by, card.id)
    db.commit()
    db.refresh(card)
    result = _card_to_dict(card)
    await manager.broadcast(json.dumps({"event": "card_created", "channelName": card_in.channel_name, "card": result}))
    return result


@router.put("/{card_id}")
async def update_card(card_id: str, card_in: CardIn, performed_by: Optional[int] = None,
                      db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()

    ch         = _resolve_channel(db, card_in.channel_name)
    lst        = _resolve_list(db, card_in.list_name, ch.channel_id)
    uid        = _resolve_user_id(db, card_in.assigned_to_username)
    status_val = WorkingStatus(card_in.user_work_status) if card_in.user_work_status else None

    try:
        card_date = date_type.fromisoformat(card_in.date)
    except (ValueError, TypeError):
        card_date = None

    is_new = card is None
    if is_new:
        # Card doesn't exist in DB yet (e.g. client-side optimistic create failed) — insert it
        card = Card(id=card_id)
        db.add(card)

    card.quote_number            = card_in.quote_number
    card.revision_number         = card_in.revision_number
    card.work_order_number       = card_in.work_order_number
    card.company_code            = card_in.company_code
    card.date                    = card_date
    card.sales_person            = card_in.sales_person
    card.subject                 = card_in.subject
    card.project_location        = card_in.project_location
    card.list_id                 = lst.list_id
    card.channel_id              = ch.channel_id
    card.approved                = card_in.approved
    card.terminated              = card_in.terminated
    card.assigned_to             = uid
    card.user_work_status        = status_val
    card.purchase_order_doc_name = card_in.purchase_order_doc_name
    card.purchase_order_doc_url  = card_in.purchase_order_doc_url
    card.quotation_doc_name      = card_in.quotation_doc_name
    card.quotation_doc_url       = card_in.quotation_doc_url
    card.completion_doc_name     = card_in.completion_doc_name
    card.completion_doc_url      = card_in.completion_doc_url

    if card_in.completed_at:
        try:
            card.completed_at = datetime.fromisoformat(card_in.completed_at.rstrip("Z"))
        except (ValueError, TypeError):
            pass

    if is_new:
        db.flush()
        for r in card_in.remarks:
            r_list = _resolve_list(db, r.list_name, ch.channel_id)
            r_uid  = _resolve_user_id(db, r.created_by_username)
            db.add(Remark(
                id=r.id, card_id=card.id, list_id=r_list.list_id,
                type=StageType(r.type), tags=r.tags or None,
                description=r.description, created_by=r_uid,
                created_by_name=r.created_by_username if r_uid is None else None,
                visible_dep_ids=r.visible_dep_ids or None,
            ))
        for h in card_in.list_history:
            h_list = _resolve_list(db, h.list_name, ch.channel_id)
            h_entered_at = None
            if h.entered_at:
                try:
                    h_entered_at = datetime.fromisoformat(h.entered_at.rstrip('Z'))
                except (ValueError, TypeError):
                    pass
            db.add(ListHistory(card_id=card.id, list_id=h_list.list_id, entered_at=h_entered_at))
    else:
        # Sync list_history: delete all existing, re-insert from incoming (preserving entered_at)
        db.query(ListHistory).filter(ListHistory.card_id == card.id).delete(synchronize_session=False)
        for h in card_in.list_history:
            h_list = _resolve_list(db, h.list_name, ch.channel_id)
            h_entered_at = None
            if h.entered_at:
                try:
                    h_entered_at = datetime.fromisoformat(h.entered_at.rstrip('Z'))
                except (ValueError, TypeError):
                    pass
            db.add(ListHistory(card_id=card.id, list_id=h_list.list_id, entered_at=h_entered_at))

        # Sync remarks: upsert incoming, delete removed
        incoming_ids = {r.id for r in card_in.remarks}
        existing_remarks = {r.id: r for r in db.query(Remark).filter(Remark.card_id == card.id).all()}

        # Delete remarks that were removed on the client
        for rid, remark_obj in existing_remarks.items():
            if rid not in incoming_ids:
                db.delete(remark_obj)

        # Insert new / update existing
        for r in card_in.remarks:
            r_list = _resolve_list(db, r.list_name, ch.channel_id)
            r_uid  = _resolve_user_id(db, r.created_by_username)
            if r.id in existing_remarks:
                existing = existing_remarks[r.id]
                existing.list_id         = r_list.list_id
                existing.type            = StageType(r.type)
                existing.tags            = r.tags or None
                existing.description     = r.description
                existing.created_by      = r_uid
                existing.created_by_name = r.created_by_username if r_uid is None else None
                existing.visible_dep_ids = r.visible_dep_ids or None
            else:
                db.add(Remark(
                    id=r.id, card_id=card.id, list_id=r_list.list_id,
                    type=StageType(r.type), tags=r.tags or None,
                    description=r.description, created_by=r_uid,
                    created_by_name=r.created_by_username if r_uid is None else None,
                    visible_dep_ids=r.visible_dep_ids or None,
                ))

    _write_audit(db, card_in.channel_name,
                 "card_created" if is_new else "card_updated",
                 performed_by, card.id)
    db.commit()
    db.refresh(card)
    result = _card_to_dict(card)
    event  = "card_created" if is_new else "card_updated"
    await manager.broadcast(json.dumps({"event": event, "channelName": card_in.channel_name, "card": result}))
    return result


@router.delete("/{card_id}", status_code=status.HTTP_200_OK)
async def delete_card(card_id: str, performed_by: Optional[int] = None, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    channel_name = card.channel_rel.channel_name if card.channel_rel else "Quotation"
    _write_audit(db, channel_name, "card_deleted", performed_by, card_id)
    db.delete(card)
    db.commit()
    await manager.broadcast(json.dumps({"event": "card_deleted", "cardId": card_id}))
    return {"detail": "Card deleted"}


@router.get("/{card_id}/detail")
def get_card(card_id: str, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return _card_to_dict(card)
