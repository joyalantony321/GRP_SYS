-- =============================================================================
-- GRP_SYS Database Schema
-- Database: GRP_SYS  |  User: postgres
-- =============================================================================

-- Ensure clean slate (drop in reverse dependency order)
DROP TABLE IF EXISTS audit_log_work_order  CASCADE;
DROP TABLE IF EXISTS audit_log_quotation   CASCADE;
DROP TABLE IF EXISTS order_confirmation_details CASCADE;
DROP TABLE IF EXISTS work_order_details    CASCADE;
DROP TABLE IF EXISTS list_history          CASCADE;
DROP TABLE IF EXISTS remarks               CASCADE;
DROP TABLE IF EXISTS cards                 CASCADE;
DROP TABLE IF EXISTS lists                 CASCADE;
DROP TABLE IF EXISTS channels              CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;
DROP TABLE IF EXISTS departments           CASCADE;
DROP TABLE IF EXISTS app_settings          CASCADE;

DROP TYPE IF EXISTS stage_type             CASCADE;
DROP TYPE IF EXISTS working_status_type    CASCADE;
DROP TYPE IF EXISTS brand_type             CASCADE;

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE stage_type AS ENUM ('Active', 'Pending', 'Inactive');

CREATE TYPE working_status_type AS ENUM (
    'Unassigned', 'Assigned', 'Working', 'Completed'
);

CREATE TYPE brand_type AS ENUM ('PIPECO TANKS', 'COLEX TANKS');

-- =============================================================================
-- TABLE 1 — DEPARTMENTS
-- 4 fixed departments matching the frontend
-- =============================================================================

CREATE TABLE departments (
    dep_id   SERIAL PRIMARY KEY,
    dep_name VARCHAR(100) NOT NULL UNIQUE
);

-- Seed the 4 departments
INSERT INTO departments (dep_name) VALUES
    ('Quotation'),
    ('Technical'),
    ('Accounts'),
    ('Delivery & Installation');

-- =============================================================================
-- TABLE 2 — USERS
-- Managed via Admin Panel; PIN is 4-digit stored as text
-- =============================================================================

CREATE TABLE users (
    user_id    SERIAL      PRIMARY KEY,
    username   VARCHAR(150) NOT NULL UNIQUE,
    pin        VARCHAR(10)  NOT NULL,
    dep_id     INT          REFERENCES departments(dep_id) ON DELETE SET NULL,
    is_deleted BOOLEAN      NOT NULL DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE 3 — CHANNELS
-- 2 channels matching the frontend: Quotation, Work Order
-- dep_id = primary/owning department of the channel
-- =============================================================================

CREATE TABLE channels (
    channel_id   SERIAL      PRIMARY KEY,
    channel_name VARCHAR(100) NOT NULL UNIQUE,
    dep_id       INT          REFERENCES departments(dep_id) ON DELETE SET NULL
);

-- Seed channels
INSERT INTO channels (channel_name, dep_id) VALUES
    ('Quotation',   (SELECT dep_id FROM departments WHERE dep_name='Quotation')),
    ('Work Order',  (SELECT dep_id FROM departments WHERE dep_name='Accounts'));

-- =============================================================================
-- TABLE 4 — LISTS
-- 8 lists (4 per channel) matching the frontend
-- =============================================================================

CREATE TABLE lists (
    list_id    SERIAL       PRIMARY KEY,
    list_name  VARCHAR(100) NOT NULL,
    channel_id INT          NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
    UNIQUE (list_name, channel_id)
);

-- Seed lists — Quotation channel
INSERT INTO lists (list_name, channel_id) VALUES
    ('Quotation',  (SELECT channel_id FROM channels WHERE channel_name='Quotation')),
    ('Submittal',  (SELECT channel_id FROM channels WHERE channel_name='Quotation')),
    ('Review',     (SELECT channel_id FROM channels WHERE channel_name='Quotation')),
    ('LPO',        (SELECT channel_id FROM channels WHERE channel_name='Quotation'));

-- Seed lists — Work Order channel
INSERT INTO lists (list_name, channel_id) VALUES
    ('Work Order',   (SELECT channel_id FROM channels WHERE channel_name='Work Order')),
    ('Accounts',     (SELECT channel_id FROM channels WHERE channel_name='Work Order')),
    ('Delivery',     (SELECT channel_id FROM channels WHERE channel_name='Work Order')),
    ('Installation', (SELECT channel_id FROM channels WHERE channel_name='Work Order'));

-- =============================================================================
-- CARDS — master record for both channels
-- (referenced by audit logs, remarks, list_history, work_order_details, etc.)
-- =============================================================================

CREATE TABLE cards (
    id                      VARCHAR(64)  PRIMARY KEY,
    quote_number            VARCHAR(100),
    work_order_number       VARCHAR(100),
    company_code            VARCHAR(20),
    date                    DATE         NOT NULL,
    sales_person            VARCHAR(150),
    subject                 TEXT,
    project_location        TEXT,
    list_id                 INT          REFERENCES lists(list_id) ON DELETE SET NULL,
    channel_id              INT          REFERENCES channels(channel_id) ON DELETE SET NULL,

    -- Status flags
    approved                BOOLEAN      NOT NULL DEFAULT FALSE,
    terminated              BOOLEAN      NOT NULL DEFAULT FALSE,
    completed_at            TIMESTAMPTZ,

    -- Assignment
    assigned_to             INT          REFERENCES users(user_id) ON DELETE SET NULL,
    user_work_status        working_status_type DEFAULT 'Unassigned',

    -- Document references (file stored on disk, URL kept here)
    purchase_order_doc_name VARCHAR(255),
    purchase_order_doc_url  TEXT,
    quotation_doc_name      VARCHAR(255),
    quotation_doc_url       TEXT,
    completion_doc_name     VARCHAR(255),
    completion_doc_url      TEXT,

    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- REMARKS — per card, per list
-- =============================================================================

CREATE TABLE remarks (
    id                  VARCHAR(64)  PRIMARY KEY,
    card_id             VARCHAR(64)  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    list_id             INT          REFERENCES lists(list_id) ON DELETE SET NULL,
    type                stage_type   NOT NULL DEFAULT 'Active',
    tags                TEXT[],
    description         TEXT,
    created_by          INT          REFERENCES users(user_id) ON DELETE SET NULL,
    visible_dep_ids     INT[],       -- array of dep_id values
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- LIST HISTORY — track card movement between lists
-- =============================================================================

CREATE TABLE list_history (
    id         SERIAL       PRIMARY KEY,
    card_id    VARCHAR(64)  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    list_id    INT          REFERENCES lists(list_id) ON DELETE SET NULL,
    entered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE 5 — WORK ORDER DETAILS
-- Full work-order form data (matches WorkOrderFormData in frontend types)
-- =============================================================================

CREATE TABLE work_order_details (
    id                          SERIAL      PRIMARY KEY,
    card_id                     VARCHAR(64) UNIQUE REFERENCES cards(id) ON DELETE CASCADE,

    wo_date                     DATE,
    customer_id                 VARCHAR(100),
    invoice_no                  VARCHAR(100),
    invoice_date                DATE,
    brand                       brand_type,

    -- Company Details
    company_name                VARCHAR(255),
    company_contact_name        VARCHAR(255),
    company_address             TEXT,
    company_phone               VARCHAR(50),
    company_email               VARCHAR(255),

    -- Delivery Details
    delivery_date               DATE,
    delivery_location           TEXT,
    delivery_contact_name       VARCHAR(255),
    delivery_contact_number     VARCHAR(50),
    installation_completion_date DATE,

    -- Specification checkboxes
    type_insulated              BOOLEAN DEFAULT FALSE,
    type_non_insulated          BOOLEAN DEFAULT FALSE,
    skid_hollow                 BOOLEAN DEFAULT FALSE,
    skid_i_beam                 BOOLEAN DEFAULT FALSE,
    indicator_tube              BOOLEAN DEFAULT FALSE,
    indicator_scale             BOOLEAN DEFAULT FALSE,
    ladder_internal             BOOLEAN DEFAULT FALSE,
    ladder_external             BOOLEAN DEFAULT FALSE,
    support_internal            BOOLEAN DEFAULT FALSE,
    support_external            BOOLEAN DEFAULT FALSE,
    supply                      BOOLEAN DEFAULT FALSE,
    installation                BOOLEAN DEFAULT FALSE,
    testing_commissioning       BOOLEAN DEFAULT FALSE,
    maintenance                 BOOLEAN DEFAULT FALSE,

    -- Job
    job_description             TEXT,
    items                       JSONB,   -- array of WorkOrderItem

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- TABLE 6 — PURCHASE ORDER (ORDER CONFIRMATION) DETAILS
-- Full order confirmation form (matches OrderConfirmationFormData in frontend)
-- =============================================================================

CREATE TABLE order_confirmation_details (
    id                              SERIAL       PRIMARY KEY,
    card_id                         VARCHAR(64)  UNIQUE REFERENCES cards(id) ON DELETE CASCADE,

    lpo_no                          VARCHAR(100),
    qtn_no                          VARCHAR(100),
    date                            DATE,

    -- LPO confirmations
    tank_brand_size_type_value      VARCHAR(10),   -- 'yes' | 'no' | ''
    payment_terms_confirmed         VARCHAR(10),
    other_terms_condition           VARCHAR(10),
    penalty_conditions_note         TEXT,

    -- Payment terms
    advance_percent                 VARCHAR(20),
    advance_cdc                     BOOLEAN DEFAULT FALSE,
    advance_pdc                     BOOLEAN DEFAULT FALSE,
    payment_collection_from_site    BOOLEAN DEFAULT FALSE,
    payment_collection_from_office  BOOLEAN DEFAULT FALSE,
    delivery_percent                VARCHAR(20),
    delivery_cdc                    BOOLEAN DEFAULT FALSE,
    delivery_pdc                    BOOLEAN DEFAULT FALSE,
    delivery_before                 BOOLEAN DEFAULT FALSE,
    delivery_after                  BOOLEAN DEFAULT FALSE,
    security_cheque_required        VARCHAR(10),
    when_recollect                  TEXT,
    work_in_progress_percent        VARCHAR(20),
    completion_amount               VARCHAR(50),
    completion_cdc                  BOOLEAN DEFAULT FALSE,
    completion_pdc                  BOOLEAN DEFAULT FALSE,
    testing_commissioning_amount    VARCHAR(50),
    testing_commissioning_cdc       BOOLEAN DEFAULT FALSE,
    testing_commissioning_pdc       BOOLEAN DEFAULT FALSE,
    retention_amount                VARCHAR(50),
    retention_cdc                   BOOLEAN DEFAULT FALSE,
    retention_pdc                   BOOLEAN DEFAULT FALSE,
    other_committed_terms           TEXT,

    -- Accounts Contact
    accounts_name                   VARCHAR(255),
    accounts_email                  VARCHAR(255),
    accounts_tel_mob                VARCHAR(50),

    -- Document Handovering
    invoice_submission_office       BOOLEAN DEFAULT FALSE,
    invoice_submission_site         BOOLEAN DEFAULT FALSE,
    warranty_manual_submission_time TEXT,

    -- Project Contact
    project_name                    VARCHAR(255),
    project_email                   VARCHAR(255),
    project_tel_mob                 VARCHAR(50),

    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOG — QUOTATION CHANNEL
-- Every state change in the Quotation channel is recorded here.
-- Upload column supports PDF / Word / Excel files for quotation documents.
-- =============================================================================

CREATE TABLE audit_log_quotation (
    log_id          BIGSERIAL    PRIMARY KEY,

    -- Core identifiers
    quote_no        VARCHAR(100),
    user_id         INT          REFERENCES users(user_id)  ON DELETE SET NULL,
    list_id         INT          REFERENCES lists(list_id)  ON DELETE SET NULL,

    -- Stage / status
    stage           stage_type,                              -- Active / Pending / Inactive
    assignment      INT     REFERENCES users(user_id)       -- NULL = Unassigned
                    ON DELETE SET NULL,
    working         working_status_type NOT NULL DEFAULT 'Unassigned',

    -- Remark details
    remarks         TEXT,
    tags            TEXT[],
    remarks_dep_id  INT     REFERENCES departments(dep_id)  ON DELETE SET NULL,
    remarks_list_id INT     REFERENCES lists(list_id)       ON DELETE SET NULL,

    -- Approval / termination flags
    approved        BOOLEAN NOT NULL DEFAULT FALSE,
    terminated      BOOLEAN NOT NULL DEFAULT FALSE,

    -- File upload (PDF / Word / Excel)
    upload_file_name  VARCHAR(255),
    upload_file_path  TEXT,
    upload_file_type  VARCHAR(50),   -- 'pdf' | 'docx' | 'xlsx' | etc.

    -- What changed (JSON diff for full traceability)
    change_details  JSONB,

    -- Audit metadata
    action          VARCHAR(100) NOT NULL,  -- e.g. 'card_created', 'remark_added', 'approved'
    performed_by    INT          REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AUDIT LOG — WORK ORDER CHANNEL
-- Every state change in the Work Order channel is recorded here.
-- Two upload columns: one for the Work Order doc, one for the Purchase Order doc.
-- =============================================================================

CREATE TABLE audit_log_work_order (
    log_id              BIGSERIAL    PRIMARY KEY,

    -- Core identifiers
    work_order_no       VARCHAR(100),
    user_id             INT          REFERENCES users(user_id)    ON DELETE SET NULL,
    order_details_id    INT          REFERENCES order_confirmation_details(id) ON DELETE SET NULL,
    work_order_id       INT          REFERENCES work_order_details(id)         ON DELETE SET NULL,

    -- Assignment / working status
    assignment          INT     REFERENCES users(user_id)         ON DELETE SET NULL,
    working             working_status_type NOT NULL DEFAULT 'Unassigned',

    -- Remark details
    remarks             TEXT,
    tags                TEXT[],
    remarks_dep_id      INT     REFERENCES departments(dep_id)    ON DELETE SET NULL,
    remarks_list_id     INT     REFERENCES lists(list_id)         ON DELETE SET NULL,

    -- Completion flag
    completed           BOOLEAN NOT NULL DEFAULT FALSE,

    -- Upload: Work Order document (PDF / Word / Excel)
    upload_wo_file_name   VARCHAR(255),
    upload_wo_file_path   TEXT,
    upload_wo_file_type   VARCHAR(50),

    -- Upload: Purchase Order document (PDF / Word / Excel)
    upload_po_file_name   VARCHAR(255),
    upload_po_file_path   TEXT,
    upload_po_file_type   VARCHAR(50),

    -- What changed (JSON diff for full traceability)
    change_details  JSONB,

    -- Audit metadata
    action          VARCHAR(100) NOT NULL,
    performed_by    INT          REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- APP SETTINGS (admin PIN, etc.)
-- =============================================================================

CREATE TABLE app_settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT         NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value) VALUES ('admin_pin', '9656');

-- =============================================================================
-- INDEXES for fast lookups
-- =============================================================================

CREATE INDEX idx_cards_channel      ON cards (channel_id);
CREATE INDEX idx_cards_list         ON cards (list_id);
CREATE INDEX idx_cards_assigned     ON cards (assigned_to);
CREATE INDEX idx_remarks_card       ON remarks (card_id);
CREATE INDEX idx_list_history_card  ON list_history (card_id);
CREATE INDEX idx_ald_quote_no       ON audit_log_quotation (quote_no);
CREATE INDEX idx_ald_user           ON audit_log_quotation (user_id);
CREATE INDEX idx_ald_list           ON audit_log_quotation (list_id);
CREATE INDEX idx_ald_created        ON audit_log_quotation (created_at DESC);
CREATE INDEX idx_alwo_wo_no         ON audit_log_work_order (work_order_no);
CREATE INDEX idx_alwo_user          ON audit_log_work_order (user_id);
CREATE INDEX idx_alwo_created       ON audit_log_work_order (created_at DESC);

-- =============================================================================
-- AUTO-UPDATE updated_at via trigger function
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cards_updated_at
    BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_remarks_updated_at
    BEFORE UPDATE ON remarks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_wo_details_updated_at
    BEFORE UPDATE ON work_order_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_oc_details_updated_at
    BEFORE UPDATE ON order_confirmation_details
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
