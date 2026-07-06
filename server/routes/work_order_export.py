"""
work_order_export.py
====================
POST /work-order/export

Cell mapping (after the 2-row insertion in the company/delivery section):

  Header
  ------
  L5  Work Order No.
  C7  Customer ID        G7  Invoice No.      L7  Invoice Date
  C8  Sales Person       L8  W.O. Date

  Company Details        Delivery Details
  ---------------        ----------------
  C11  Name line 1       J11  Location line 1
  C12  Name line 2       J12  Location line 2
  C13  Contact Name      J13  Contact Name
  C14  Address line 1    J14  Contact Number
  C15  Address line 2    J15  Installation Date
  C16  Phone
  C17  Email

  Specifications (row 20)
  -----------------------
  A20 Brand  C20 Type  E20 Skid  G20 Indicator  K20 Ladder  M20 Support

  Services (row 21)
  -----------------
  A21 Supply  D21 Installation  G21 Testing/Comm.  K21 Maintenance

  C23  Job Description
  B25:B39  Item descriptions (15 rows)
  G25:G39  QTY
  H25:H39  Remarks
           └─ If remarks > 10 words, continuation spills to H of next row
              (that row's B and G are left blank / skipped).
"""
from __future__ import annotations

import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse
from lxml import etree
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/work-order", tags=["work-order"])

# ── Template configuration ─────────────────────────────────────────────────────
TEMPLATE_DIR = Path(os.getenv("WO_TEMPLATE_DIR", "/app/templates/work_order"))

TEMPLATE_CONFIG: Dict[str, tuple[str, str]] = {
    "GRP":   ("GRP Work Order Template.xlsx",    "GRP Work Order"),
    "GRPPT": ("Pipeco Work Order Template.xlsx",  "Pipeco Work Order"),
    "CLX":   ("Colex Work order Template.xlsx",   "Colex Work Order"),
}

# ── XML namespaces ─────────────────────────────────────────────────────────────
NS_SS  = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_R   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"


# ── Pydantic schema ────────────────────────────────────────────────────────────

class WorkOrderItem(BaseModel):
    slNo: int = 1
    itemDescription: str = ""
    qty: str = ""
    remarks: str = ""


class WorkOrderExportRequest(BaseModel):
    workOrderNumber: str
    companyCode: str
    salesPerson: str = ""
    woDate: str = ""
    customerId: Optional[str] = ""
    invoiceNo: Optional[str] = ""
    invoiceDate: Optional[str] = ""
    brand: str = ""
    companyName: str = ""
    companyContactName: str = ""
    companyAddress: str = ""
    companyPhone: str = ""
    companyEmail: str = ""
    deliveryLocation: str = ""
    deliveryContactName: str = ""
    deliveryContactNumber: str = ""
    installationCompletionDate: str = ""
    typeInsulated: bool = False
    typeNonInsulated: bool = False
    skidHollow: bool = False
    skidIBeam: bool = False
    indicatorTube: bool = False
    indicatorScale: bool = False
    ladderInternal: bool = False
    ladderExternal: bool = False
    supportInternal: bool = False
    supportExternal: bool = False
    supply: bool = False
    installation: bool = False
    testingCommissioning: bool = False
    maintenance: bool = False
    jobDescription: str = ""
    items: List[WorkOrderItem] = []


# ── Helpers ────────────────────────────────────────────────────────────────────

def _fmt(iso: str) -> str:
    """YYYY-MM-DD → DD-MM-YYYY."""
    if not iso:
        return ""
    p = iso.split("-")
    return f"{p[2]}-{p[1]}-{p[0]}" if len(p) == 3 else iso


def _joined(*pairs: tuple[bool, str]) -> Optional[str]:
    vals = [v for ok, v in pairs if ok]
    return " / ".join(vals) if vals else None


def _split2(text: str, max_chars: int = 32) -> tuple[Optional[str], Optional[str]]:
    """
    Split text at the last word boundary at or before max_chars characters.
    Returns (part1, part2); part2 is None if the full text fits in max_chars.
    Never cuts mid-word.
    """
    text = (text or "").strip()
    if not text:
        return None, None
    if len(text) <= max_chars:
        return text, None

    # Walk backwards from max_chars to find a space
    split_at = text.rfind(" ", 0, max_chars + 1)
    if split_at <= 0:
        split_at = max_chars   # no word boundary found — hard-cut

    part1 = text[:split_at].strip()
    part2 = text[split_at:].strip()
    return part1 or None, part2 or None


def _remarks_chunks(text: str, max_words: int = 10) -> list[str]:
    """
    Split remarks into chunks of at most max_words words.
    Returns a list of 1 or 2 strings.
    """
    words = (text or "").split()
    if len(words) <= max_words:
        return [text] if text else [""]
    return [" ".join(words[:max_words]), " ".join(words[max_words:])]


# ── Item rows builder ──────────────────────────────────────────────────────────

def _build_item_updates(
    items: List[WorkOrderItem],
    start_row: int = 25,
    total_rows: int = 15,
) -> Dict[str, Optional[str]]:
    """
    Map items to xlsx cells, with remarks overflow:
    - If remarks > 10 words the remainder spills into H of the NEXT template row,
      leaving that row's B (description) and G (qty) cells blank.
    """
    updates: Dict[str, Optional[str]] = {}
    tpl_row = start_row          # current template row being filled
    end_row  = start_row + total_rows - 1

    for item in items:
        if tpl_row > end_row:
            break

        remarks_text = (item.remarks or "").strip()
        chunks = _remarks_chunks(remarks_text, max_words=10)

        # First row for this item
        updates[f"B{tpl_row}"] = (item.itemDescription or "").strip() or None
        updates[f"G{tpl_row}"] = (item.qty or "").strip() or None
        updates[f"H{tpl_row}"] = chunks[0] or None
        tpl_row += 1

        # Continuation row if remarks overflowed
        if len(chunks) > 1 and tpl_row <= end_row:
            updates[f"B{tpl_row}"] = None   # skip description for continuation
            updates[f"G{tpl_row}"] = None   # skip qty for continuation
            updates[f"H{tpl_row}"] = chunks[1] or None
            tpl_row += 1

    # Clear any remaining template rows
    while tpl_row <= end_row:
        updates[f"B{tpl_row}"] = None
        updates[f"G{tpl_row}"] = None
        updates[f"H{tpl_row}"] = None
        tpl_row += 1

    return updates


# ── xlsx XML patching ──────────────────────────────────────────────────────────

def _wb_rels_map(wb_rels_xml: bytes) -> Dict[str, str]:
    root = etree.fromstring(wb_rels_xml)
    return {
        r.get("Id"): r.get("Target")
        for r in root.iter(f"{{{NS_PKG}}}Relationship")
    }


def _patch_workbook(wb_xml: bytes) -> bytes:
    """Remove print area defined names so LibreOffice exports the full sheet."""
    root = etree.fromstring(wb_xml)
    defined_names = root.find(f"{{{NS_SS}}}definedNames")
    if defined_names is not None:
        for dn in list(defined_names):
            if dn.get("name", "").upper() == "_XLNM.PRINT_AREA":
                defined_names.remove(dn)
        if len(defined_names) == 0:
            root.remove(defined_names)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _patch_sheet_cells(sheet_xml: bytes, updates: Dict[str, Optional[str]]) -> bytes:
    root = etree.fromstring(sheet_xml)
    cell_map: Dict[str, etree._Element] = {}
    row_map:  Dict[int, etree._Element] = {}

    sheet_data = root.find(f"{{{NS_SS}}}sheetData")
    if sheet_data is None:
        return sheet_xml

    for row_el in sheet_data.findall(f"{{{NS_SS}}}row"):
        rnum = int(row_el.get("r", "0"))
        row_map[rnum] = row_el
        for c_el in row_el.findall(f"{{{NS_SS}}}c"):
            ref = c_el.get("r", "")
            if ref:
                cell_map[ref.upper()] = c_el

    for raw_coord, value in updates.items():
        coord   = raw_coord.upper().strip()
        row_num = int(re.sub(r"\D", "", coord))

        if coord in cell_map:
            c_el = cell_map[coord]
        else:
            if row_num not in row_map:
                row_el = etree.SubElement(sheet_data, f"{{{NS_SS}}}row")
                row_el.set("r", str(row_num))
                row_map[row_num] = row_el
            c_el = etree.SubElement(row_map[row_num], f"{{{NS_SS}}}c")
            c_el.set("r", coord)
            cell_map[coord] = c_el

        for child in list(c_el):
            if etree.QName(child).localname in ("v", "is", "f"):
                c_el.remove(child)

        if value:
            c_el.set("t", "inlineStr")
            is_el = etree.SubElement(c_el, f"{{{NS_SS}}}is")
            t_el  = etree.SubElement(is_el, f"{{{NS_SS}}}t")
            t_el.text = str(value)
        else:
            c_el.attrib.pop("t", None)

    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _build_patched_xlsx(
    template_path: Path,
    sheet_name: str,
    updates: Dict[str, Optional[str]],
) -> bytes:
    with zipfile.ZipFile(template_path, "r") as zin:
        wb_xml      = zin.read("xl/workbook.xml")
        wb_rels_xml = zin.read("xl/_rels/workbook.xml.rels")

        rid_to_target = _wb_rels_map(wb_rels_xml)
        wb_root       = etree.fromstring(wb_xml)
        sheet_rid     = None
        for sh in wb_root.iter(f"{{{NS_SS}}}sheet"):
            if sh.get("name") == sheet_name:
                sheet_rid = sh.get(f"{{{NS_R}}}id")
                break
        if not sheet_rid:
            raise ValueError(f"Sheet '{sheet_name}' not found in {template_path.name}")

        sheet_rel  = rid_to_target.get(sheet_rid)
        sheet_path = f"xl/{sheet_rel}"

        patched_wb = _patch_workbook(wb_xml)
        patched_ws = _patch_sheet_cells(zin.read(sheet_path), updates)

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                if item.filename == "xl/workbook.xml":
                    zout.writestr(item, patched_wb)
                elif item.filename == sheet_path:
                    zout.writestr(item, patched_ws)
                else:
                    zout.writestr(item, zin.read(item.filename))

    out.seek(0)
    return out.read()


# ── LibreOffice PDF conversion ─────────────────────────────────────────────────

def _xlsx_to_pdf(xlsx_path: str, out_dir: str, stem: str) -> str:
    env    = {**os.environ, "HOME": out_dir}
    result = subprocess.run(
        ["libreoffice", "--headless", "--nologo", "--norestore",
         "--convert-to", "pdf:calc_pdf_Export",
         "--outdir", out_dir, xlsx_path],
        capture_output=True, text=True, timeout=90, env=env,
    )
    logger.info("LibreOffice: %s", result.stdout.strip())
    if result.returncode != 0:
        logger.error("LibreOffice stderr: %s", result.stderr)
        raise RuntimeError(f"LibreOffice failed (rc={result.returncode}): {result.stderr}")

    pdf_path = os.path.join(out_dir, f"{stem}.pdf")
    if not os.path.exists(pdf_path):
        raise RuntimeError(f"PDF not produced. stdout={result.stdout!r}")

    logger.info("PDF: %s (%d bytes)", pdf_path, os.path.getsize(pdf_path))
    return pdf_path


# ── Endpoint ───────────────────────────────────────────────────────────────────

@router.post("/export")
def export_work_order(req: WorkOrderExportRequest, background_tasks: BackgroundTasks):
    code = req.companyCode.strip().upper()
    if code not in TEMPLATE_CONFIG:
        code = "GRP"
    filename, sheet_name = TEMPLATE_CONFIG[code]
    template_path = TEMPLATE_DIR / filename

    if not template_path.exists():
        raise HTTPException(500, detail=f"Template not found: {template_path}")

    raw_stem = req.workOrderNumber.split("/")[-1].strip()
    stem     = re.sub(r"[^\w\-]", "_", raw_stem) if raw_stem else "work_order"

    # ── Split long fields into line 1 / line 2 ───────────────────────────────
    # Cell widths measured from template: C:F ≈ 36.7 → ~31 visible chars per line
    # J:M ≈ 41.6 → ~37 visible chars per line
    name_l1,    name_l2    = _split2(req.companyName,      max_chars=31)
    addr_l1,    addr_l2    = _split2(req.companyAddress,   max_chars=31)
    loc_l1,     loc_l2     = _split2(req.deliveryLocation, max_chars=37)

    updates: Dict[str, Optional[str]] = {
        # ── Header ───────────────────────────────────────────────────────────
        "L5":  req.workOrderNumber,
        "C7":  req.customerId or None,
        "G7":  req.invoiceNo or None,
        "L7":  _fmt(req.invoiceDate or ""),
        "C8":  req.salesPerson or None,
        "L8":  _fmt(req.woDate),

        # ── Company Details (rows 11-17) ──────────────────────────────────────
        "C11": name_l1,
        "C12": name_l2,
        "C13": req.companyContactName or None,
        "C14": addr_l1,
        "C15": addr_l2,
        "C16": req.companyPhone or None,
        "C17": req.companyEmail or None,

        # ── Delivery Details (rows 11-15) ─────────────────────────────────────
        "J11": loc_l1,
        "J12": loc_l2,
        "J13": req.deliveryContactName or None,
        "J14": req.deliveryContactNumber or None,
        "J15": _fmt(req.installationCompletionDate),

        # ── Specifications (row 20) ───────────────────────────────────────────
        "A20": req.brand or None,
        "C20": _joined((req.typeInsulated,    "Insulated"),
                       (req.typeNonInsulated, "Non-Insulated")),
        "E20": _joined((req.skidHollow, "Hollow"), (req.skidIBeam, "I-Beam")),
        "G20": _joined((req.indicatorTube, "Tube"), (req.indicatorScale, "Scale")),
        "K20": _joined((req.ladderInternal, "Internal"), (req.ladderExternal, "External")),
        "M20": _joined((req.supportInternal, "Internal"), (req.supportExternal, "External")),

        # ── Services (row 21) ────────────────────────────────────────────────
        "A21": "Supply"                  if req.supply              else None,
        "D21": "Installation"            if req.installation        else None,
        "G21": "Testing / Commissioning" if req.testingCommissioning else None,
        "K21": "Maintenance"             if req.maintenance         else None,

        # ── Job Description (row 23) ─────────────────────────────────────────
        "C23": req.jobDescription or None,
    }

    # ── Items (rows 25-39, with remarks word-wrap) ────────────────────────────
    updates.update(_build_item_updates(req.items, start_row=25, total_rows=15))

    tmp_dir   = tempfile.mkdtemp(prefix="wo_export_")
    background_tasks.add_task(shutil.rmtree, tmp_dir, True)
    xlsx_path = os.path.join(tmp_dir, f"{stem}.xlsx")

    try:
        patched = _build_patched_xlsx(template_path, sheet_name, updates)
        logger.info("Patched xlsx: %d bytes (%s)", len(patched), sheet_name)

        with open(xlsx_path, "wb") as fh:
            fh.write(patched)

        pdf_path = _xlsx_to_pdf(xlsx_path, tmp_dir, stem)

    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Export failed")
        raise HTTPException(status_code=500, detail=str(exc))

    return FileResponse(
        path=pdf_path,
        media_type="application/pdf",
        filename=f"{stem}.pdf",
        headers={"Access-Control-Expose-Headers": "Content-Disposition"},
    )
