/**
 * fillOrderConfirmationPdf.ts
 *
 * Fills the appropriate Order Confirmation PDF template with data from a card
 * and triggers a browser download named after the work order number.
 *
 * Templates (served from /Public/order conformation Forms/):
 *   CLX   → COLEX ORDER CONFIRMATION FORM.pdf
 *   GRP   → GRP ORDER CONFIRMATION FORM.pdf
 *   GRPPT → PIPECO ORDER CONFIRMATION FORM.pdf
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { Card, OrderConfirmationFormData } from '@/types';

// ─── Template URLs (encoded for browser fetch) ──────────────────────────────

const TEMPLATE_URLS: Record<string, string> = {
  CLX:   '/order%20conformation%20Forms/COLEX%20ORDER%20CONFIRMATION%20FORM.pdf',
  GRP:   '/order%20conformation%20Forms/GRP%20ORDER%20CONFIRMATION%20FORM.pdf',
  GRPPT: '/order%20conformation%20Forms/PIPECO%20ORDER%20CONFIRMATION%20FORM.pdf',
};

function getTemplateUrl(companyCode?: string): string {
  if (!companyCode) return TEMPLATE_URLS.GRP;
  return TEMPLATE_URLS[companyCode.toUpperCase()] ?? TEMPLATE_URLS.GRP;
}

// ─── Date formatter ───────────────────────────────────────────────────────────

/** Convert ISO "2026-02-27" → display "27-02-2026" */
function formatDate(iso?: string): string {
  if (!iso) return '';
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [yyyy, mm, dd] = parts;
  return `${dd}-${mm}-${yyyy}`;
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

type PDFPage = Awaited<ReturnType<PDFDocument['addPage']>>;
type PDFFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/**
 * Draw text inside a field box.
 * x, y = bottom-left of the box in PDF units (y increases upward).
 */
function drawText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  opts: { size?: number; maxWidth?: number } = {},
) {
  if (!text) return;
  const { size = 8, maxWidth } = opts;

  let str = text;
  if (maxWidth) {
    let w = font.widthOfTextAtSize(str, size);
    while (str.length > 1 && w > maxWidth - 4) {
      str = str.slice(0, -1);
      w = font.widthOfTextAtSize(str, size);
    }
  }

  page.drawText(str, {
    x: x + 2,
    y: y + 3,
    size,
    font,
    color: rgb(0, 0, 0),
  });
}

/**
 * Draw a vector tick-mark (✓) perfectly centred inside a checkbox.
 *
 * bx, by  = bottom-left corner of the checkbox (PDF coords, y upward)
 * bw, bh  = width and height of the checkbox in PDF units
 *
 * Two line segments form the tick:
 *   short down-left arm  →  valley point
 *   long  up-right arm   →  top-right point
 */
function drawTick(
  page: PDFPage,
  checked: boolean,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) {
  if (!checked) return;

  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const s  = Math.min(bw, bh) * 0.55; // scale relative to box size

  // Left arm start (middle-left)
  const lx = cx - s * 0.48;
  const ly = cy - s * 0.05;

  // Valley (bottom of the tick)
  const vx = cx - s * 0.05;
  const vy = cy - s * 0.38;

  // Right arm end (top-right)
  const rx = cx + s * 0.50;
  const ry = cy + s * 0.42;

  const thickness = Math.max(0.7, Math.min(bw, bh) * 0.12);
  const color = rgb(0, 0, 0);

  page.drawLine({ start: { x: lx, y: ly }, end: { x: vx, y: vy }, thickness, color });
  page.drawLine({ start: { x: vx, y: vy }, end: { x: rx, y: ry }, thickness, color });
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportOrderConfirmationPdf(card: Card): Promise<void> {
  const oc: OrderConfirmationFormData | undefined = card.orderConfirmationDetails;

  // Work order number only (no company-code prefix)
  const woNumber = card.workOrderNumber || '0000';
  const fileName = `${woNumber}.pdf`;

  // Fetch the template
  const templateUrl = getTemplateUrl(card.companyCode);
  const pdfBytes = await fetch(templateUrl).then((r) => {
    if (!r.ok) throw new Error(`Could not load PDF template: ${r.status} ${r.statusText}`);
    return r.arrayBuffer();
  });

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pages = pdfDoc.getPages();
  if (pages.length === 0) throw new Error('PDF template has no pages');
  const page = pages[0];

  // ── Header ────────────────────────────────────────────────────────────────
  // WORK ORDER  (x=140, y=683, w=128, h=19) — number only, no prefix
  drawText(page, font, woNumber,                   140, 683, { size: 8, maxWidth: 128 });
  // LPO NO      (x=341, y=683, w=208, h=19)
  drawText(page, font, oc?.lpoNo ?? '',            341, 683, { size: 8, maxWidth: 208 });
  // QTN NO      (x=92,  y=650, w=175, h=20)
  drawText(page, font, oc?.qtnNo ?? '',             92, 650, { size: 8, maxWidth: 175 });
  // DATE        (x=342, y=650, w=208, h=19) — formatted as DD-MM-YYYY
  drawText(page, font, formatDate(oc?.date),       342, 650, { size: 8, maxWidth: 208 });

  // ── LPO Confirmations ─────────────────────────────────────────────────────
  // TANK BRAND YES (x=341,y=608,w=6,h=6)  NO (x=436,y=607,w=6,h=7)
  drawTick(page, oc?.tankBrandSizeTypeValue === 'yes', 341, 608, 6, 6);
  drawTick(page, oc?.tankBrandSizeTypeValue === 'no',  436, 607, 6, 7);
  // PAYMENT TERMS YES (x=341,y=597,w=6,h=7)  NO (x=435,y=596,w=7,h=8)
  drawTick(page, oc?.paymentTermsConfirmed === 'yes',  341, 597, 6, 7);
  drawTick(page, oc?.paymentTermsConfirmed === 'no',   435, 596, 7, 8);
  // OTHER TERMS YES (x=340,y=585,w=7,h=8)  NO (x=437,y=586,w=7,h=7)
  drawTick(page, oc?.otherTermsCondition === 'yes',    340, 585, 7, 8);
  drawTick(page, oc?.otherTermsCondition === 'no',     437, 586, 7, 7);

  // PENALTY/CONDITIONS/TIME PERIOD NOTE (x=268, y=566, w=282, h=14)
  drawText(page, font, oc?.penaltyConditionsNote ?? '', 268, 566, { size: 7, maxWidth: 282 });

  // ── Advance ───────────────────────────────────────────────────────────────
  // % number (x=171,y=516,w=26,h=17)  CDC cb (x=226,y=516,w=7,h=7)
  // PDC % (x=296,y=515,w=20,h=13)     PDC cb (x=344,y=516,w=8,h=7)
  drawText(page, font, oc?.advanceCDC ? (oc?.advancePercent ?? '') : '', 171, 516, { size: 8, maxWidth: 26 });
  drawTick(page, oc?.advanceCDC ?? false,  226, 516, 7, 7);
  drawText(page, font, oc?.advancePDC ? (oc?.advancePercent ?? '') : '', 296, 515, { size: 8, maxWidth: 20 });
  drawTick(page, oc?.advancePDC ?? false,  344, 516, 8, 7);

  // ── Payment Collection ────────────────────────────────────────────────────
  // FROM SITE (x=226,y=497,w=8,h=8)  OR OFFICE (x=344,y=498,w=7,h=7)
  drawTick(page, oc?.paymentCollectionFromSite   ?? false, 226, 497, 8, 8);
  drawTick(page, oc?.paymentCollectionFromOffice ?? false, 344, 498, 7, 7);

  // ── Delivery ──────────────────────────────────────────────────────────────
  // CDC % (x=176,y=479,w=22,h=14)  CDC cb (x=226,y=479,w=9,h=8)
  // PDC % (x=296,y=479,w=22,h=15)  PDC cb (x=344,y=479,w=8,h=7)
  // BEFORE (x=438,y=480,w=7,h=7)   AFTER  (x=520,y=479,w=9,h=9)
  drawText(page, font, oc?.deliveryCDC ? (oc?.deliveryPercent ?? '') : '', 176, 479, { size: 8, maxWidth: 22 });
  drawTick(page, oc?.deliveryCDC   ?? false, 226, 479, 9, 8);
  drawText(page, font, oc?.deliveryPDC ? (oc?.deliveryPercent ?? '') : '', 296, 479, { size: 8, maxWidth: 22 });
  drawTick(page, oc?.deliveryPDC   ?? false, 344, 479, 8, 7);
  drawTick(page, oc?.deliveryBefore ?? false, 438, 480, 7, 7);
  drawTick(page, oc?.deliveryAfter  ?? false, 520, 479, 9, 9);

  // ── Security Cheque ───────────────────────────────────────────────────────
  // YES (x=226,y=462,w=7,h=7)  NO (x=344,y=461,w=8,h=7)
  drawTick(page, oc?.securityChequeRequired === 'yes', 226, 462, 7, 7);
  drawTick(page, oc?.securityChequeRequired === 'no',  344, 461, 8, 7);

  // WHEN WILL IT RECOLLECT (x=140, y=444, w=245, h=12)
  drawText(page, font, oc?.whenRecollect ?? '', 140, 444, { size: 8, maxWidth: 245 });

  // WORK IN PROGRESS % (x=142, y=426, w=236, h=12)
  const wipDisplay = oc?.workInProgressPercent ? `${oc.workInProgressPercent} %` : '';
  drawText(page, font, wipDisplay, 142, 426, { size: 8, maxWidth: 236 });

  // ── Completion (x=177,y=408,w=93,h=12)  CDC (x=344,y=407,w=9,h=8)  PDC (x=476,y=407,w=8,h=8)
  drawText(page, font, oc?.completionAmount ?? '',    177, 408, { size: 8, maxWidth: 93 });
  drawTick(page, oc?.completionCDC ?? false,          344, 407, 9, 8);
  drawTick(page, oc?.completionPDC ?? false,          476, 407, 8, 8);

  // ── Testing & Commissioning (x=177,y=389,w=93,h=12)  CDC (x=344,y=389,w=8,h=8)  PDC (x=476,y=390,w=7,h=7)
  drawText(page, font, oc?.testingCommissioningAmount ?? '', 177, 389, { size: 8, maxWidth: 93 });
  drawTick(page, oc?.testingCommissioningCDC ?? false,       344, 389, 8, 8);
  drawTick(page, oc?.testingCommissioningPDC ?? false,       476, 390, 7, 7);

  // ── Retention (x=176,y=372,w=92,h=14)  CDC (x=345,y=370,w=9,h=9)  PDC (x=475,y=372,w=8,h=7)
  drawText(page, font, oc?.retentionAmount ?? '', 176, 372, { size: 8, maxWidth: 92 });
  drawTick(page, oc?.retentionCDC ?? false,       345, 370, 9, 9);
  drawTick(page, oc?.retentionPDC ?? false,       475, 372, 8, 7);

  // OTHER COMMITTED TERMS (x=176, y=351, w=375, h=14)
  drawText(page, font, oc?.otherCommittedTerms ?? '', 176, 351, { size: 7, maxWidth: 375 });

  // ── Accounts Contact ──────────────────────────────────────────────────────
  drawText(page, font, oc?.accountsName    ?? '',  91, 301, { size: 8, maxWidth: 295 });
  drawText(page, font, oc?.accountsEmail   ?? '',  91, 286, { size: 8, maxWidth: 296 });
  drawText(page, font, oc?.accountsTelMob  ?? '',  91, 268, { size: 8, maxWidth: 297 });

  // ── Document Handovering ──────────────────────────────────────────────────
  // OFFICE (x=342,y=225,w=7,h=8)  SITE (x=434,y=225,w=9,h=7)
  drawTick(page, oc?.invoiceSubmissionOffice ?? false, 342, 225, 7, 8);
  drawTick(page, oc?.invoiceSubmissionSite   ?? false, 434, 225, 9, 7);
  // WARRANTY & OPERATIONAL MANUAL SUBMISSION TIME (x=248, y=201, w=104, h=16)
  drawText(page, font, oc?.warrantyManualSubmissionTime ?? '', 248, 201, { size: 7, maxWidth: 104 });

  // ── Project Contact ───────────────────────────────────────────────────────
  drawText(page, font, oc?.projectName   ?? '',  90, 159, { size: 8, maxWidth: 298 });
  drawText(page, font, oc?.projectEmail  ?? '',  91, 143, { size: 8, maxWidth: 296 });
  drawText(page, font, oc?.projectTelMob ?? '',  91, 129, { size: 8, maxWidth: 296 });

  // ── Signatories ───────────────────────────────────────────────────────────
  // SALES EXECUTIVE (x=138, y=87, w=130, h=13)
  drawText(page, font, oc?.salesExecutiveName ?? '', 138, 87, { size: 8, maxWidth: 130 });
  // MANAGER (x=387, y=87, w=164, h=10)
  drawText(page, font, oc?.managerName ?? '',        387, 87, { size: 8, maxWidth: 164 });

  // ── Serialize & trigger download ─────────────────────────────────────────
  const savedBytes = await pdfDoc.save();
  const blob = new Blob([savedBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);

  const anchor         = document.createElement('a');
  anchor.href          = url;
  anchor.download      = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
