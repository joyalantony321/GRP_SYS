"""
Cards router — CRUD for both Quotation and Work Order channel cards.
All mutations broadcast a WebSocket event so the frontend gets live updates.
Uses integer FK model: list_id, channel_id, assigned_to (user_id).
"""
from __future__ import annotations
import json
from datetime import date as date_type, datetime, timezone
from typing import Any, Optional, List
from uuid import uuid4

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


WORK_ORDER_LIST_ALIASES = {
    "Accounts": "Approval",
}


def _normalize_list_name(list_name: str, channel_name: Optional[str] = None) -> str:
    if channel_name == "Work Order":
        return WORK_ORDER_LIST_ALIASES.get(list_name, list_name)
    return list_name


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


class OrderConfirmationIn(BaseModel):
    lpo_no: Optional[str] = None
    qtn_no: Optional[str] = None
    date: Optional[str] = None
    tank_brand_size_type_value: Optional[str] = None
    payment_terms_confirmed: Optional[str] = None
    other_terms_condition: Optional[str] = None
    penalty_conditions_note: Optional[str] = None
    advance_percent: Optional[str] = None
    advance_cdc: bool = False
    advance_pdc: bool = False
    payment_collection_from_site: bool = False
    payment_collection_from_office: bool = False
    delivery_percent: Optional[str] = None
    delivery_cdc: bool = False
    delivery_pdc: bool = False
    delivery_before: bool = False
    delivery_after: bool = False
    security_cheque_required: Optional[str] = None
    when_recollect: Optional[str] = None
    work_in_progress_percent: Optional[str] = None
    completion_amount: Optional[str] = None
    completion_cdc: bool = False
    completion_pdc: bool = False
    testing_commissioning_amount: Optional[str] = None
    testing_commissioning_cdc: bool = False
    testing_commissioning_pdc: bool = False
    retention_amount: Optional[str] = None
    retention_cdc: bool = False
    retention_pdc: bool = False
    other_committed_terms: Optional[str] = None
    accounts_name: Optional[str] = None
    accounts_email: Optional[str] = None
    accounts_tel_mob: Optional[str] = None
    invoice_submission_office: bool = False
    invoice_submission_site: bool = False
    warranty_manual_submission_time: Optional[str] = None
    project_name: Optional[str] = None
    project_email: Optional[str] = None
    project_tel_mob: Optional[str] = None
    sales_executive_name: Optional[str] = None
    manager_name: Optional[str] = None


class CardIn(BaseModel):
    id: Optional[str] = None
    quote_number: Optional[str] = None
    revision_number: Optional[int] = None
    work_order_number: Optional[str] = None
    company_code: Optional[str] = None
    customer_name: Optional[str] = None
    customer_company_name: Optional[str] = None
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
    payment_percent: Optional[int] = 0
    completed_at: Optional[str] = None
    assignment_history: Optional[list] = None
    purchase_order_doc_name: Optional[str] = None
    purchase_order_doc_url: Optional[str] = None
    quotation_doc_name: Optional[str] = None
    quotation_doc_url: Optional[str] = None
    completion_doc_name: Optional[str] = None
    completion_doc_url: Optional[str] = None
    remarks: List[RemarkIn] = []
    list_history: List[ListHistoryIn] = []
    order_confirmation_details: Optional[OrderConfirmationIn] = None


# ── Lookup helpers ───────────────────────────────────────────────────────────

def _resolve_channel(db: Session, channel_name: str) -> Channel:
    ch = db.query(Channel).filter(Channel.channel_name == channel_name).first()
    if not ch:
        raise HTTPException(status_code=400, detail=f"Channel '{channel_name}' not found")
    return ch


def _resolve_list(db: Session, list_name: str, channel_id: int) -> ListModel:
    channel = db.query(Channel).filter(Channel.channel_id == channel_id).first()
    normalized_name = _normalize_list_name(list_name, channel.channel_name if channel else None)
    lst = db.query(ListModel).filter(
        ListModel.list_name == normalized_name, ListModel.channel_id == channel_id
    ).first()
    if not lst and channel and channel.channel_name == "Work Order":
        lst = ListModel(list_name=normalized_name, channel_id=channel_id)
        db.add(lst)
        db.flush()
    if not lst:
        raise HTTPException(status_code=400, detail=f"List '{normalized_name}' not found in channel {channel_id}")
    return lst


def _resolve_user_id(db: Session, username: Optional[str]) -> Optional[int]:
    if not username:
        return None
    u = db.query(User).filter(User.username == username, User.is_deleted == False).first()
    return u.user_id if u else None


def _clamp_payment_percent(v: Optional[int]) -> int:
    try:
        n = int(v if v is not None else 0)
    except (ValueError, TypeError):
        n = 0
    return max(0, min(100, n))


def _unique_remark_id(db: Session, proposed_id: str) -> str:
    rid = proposed_id
    while db.query(Remark).filter(Remark.id == rid).first() is not None:
        rid = f"{proposed_id}-{uuid4().hex[:8]}"
    return rid


# ── Output helpers ───────────────────────────────────────────────────────────

def _oc_to_dict(oc: Optional[OrderConfirmationDetails]) -> Optional[dict]:
    if not oc:
        return None
    return {
        "lpoNo":                        oc.lpo_no,
        "qtnNo":                        oc.qtn_no,
        "date":                         oc.date.isoformat() if oc.date else None,
        "tankBrandSizeTypeValue":        oc.tank_brand_size_type_value,
        "paymentTermsConfirmed":         oc.payment_terms_confirmed,
        "otherTermsCondition":           oc.other_terms_condition,
        "penaltyConditionsNote":         oc.penalty_conditions_note,
        "advancePercent":                oc.advance_percent,
        "advanceCDC":                    oc.advance_cdc,
        "advancePDC":                    oc.advance_pdc,
        "paymentCollectionFromSite":     oc.payment_collection_from_site,
        "paymentCollectionFromOffice":   oc.payment_collection_from_office,
        "deliveryPercent":               oc.delivery_percent,
        "deliveryCDC":                   oc.delivery_cdc,
        "deliveryPDC":                   oc.delivery_pdc,
        "deliveryBefore":                oc.delivery_before,
        "deliveryAfter":                 oc.delivery_after,
        "securityChequeRequired":        oc.security_cheque_required,
        "whenRecollect":                 oc.when_recollect,
        "workInProgressPercent":         oc.work_in_progress_percent,
        "completionAmount":              oc.completion_amount,
        "completionCDC":                 oc.completion_cdc,
        "completionPDC":                 oc.completion_pdc,
        "testingCommissioningAmount":    oc.testing_commissioning_amount,
        "testingCommissioningCDC":       oc.testing_commissioning_cdc,
        "testingCommissioningPDC":       oc.testing_commissioning_pdc,
        "retentionAmount":               oc.retention_amount,
        "retentionCDC":                  oc.retention_cdc,
        "retentionPDC":                  oc.retention_pdc,
        "otherCommittedTerms":           oc.other_committed_terms,
        "accountsName":                  oc.accounts_name,
        "accountsEmail":                 oc.accounts_email,
        "accountsTelMob":                oc.accounts_tel_mob,
        "invoiceSubmissionOffice":       oc.invoice_submission_office,
        "invoiceSubmissionSite":         oc.invoice_submission_site,
        "warrantyManualSubmissionTime":  oc.warranty_manual_submission_time,
        "projectName":                   oc.project_name,
        "projectEmail":                  oc.project_email,
        "projectTelMob":                 oc.project_tel_mob,
        "salesExecutiveName":            oc.sales_executive_name,
        "managerName":                   oc.manager_name,
    }

def _card_to_dict(card: Card) -> dict:
    channel_name = card.channel_rel.channel_name if card.channel_rel else None
    return {
        "id":                   card.id,
        "quoteNumber":          card.quote_number,
        "revisionNumber":       card.revision_number,
        "workOrderNumber":      card.work_order_number,
        "companyCode":          card.company_code,
        "customerName":         card.customer_name,
        "customerCompanyName":  card.customer_company_name,
        "date":                 card.date.isoformat() if isinstance(card.date, date_type) else card.date,
        "salesPerson":          card.sales_person,
        "subject":              card.subject,
        "projectLocation":      card.project_location,
        "listId":               card.list_id,
        "listName":             _normalize_list_name(card.list_rel.list_name, channel_name) if card.list_rel else None,
        "channelId":            card.channel_id,
        "channelName":          card.channel_rel.channel_name if card.channel_rel else None,
        "approved":             card.approved,
        "terminated":           card.terminated,
        "assignedTo":           card.assigned_to,
        "assignedToUsername":   card.assigned_to_name or (card.assigned_user.username if card.assigned_user else None),
        "userWorkStatus":       card.user_work_status.value if card.user_work_status else None,
        "paymentPercent":       card.payment_percent or 0,
        "assignmentHistory":    card.assignment_history or [],
        "completedAt":          card.completed_at.isoformat() if card.completed_at else None,
        "purchaseOrderDocName": card.purchase_order_doc_name,
        "purchaseOrderDocUrl":  card.purchase_order_doc_url,
        "quotationDocName":     card.quotation_doc_name,
        "quotationDocUrl":      card.quotation_doc_url,
        "completionDocName":    card.completion_doc_name,
        "completionDocUrl":     card.completion_doc_url,
        "createdAt":            card.created_at.isoformat() if card.created_at else None,
        "updatedAt":            card.updated_at.isoformat() if card.updated_at else None,
        "orderConfirmationDetails": _oc_to_dict(card.order_confirmation),
        "remarks": [
            {
                "id":            r.id,
                "listId":        r.list_id,
                "listName":      _normalize_list_name(r.list_rel.list_name, channel_name) if r.list_rel else None,
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
                "listName":  _normalize_list_name(h.list_rel.list_name, channel_name) if h.list_rel else None,
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
        customer_name=card_in.customer_name,
        customer_company_name=card_in.customer_company_name,
        date=card_date,
        sales_person=card_in.sales_person,
        subject=card_in.subject,
        project_location=card_in.project_location,
        list_id=lst.list_id,
        channel_id=ch.channel_id,
        approved=card_in.approved,
        terminated=card_in.terminated,
        assigned_to=uid,
        assigned_to_name=card_in.assigned_to_username or None,
        user_work_status=status_val,
        payment_percent=_clamp_payment_percent(card_in.payment_percent),
        assignment_history=card_in.assignment_history or [],
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
        rid = _unique_remark_id(db, r.id)
        db.add(Remark(
            id=rid, card_id=card.id, list_id=r_list.list_id,
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
    card.customer_name           = card_in.customer_name
    card.customer_company_name   = card_in.customer_company_name
    card.date                    = card_date
    card.sales_person            = card_in.sales_person
    card.subject                 = card_in.subject
    card.project_location        = card_in.project_location
    card.list_id                 = lst.list_id
    card.channel_id              = ch.channel_id
    card.approved                = card_in.approved
    card.terminated              = card_in.terminated
    card.assigned_to             = uid
    card.assigned_to_name        = card_in.assigned_to_username or None
    card.user_work_status        = status_val
    card.payment_percent         = _clamp_payment_percent(card_in.payment_percent)
    card.assignment_history      = card_in.assignment_history if card_in.assignment_history is not None else (card.assignment_history or [])
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
            rid = _unique_remark_id(db, r.id)
            db.add(Remark(
                id=rid, card_id=card.id, list_id=r_list.list_id,
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
                rid = _unique_remark_id(db, r.id)
                db.add(Remark(
                    id=rid, card_id=card.id, list_id=r_list.list_id,
                    type=StageType(r.type), tags=r.tags or None,
                    description=r.description, created_by=r_uid,
                    created_by_name=r.created_by_username if r_uid is None else None,
                    visible_dep_ids=r.visible_dep_ids or None,
                ))

    # ── Order Confirmation Details: upsert ───────────────────────────────────
    oc_in = card_in.order_confirmation_details
    if oc_in is not None:
        oc_date = None
        if oc_in.date:
            try:
                oc_date = date_type.fromisoformat(oc_in.date)
            except (ValueError, TypeError):
                pass
        existing_oc = db.query(OrderConfirmationDetails).filter_by(card_id=card.id).first()
        if existing_oc:
            existing_oc.lpo_no                          = oc_in.lpo_no
            existing_oc.qtn_no                          = oc_in.qtn_no
            existing_oc.date                            = oc_date
            existing_oc.tank_brand_size_type_value      = oc_in.tank_brand_size_type_value
            existing_oc.payment_terms_confirmed         = oc_in.payment_terms_confirmed
            existing_oc.other_terms_condition           = oc_in.other_terms_condition
            existing_oc.penalty_conditions_note         = oc_in.penalty_conditions_note
            existing_oc.advance_percent                 = oc_in.advance_percent
            existing_oc.advance_cdc                     = oc_in.advance_cdc
            existing_oc.advance_pdc                     = oc_in.advance_pdc
            existing_oc.payment_collection_from_site    = oc_in.payment_collection_from_site
            existing_oc.payment_collection_from_office  = oc_in.payment_collection_from_office
            existing_oc.delivery_percent                = oc_in.delivery_percent
            existing_oc.delivery_cdc                    = oc_in.delivery_cdc
            existing_oc.delivery_pdc                    = oc_in.delivery_pdc
            existing_oc.delivery_before                 = oc_in.delivery_before
            existing_oc.delivery_after                  = oc_in.delivery_after
            existing_oc.security_cheque_required        = oc_in.security_cheque_required
            existing_oc.when_recollect                  = oc_in.when_recollect
            existing_oc.work_in_progress_percent        = oc_in.work_in_progress_percent
            existing_oc.completion_amount               = oc_in.completion_amount
            existing_oc.completion_cdc                  = oc_in.completion_cdc
            existing_oc.completion_pdc                  = oc_in.completion_pdc
            existing_oc.testing_commissioning_amount    = oc_in.testing_commissioning_amount
            existing_oc.testing_commissioning_cdc       = oc_in.testing_commissioning_cdc
            existing_oc.testing_commissioning_pdc       = oc_in.testing_commissioning_pdc
            existing_oc.retention_amount                = oc_in.retention_amount
            existing_oc.retention_cdc                   = oc_in.retention_cdc
            existing_oc.retention_pdc                   = oc_in.retention_pdc
            existing_oc.other_committed_terms           = oc_in.other_committed_terms
            existing_oc.accounts_name                   = oc_in.accounts_name
            existing_oc.accounts_email                  = oc_in.accounts_email
            existing_oc.accounts_tel_mob                = oc_in.accounts_tel_mob
            existing_oc.invoice_submission_office       = oc_in.invoice_submission_office
            existing_oc.invoice_submission_site         = oc_in.invoice_submission_site
            existing_oc.warranty_manual_submission_time = oc_in.warranty_manual_submission_time
            existing_oc.project_name                    = oc_in.project_name
            existing_oc.project_email                   = oc_in.project_email
            existing_oc.project_tel_mob                 = oc_in.project_tel_mob
            existing_oc.sales_executive_name            = oc_in.sales_executive_name
            existing_oc.manager_name                    = oc_in.manager_name
        else:
            db.add(OrderConfirmationDetails(
                card_id=card.id,
                lpo_no=oc_in.lpo_no,
                qtn_no=oc_in.qtn_no,
                date=oc_date,
                tank_brand_size_type_value=oc_in.tank_brand_size_type_value,
                payment_terms_confirmed=oc_in.payment_terms_confirmed,
                other_terms_condition=oc_in.other_terms_condition,
                penalty_conditions_note=oc_in.penalty_conditions_note,
                advance_percent=oc_in.advance_percent,
                advance_cdc=oc_in.advance_cdc,
                advance_pdc=oc_in.advance_pdc,
                payment_collection_from_site=oc_in.payment_collection_from_site,
                payment_collection_from_office=oc_in.payment_collection_from_office,
                delivery_percent=oc_in.delivery_percent,
                delivery_cdc=oc_in.delivery_cdc,
                delivery_pdc=oc_in.delivery_pdc,
                delivery_before=oc_in.delivery_before,
                delivery_after=oc_in.delivery_after,
                security_cheque_required=oc_in.security_cheque_required,
                when_recollect=oc_in.when_recollect,
                work_in_progress_percent=oc_in.work_in_progress_percent,
                completion_amount=oc_in.completion_amount,
                completion_cdc=oc_in.completion_cdc,
                completion_pdc=oc_in.completion_pdc,
                testing_commissioning_amount=oc_in.testing_commissioning_amount,
                testing_commissioning_cdc=oc_in.testing_commissioning_cdc,
                testing_commissioning_pdc=oc_in.testing_commissioning_pdc,
                retention_amount=oc_in.retention_amount,
                retention_cdc=oc_in.retention_cdc,
                retention_pdc=oc_in.retention_pdc,
                other_committed_terms=oc_in.other_committed_terms,
                accounts_name=oc_in.accounts_name,
                accounts_email=oc_in.accounts_email,
                accounts_tel_mob=oc_in.accounts_tel_mob,
                invoice_submission_office=oc_in.invoice_submission_office,
                invoice_submission_site=oc_in.invoice_submission_site,
                warranty_manual_submission_time=oc_in.warranty_manual_submission_time,
                project_name=oc_in.project_name,
                project_email=oc_in.project_email,
                project_tel_mob=oc_in.project_tel_mob,
                sales_executive_name=oc_in.sales_executive_name,
                manager_name=oc_in.manager_name,
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
