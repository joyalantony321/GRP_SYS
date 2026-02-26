"""
SQLAlchemy ORM models — mirrors Database/grp_sys_schema.sql exactly.
6 core tables + 2 audit log tables + supporting tables.
"""
from __future__ import annotations
import enum
from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Enum, ForeignKey,
    Integer, String, Text, ARRAY, JSON, func
)
from sqlalchemy.orm import relationship
from database import Base


# ── Enum types ────────────────────────────────────────────────────────────────

class StageType(str, enum.Enum):
    Active   = "Active"
    Pending  = "Pending"
    Inactive = "Inactive"


class WorkingStatus(str, enum.Enum):
    Unassigned = "Unassigned"
    Assigned   = "Assigned"
    Working    = "Working"
    Completed  = "Completed"


class BrandType(str, enum.Enum):
    PIPECO = "PIPECO TANKS"
    COLEX  = "COLEX TANKS"


# ── APP SETTINGS ──────────────────────────────────────────────────────────────

class AppSetting(Base):
    __tablename__ = "app_settings"

    key        = Column(String(100), primary_key=True)
    value      = Column(Text, nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ── TABLE 1: DEPARTMENTS ──────────────────────────────────────────────────────

class Department(Base):
    __tablename__ = "departments"

    dep_id   = Column(Integer, primary_key=True, autoincrement=True)
    dep_name = Column(String(100), nullable=False, unique=True)

    users    = relationship("User",    back_populates="department", foreign_keys="[User.dep_id]")
    channels = relationship("Channel", back_populates="department")


# ── TABLE 2: USERS ───────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    user_id    = Column(Integer,      primary_key=True, autoincrement=True)
    username   = Column(String(150),  nullable=False, unique=True)
    pin        = Column(String(10),   nullable=False)
    dep_id     = Column(Integer,      ForeignKey("departments.dep_id", ondelete="SET NULL"), nullable=True)
    is_deleted = Column(Boolean,      nullable=False, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    department     = relationship("Department", back_populates="users", foreign_keys=[dep_id])
    assigned_cards = relationship("Card", back_populates="assigned_user", foreign_keys="[Card.assigned_to]")


# ── 2. Channel ────────────────────────────────────────────────────────────────
class Channel(Base):
    __tablename__ = "channels"

    channel_id   = Column(Integer, primary_key=True, index=True)
    channel_name = Column(String(100), unique=True, nullable=False)
    dep_id       = Column(Integer, ForeignKey("departments.dep_id"), nullable=False)

    department = relationship("Department", back_populates="channels")
    lists      = relationship("List", back_populates="channel", cascade="all, delete-orphan")
    cards      = relationship("Card", back_populates="channel_rel")


# ── 3. List ────────────────────────────────────────────────────────────────────
class List(Base):
    __tablename__ = "lists"

    list_id    = Column(Integer, primary_key=True, index=True)
    list_name  = Column(String(100), nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.channel_id"), nullable=False)

    channel = relationship("Channel", back_populates="lists")
    cards   = relationship("Card", back_populates="list_rel")


# ── 4. Cards ──────────────────────────────────────────────────────────────────
class Card(Base):
    __tablename__ = "cards"

    id                      = Column(String(64), primary_key=True, index=True)
    quote_number            = Column(String(100), nullable=True)
    revision_number         = Column(Integer, nullable=True)
    work_order_number       = Column(String(50), nullable=True)
    company_code            = Column(String(20), nullable=True)
    date                    = Column(Date, nullable=False)
    sales_person            = Column(String(100), nullable=True)
    subject                 = Column(Text, nullable=True)
    project_location        = Column(Text, nullable=True)
    list_id                 = Column(Integer, ForeignKey("lists.list_id"), nullable=False)
    channel_id              = Column(Integer, ForeignKey("channels.channel_id"), nullable=False)
    approved                = Column(Boolean, default=False)
    terminated              = Column(Boolean, default=False)
    assigned_to             = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    user_work_status        = Column(Enum(WorkingStatus), nullable=True)
    completed_at            = Column(DateTime(timezone=True), nullable=True)

    # Document references (stored as file paths on server)
    purchase_order_doc_name = Column(String(255), nullable=True)
    purchase_order_doc_url  = Column(String(500), nullable=True)
    quotation_doc_name      = Column(String(255), nullable=True)
    quotation_doc_url       = Column(String(500), nullable=True)
    completion_doc_name     = Column(String(255), nullable=True)
    completion_doc_url      = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    list_rel                = relationship("List", back_populates="cards", foreign_keys=[list_id])
    channel_rel             = relationship("Channel", back_populates="cards", foreign_keys=[channel_id])
    assigned_user           = relationship("User", back_populates="assigned_cards", foreign_keys=[assigned_to])
    remarks                 = relationship("Remark", back_populates="card", cascade="all, delete-orphan")
    list_history            = relationship("ListHistory", back_populates="card", cascade="all, delete-orphan")
    work_order_details      = relationship("WorkOrderDetails", back_populates="card", uselist=False, cascade="all, delete-orphan")
    order_confirmation      = relationship("OrderConfirmationDetails", back_populates="card", uselist=False, cascade="all, delete-orphan")


# ── 5. Remarks ────────────────────────────────────────────────────────────────
class Remark(Base):
    __tablename__ = "remarks"

    id                  = Column(String(64), primary_key=True, index=True)
    card_id             = Column(String(64), ForeignKey("cards.id"), nullable=False)
    list_id             = Column(Integer, ForeignKey("lists.list_id"), nullable=False)
    type                = Column(Enum(StageType), nullable=False)
    tags                = Column(ARRAY(Text), nullable=True)
    description         = Column(Text, nullable=True)
    created_by          = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_by_name     = Column(String(200), nullable=True)   # plain-text fallback (e.g. 'Admin')
    visible_dep_ids     = Column(ARRAY(Integer), nullable=True)           # null = visible to all
    created_at          = Column(DateTime(timezone=True), server_default=func.now())
    updated_at          = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    card     = relationship("Card", back_populates="remarks")
    list_rel = relationship("List")
    author   = relationship("User", foreign_keys=[created_by])


# ── 6. List History ───────────────────────────────────────────────────────────
class ListHistory(Base):
    __tablename__ = "list_history"

    id         = Column(Integer, primary_key=True, index=True)
    card_id    = Column(String(64), ForeignKey("cards.id"), nullable=False)
    list_id    = Column(Integer, ForeignKey("lists.list_id"), nullable=False)
    entered_at = Column(DateTime(timezone=True), server_default=func.now())

    card     = relationship("Card", back_populates="list_history")
    list_rel = relationship("List")


# ── 7. Work Order Details ─────────────────────────────────────────────────────
class WorkOrderDetails(Base):
    __tablename__ = "work_order_details"

    id                           = Column(Integer, primary_key=True, index=True)
    card_id                      = Column(String(64), ForeignKey("cards.id"), nullable=False, unique=True)
    wo_date                      = Column(Date, nullable=True)
    customer_id                  = Column(String(100), nullable=True)
    invoice_no                   = Column(String(100), nullable=True)
    invoice_date                 = Column(Date, nullable=True)
    brand                        = Column(Enum(BrandType), nullable=True)
    company_name                 = Column(String(255), nullable=True)
    company_contact_name         = Column(String(255), nullable=True)
    company_address              = Column(Text, nullable=True)
    company_phone                = Column(String(50), nullable=True)
    company_email                = Column(String(255), nullable=True)
    delivery_date                = Column(Date, nullable=True)
    delivery_location            = Column(Text, nullable=True)
    delivery_contact_name        = Column(String(255), nullable=True)
    delivery_contact_number      = Column(String(50), nullable=True)
    installation_completion_date = Column(Date, nullable=True)
    type_insulated               = Column(Boolean, default=False)
    type_non_insulated           = Column(Boolean, default=False)
    skid_hollow                  = Column(Boolean, default=False)
    skid_i_beam                  = Column(Boolean, default=False)
    indicator_tube               = Column(Boolean, default=False)
    indicator_scale              = Column(Boolean, default=False)
    ladder_internal              = Column(Boolean, default=False)
    ladder_external              = Column(Boolean, default=False)
    support_internal             = Column(Boolean, default=False)
    support_external             = Column(Boolean, default=False)
    supply                       = Column(Boolean, default=False)
    installation                 = Column(Boolean, default=False)
    testing_commissioning        = Column(Boolean, default=False)
    maintenance                  = Column(Boolean, default=False)
    job_description              = Column(Text, nullable=True)
    items                        = Column(JSON, default=list)            # list of WorkOrderItem dicts
    created_at                   = Column(DateTime(timezone=True), server_default=func.now())
    updated_at                   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    card = relationship("Card", back_populates="work_order_details")


# ── 8. Order Confirmation Details ─────────────────────────────────────────────
class OrderConfirmationDetails(Base):
    __tablename__ = "order_confirmation_details"

    id                              = Column(Integer, primary_key=True, index=True)
    card_id                         = Column(String(64), ForeignKey("cards.id"), nullable=False, unique=True)
    lpo_no                          = Column(String(100), nullable=True)
    qtn_no                          = Column(String(100), nullable=True)
    date                            = Column(Date, nullable=True)
    tank_brand_size_type_value      = Column(String(10), nullable=True)
    payment_terms_confirmed         = Column(String(10), nullable=True)
    other_terms_condition           = Column(String(10), nullable=True)
    penalty_conditions_note         = Column(Text, nullable=True)
    advance_percent                 = Column(String(20), nullable=True)
    advance_cdc                     = Column(Boolean, default=False)
    advance_pdc                     = Column(Boolean, default=False)
    payment_collection_from_site    = Column(Boolean, default=False)
    payment_collection_from_office  = Column(Boolean, default=False)
    delivery_percent                = Column(String(20), nullable=True)
    delivery_cdc                    = Column(Boolean, default=False)
    delivery_pdc                    = Column(Boolean, default=False)
    delivery_before                 = Column(Boolean, default=False)
    delivery_after                  = Column(Boolean, default=False)
    security_cheque_required        = Column(String(10), nullable=True)
    when_recollect                  = Column(String(255), nullable=True)
    work_in_progress_percent        = Column(String(20), nullable=True)
    completion_amount               = Column(String(50), nullable=True)
    completion_cdc                  = Column(Boolean, default=False)
    completion_pdc                  = Column(Boolean, default=False)
    testing_commissioning_amount    = Column(String(50), nullable=True)
    testing_commissioning_cdc       = Column(Boolean, default=False)
    testing_commissioning_pdc       = Column(Boolean, default=False)
    retention_amount                = Column(String(50), nullable=True)
    retention_cdc                   = Column(Boolean, default=False)
    retention_pdc                   = Column(Boolean, default=False)
    other_committed_terms           = Column(Text, nullable=True)
    accounts_name                   = Column(String(255), nullable=True)
    accounts_email                  = Column(String(255), nullable=True)
    accounts_tel_mob                = Column(String(50), nullable=True)
    invoice_submission_office       = Column(Boolean, default=False)
    invoice_submission_site         = Column(Boolean, default=False)
    warranty_manual_submission_time = Column(String(255), nullable=True)
    project_name                    = Column(String(255), nullable=True)
    project_email                   = Column(String(255), nullable=True)
    project_tel_mob                 = Column(String(50), nullable=True)
    created_at                      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at                      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    card = relationship("Card", back_populates="order_confirmation")


# ── 9. Audit Log — Quotation Channel ─────────────────────────────────────────
class AuditLogQuotation(Base):
    __tablename__ = "audit_log_quotation"

    log_id           = Column(BigInteger, primary_key=True, index=True)
    quote_no         = Column(String(100), nullable=True)
    user_id          = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    list_id          = Column(Integer, ForeignKey("lists.list_id"), nullable=True)
    stage            = Column(Enum(StageType), nullable=True)
    assignment       = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    working          = Column(Enum(WorkingStatus), nullable=False, server_default='Unassigned')
    remarks          = Column(Text, nullable=True)
    tags             = Column(ARRAY(Text), nullable=True)
    approved         = Column(Boolean, nullable=False, server_default='false')
    terminated       = Column(Boolean, nullable=False, server_default='false')
    remarks_dep_id   = Column(Integer, ForeignKey("departments.dep_id"), nullable=True)
    remarks_list_id  = Column(Integer, ForeignKey("lists.list_id"), nullable=True)
    # Uploaded file (PDF / Word / Excel)
    upload_file_name = Column(String(255), nullable=True)
    upload_file_path = Column(String(500), nullable=True)
    upload_file_type = Column(String(10), nullable=True)               # pdf | doc | docx | xlsx
    change_details   = Column(JSON, nullable=True)
    action           = Column(String(100), nullable=False)
    performed_by     = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())

    user             = relationship("User", foreign_keys=[user_id])
    assigned_user    = relationship("User", foreign_keys=[assignment])
    performer        = relationship("User", foreign_keys=[performed_by])
    list_rel         = relationship("List", foreign_keys=[list_id])
    remarks_list_rel = relationship("List", foreign_keys=[remarks_list_id])
    remarks_dep      = relationship("Department", foreign_keys=[remarks_dep_id])


# ── 10. Audit Log — Work Order Channel ────────────────────────────────────────
class AuditLogWorkOrder(Base):
    __tablename__ = "audit_log_work_order"

    log_id             = Column(BigInteger, primary_key=True, index=True)
    work_order_no      = Column(String(100), nullable=True)
    user_id            = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    order_details_id   = Column(Integer, ForeignKey("order_confirmation_details.id"), nullable=True)
    work_order_id      = Column(Integer, ForeignKey("work_order_details.id"), nullable=True)
    assignment         = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    working            = Column(Enum(WorkingStatus), nullable=False, server_default='Unassigned')
    remarks            = Column(Text, nullable=True)
    tags               = Column(ARRAY(Text), nullable=True)
    remarks_dep_id     = Column(Integer, ForeignKey("departments.dep_id"), nullable=True)
    remarks_list_id    = Column(Integer, ForeignKey("lists.list_id"), nullable=True)
    completed          = Column(Boolean, nullable=False, server_default='false')
    # Work Order upload (PDF / Word / Excel)
    upload_wo_file_name = Column(String(255), nullable=True)
    upload_wo_file_path = Column(String(500), nullable=True)
    upload_wo_file_type = Column(String(10), nullable=True)            # pdf | doc | docx | xlsx
    # Purchase Order upload (PDF / Word / Excel)
    upload_po_file_name = Column(String(255), nullable=True)
    upload_po_file_path = Column(String(500), nullable=True)
    upload_po_file_type = Column(String(10), nullable=True)            # pdf | doc | docx | xlsx
    change_details      = Column(JSON, nullable=True)
    action              = Column(String(100), nullable=False)
    performed_by        = Column(Integer, ForeignKey("users.user_id"), nullable=True)
    created_at          = Column(DateTime(timezone=True), server_default=func.now())

    user             = relationship("User", foreign_keys=[user_id])
    assigned_user    = relationship("User", foreign_keys=[assignment])
    performer        = relationship("User", foreign_keys=[performed_by])
    order_details    = relationship("OrderConfirmationDetails", foreign_keys=[order_details_id])
    work_order       = relationship("WorkOrderDetails", foreign_keys=[work_order_id])
    remarks_dep      = relationship("Department", foreign_keys=[remarks_dep_id])
    remarks_list_rel = relationship("List", foreign_keys=[remarks_list_id])
