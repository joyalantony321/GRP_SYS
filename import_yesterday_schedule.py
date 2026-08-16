"""
One-off migration: wipe current Work Order / Schedule data and re-import it
from yesterday's 6 CSV report exports (Delivery/Installation x
Pending/Planning/Status). Populates:
  - Postgres `cards` + `work_order_details` (Work Order channel, Schedule list)
  - client/data/schedule-data.json (ScheduleBoard source of truth)

Run with: python import_yesterday_schedule.py
"""
from __future__ import annotations

import csv
import json
import re
import shutil
from datetime import datetime, date
from pathlib import Path

import psycopg2
import psycopg2.extras

CSV_DIR = Path(r"c:\Users\JOYAL'S LEGION\Downloads\8-7-GRP\New folder")
SCHEDULE_JSON = Path(__file__).parent / "client" / "data" / "schedule-data.json"

DB = dict(host="localhost", port=5433, dbname="GRP_SYS", user="postgres", password="RdDpp2M47i")

FILES = [
    ("Delivery Pending.csv", "delivery", "pending"),
    ("Delivery Planning.csv", "delivery", "planning"),
    ("Delivery Status.csv", "delivery", "status"),
    ("Installation Pending.csv", "installation", "pending"),
    ("Installation Planning.csv", "installation", "planning"),
    ("Installation Status.csv", "installation", "status"),
]

STAGE_MAP = {
    ("delivery", "pending"): "Pending delivery",
    ("delivery", "planning"): "Delivery scheduled",
    ("delivery", "status"): "Delivery completed",
    ("installation", "pending"): "Pending installation",
    ("installation", "planning"): "Installation scheduled",
    ("installation", "status"): "Installation in progress",
}


def norm_header(h: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (h or "").upper())


FIELD_MAP_RULES = [
    ("wo", lambda n: "WONO" in n),
    ("customer", lambda n: n == "CUSTOMER"),
    ("brand", lambda n: "BRAND" in n),
    ("location", lambda n: n == "LOCATION"),
    ("tank_size", lambda n: "TANKSIZE" in n),
    ("qty", lambda n: n == "QTY"),
    ("type", lambda n: n == "TYPE"),
    ("start_date", lambda n: "INSTSTART" in n or n.startswith("DELDATE") or n == "DELDATE"),
    ("status", lambda n: "STATUSOFINSTALATION" in n or "INSTALLATIONSTATUS" in n or "DELIVERYSTATUS" in n),
    ("workers", lambda n: n == "WORKERS" or n == "WORKER"),
    ("contact", lambda n: "CONTACTPERSON" in n),
    ("phone", lambda n: n in ("PHONE", "PHONENUMBER")),
    ("completion_date", lambda n: "INSCOMPLET" in n or "INSCOMPLDATE" in n or "DELCOMPDATE" in n),
    ("sales_person", lambda n: "SALESPERSON" in n),
    ("remarks", lambda n: "REMARKS" in n or n == "REMARK"),
]


def map_headers(fieldnames):
    mapping = {}
    for fn in fieldnames:
        n = norm_header(fn)
        for key, pred in FIELD_MAP_RULES:
            if pred(n):
                mapping[fn] = key
                break
    return mapping


DATE_RE = re.compile(r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})")
BRACKET_DATE_RE = re.compile(r"\[\s*(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{4})\s*\]")


def parse_date(text: str):
    if not text:
        return None
    m = DATE_RE.search(text)
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def extract_bracket_date(text: str):
    if not text:
        return None
    m = BRACKET_DATE_RE.search(text)
    if not m:
        return None
    return parse_date(m.group(1))


def norm_brand(raw: str) -> str:
    up = (raw or "").upper()
    if "COLEX" in up or "KOLEX" in up:
        return "COLEX"
    if "PIPECO" in up:
        return "PIPECO"
    return (raw or "").strip()


def norm_type(raw: str) -> str:
    up = (raw or "").strip().upper().rstrip(".")
    if up == "INS":
        return "INS"
    if up == "NON":
        return "NON-INS"
    return ""


def parse_csv_entries(path: Path, phase: str, bucket: str) -> list[dict]:
    entries: list[dict] = []
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        mapping = map_headers(reader.fieldnames or [])

        current_entry = None
        tank_seq = 0

        for raw_row in reader:
            row = {}
            for src_col, val in raw_row.items():
                key = mapping.get(src_col)
                if key:
                    row[key] = (val or "").strip()

            wo = row.get("wo", "").strip()
            has_any = any(v for v in row.values())
            if not has_any:
                continue

            if wo:
                # Begin a new table-entry when WO appears (even if same WO repeats later).
                tank_seq = 0
                current_entry = {
                    "wo": wo,
                    "phase": phase,
                    "bucket": bucket,
                    "customer": row.get("customer", ""),
                    "brand": row.get("brand", ""),
                    "location": row.get("location", ""),
                    "contact": row.get("contact", ""),
                    "phone": row.get("phone", ""),
                    "sales_person": row.get("sales_person", ""),
                    "start_date": None,
                    "completion_date": None,
                    "status_text": "",
                    "workers": [],
                    "tanks": [],
                    "remarks_set": [],
                }
                entries.append(current_entry)

            if current_entry is None:
                continue  # stray row before any WO seen

            entry = current_entry

            for key in ("customer", "brand", "location", "contact", "phone", "sales_person"):
                if row.get(key) and not entry.get(key):
                    entry[key] = row.get(key, "")

            start_date = parse_date(row.get("start_date", ""))
            completion_date = parse_date(row.get("completion_date", ""))
            status_text = row.get("status", "").strip()
            if not completion_date:
                completion_date = extract_bracket_date(status_text)

            if start_date and not entry["start_date"]:
                entry["start_date"] = start_date
            if completion_date and not entry["completion_date"]:
                entry["completion_date"] = completion_date
            if status_text and not entry["status_text"]:
                entry["status_text"] = status_text
            if row.get("workers"):
                names = [w.strip() for w in row["workers"].split(",") if w.strip()]
                for nm in names:
                    if nm not in entry["workers"]:
                        entry["workers"].append(nm)

            tank_size = row.get("tank_size", "").strip()
            if tank_size:
                tank_seq += 1
                qty = row.get("qty", "").strip()
                remark = row.get("remarks", "").strip()
                row_workers = [w.strip() for w in row.get("workers", "").split(",") if w.strip()]
                if remark and remark not in entry["remarks_set"]:
                    entry["remarks_set"].append(remark)
                entry["tanks"].append(
                    {
                        "label": f"T{tank_seq}",
                        "tank_size": tank_size,
                        "qty": qty,
                        "type": norm_type(row.get("type", "")),
                        "remark": remark,
                        "status_text": status_text,
                        "workers": row_workers,
                        "start_date": start_date,
                        "completion_date": completion_date,
                    }
                )

    return entries


def _sanitize_id_part(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]", "-", value or "")


def main():
    all_entries: list[dict] = []
    source_date = max(datetime.fromtimestamp((CSV_DIR / filename).stat().st_mtime).date() for filename, _, _ in FILES)
    entries_by_list: dict[str, int] = {
        "pending-delivery": 0,
        "planning-delivery": 0,
        "status-delivery": 0,
        "pending-installation": 0,
        "planning-installation": 0,
        "status-installation": 0,
    }

    for filename, phase, bucket in FILES:
        path = CSV_DIR / filename
        rows = parse_csv_entries(path, phase, bucket)
        all_entries.extend(rows)
        entries_by_list[f"{bucket}-{phase}"] += len(rows)

    print(f"Parsed {len(all_entries)} schedule entries from 6 CSV files.")
    for list_id, count in entries_by_list.items():
        print(f"  - {list_id}: {count}")

    # ---- Backups -----------------------------------------------------------
    backup_dir = Path(__file__).parent / "Database" / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if SCHEDULE_JSON.exists():
        shutil.copy(SCHEDULE_JSON, backup_dir / f"schedule-data.{ts}.json.bak")

    conn = psycopg2.connect(**DB)
    conn.autocommit = False
    cur = conn.cursor()

    # Backup current cards-related rows as JSON before wiping.
    cur.execute("SELECT row_to_json(c) FROM cards c")
    existing_cards = [r[0] for r in cur.fetchall()]
    (backup_dir / f"cards.{ts}.json.bak").write_text(
        json.dumps(existing_cards, default=str, indent=2), encoding="utf-8"
    )

    # ---- Wipe (Work Order channel data only) --------------------------------
    cur.execute(
        "TRUNCATE TABLE audit_log_work_order, audit_log_quotation, "
        "work_order_details, order_confirmation_details, list_history, remarks, cards "
        "RESTART IDENTITY CASCADE"
    )

    # Work Order channel = 2, Schedule list = 10
    CHANNEL_ID = 2
    LIST_ID = 10

    schedule_store = {
        "pending-delivery": [],
        "planning-delivery": [],
        "status-delivery": [],
        "pending-installation": [],
        "planning-installation": [],
        "status-installation": [],
        "archive-completed": [],
    }

    insert_card_sql = """
        INSERT INTO cards (
            id, work_order_number, customer_name, customer_company_name, date,
            sales_person, project_location, list_id, channel_id,
            schedule_type, schedule_stage, payment_percent, tank_details
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """
    insert_wo_details_sql = """
        INSERT INTO work_order_details (
            card_id, brand, company_name, delivery_date, delivery_location,
            installation_completion_date, delivery_contact_name, delivery_contact_number,
            type_insulated, type_non_insulated, items
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
    """

    imported = 0
    wo_occurrence: dict[str, int] = {}
    for entry in all_entries:
        wo = entry["wo"]
        phase = entry["phase"]
        bucket = entry["bucket"]
        customer = (entry.get("customer") or "").strip()
        brand_raw = entry.get("brand") or ""
        brand = norm_brand(brand_raw)
        location = (entry.get("location") or "").strip()
        contact = (entry.get("contact") or "").strip()
        phone = (entry.get("phone") or "").strip()
        sales_person = (entry.get("sales_person") or "").strip()
        schedule_type = "Delivery" if phase == "delivery" else "Installation"
        schedule_stage = STAGE_MAP[(phase, bucket)]

        key = f"{wo}|{phase}|{bucket}"
        wo_occurrence[key] = wo_occurrence.get(key, 0) + 1
        suffix = wo_occurrence[key]
        safe_wo = _sanitize_id_part(wo)
        card_id = f"wo-{safe_wo}-{phase[:3]}-{bucket[:3]}-{suffix}"

        tanks = entry.get("tanks") or []
        combined_tanks = []
        insulated = False
        non_insulated = False
        for idx, t in enumerate(tanks, start=1):
            if t["type"] == "INS":
                insulated = True
            elif t["type"] == "NON-INS":
                non_insulated = True
            combined_tanks.append(
                {
                    "id": f"tank-{safe_wo}-{phase}-{bucket}-{suffix}-{idx}",
                    "label": t["label"],
                    "length": "",
                    "width": "",
                    "height": "",
                    "itemDescription": t["tank_size"],
                    "qty": t["qty"] or "1",
                    "tankType": t["type"],
                    "remarks": t["remark"],
                }
            )

        cur.execute(
            insert_card_sql,
            (
                card_id, wo, None, customer or None, source_date,
                sales_person or None, location or None, LIST_ID, CHANNEL_ID,
                schedule_type, schedule_stage, 0, json.dumps(combined_tanks),
            ),
        )

        wo_details_delivery_date = entry["start_date"] if phase == "delivery" else None
        wo_details_install_comp = entry["completion_date"] if phase == "installation" else None
        cur.execute(
            insert_wo_details_sql,
            (
                card_id,
                (brand + " TANKS") if brand in ("COLEX", "PIPECO") else None,
                customer or None,
                wo_details_delivery_date,
                location or None,
                wo_details_install_comp,
                contact or None,
                phone or None,
                insulated,
                non_insulated,
                json.dumps(
                    [
                        {"slNo": idx + 1, "itemDescription": t["itemDescription"], "qty": t.get("qty") or 1, "remarks": t["remarks"]}
                        for idx, t in enumerate(combined_tanks)
                    ]
                ),
            ),
        )

        list_key = f"{bucket}-{phase}"
        created_at_date = entry["start_date"] or source_date
        confirmed_date_field = entry["start_date"]
        completed_date_field = entry["completion_date"]

        tanks_json = []
        for idx, t in enumerate(tanks, start=1):
            status_up = (t["status_text"] or "").upper()
            delivery_status = "Not scheduled"
            installation_status = "Not scheduled"
            if phase == "delivery":
                if "PARTIAL" in status_up:
                    delivery_status = "Partial delivery"
                elif "DELIVER" in status_up:
                    delivery_status = "Fully delivered"
                elif t["start_date"]:
                    delivery_status = "Scheduled"
            else:
                if "PARTIAL" in status_up or "80%" in status_up or "BALANCE" in status_up:
                    installation_status = "Partial Installed"
                elif "COMPLET" in status_up:
                    installation_status = "Fully Installed"
                elif t["start_date"] or status_up:
                    installation_status = "Scheduled"

            tanks_json.append(
                {
                    "tankDetailId": f"tank-{safe_wo}-{phase}-{bucket}-{suffix}-{idx}",
                    "label": t["label"],
                    "tankSize": t["tank_size"],
                    "qty": t["qty"] or "1",
                    "itemDescription": "",
                    "tankType": t["type"],
                    "remarks": t["remark"],
                    "deliveryStatus": delivery_status,
                    "installationStatus": installation_status,
                    "workers": t["workers"],
                    **({"scheduledDate": t["start_date"].isoformat()} if t["start_date"] else {}),
                    **({"deliveryStatusText": t["status_text"]} if phase == "delivery" and t["status_text"] else {}),
                    **({"installationStatusText": t["status_text"]} if phase == "installation" and t["status_text"] else {}),
                    **({"completionDate": t["completion_date"].isoformat()} if t["completion_date"] else {}),
                }
            )

        sc_card = {
            "id": f"{card_id}-schedule",
            "sourceCardId": card_id,
            "phase": phase,
            "woCode": wo,
            "scheduleType": schedule_type,
            "listId": list_key,
            "workers": entry["workers"],
            "isEmergency": False,
            "paymentPercent": 0,
            "isConfirmed": bool(confirmed_date_field),
            "remarks": [],
            "createdAt": datetime.combine(created_at_date, datetime.min.time()).isoformat() + "+00:00",
            "customer": customer,
            "location": location,
            "tankSize": ", ".join(t["tank_size"] for t in tanks),
            "tanks": tanks_json,
            "contactPerson": contact,
            "phone": phone,
            "salesPerson": sales_person,
            "brand": brand,
            "sectionRemarks": "; ".join(entry["remarks_set"]),
        }
        if confirmed_date_field:
            sc_card["confirmedDate"] = datetime.combine(confirmed_date_field, datetime.min.time()).isoformat() + "+00:00"
        if completed_date_field:
            sc_card["completedDate"] = datetime.combine(completed_date_field, datetime.min.time()).isoformat() + "+00:00"

        if phase == "delivery":
            sc_card["deliveryStatus"] = tanks_json[0]["deliveryStatus"] if tanks_json else "Not scheduled"
        else:
            sc_card["installationStatus"] = tanks_json[0]["installationStatus"] if tanks_json else "Not scheduled"
            if entry["status_text"]:
                sc_card["installationStatusText"] = entry["status_text"]

        schedule_store[list_key].append(sc_card)

        imported += 1

    conn.commit()
    cur.close()
    conn.close()

    SCHEDULE_JSON.write_text(json.dumps(schedule_store, indent=2), encoding="utf-8")

    print(f"\nImported {imported} cards into DB + schedule-data.json.")
    print(f"Backups written to {backup_dir}")


if __name__ == "__main__":
    main()
