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

// ─── Drawing helpers ─────────────────────────────────────────────────────────

type PDFPage = Awaited<ReturnType<PDFDocument['addPage']>>;
type PDFFont = Awaited<ReturnType<PDFDocument['embedFont']>>;

/**
 * Draw text inside a field box.
 * Coordinates are in PDF units (y = 0 at page bottom).
 * We add small inset margins so text sits cleanly inside the box.
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

  // Truncate string if it exceeds maxWidth to avoid overflow
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
 * Draw a check-mark (✓) inside a checkbox cell when `checked` is true.
 */
function drawCheck(
  page: PDFPage,
  font: PDFFont,
  checked: boolean,
  x: number,
  y: number,
) {
  if (!checked) return;
  page.drawText('X', {
    x: x + 0.5,
    y: y + 0.5,
    size: 6,
    font,
    color: rgb(0, 0, 0),
  });
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportOrderConfirmationPdf(card: Card): Promise<void> {
  const oc: OrderConfirmationFormData | undefined = card.orderConfirmationDetails;

  // Build the work-order display string used both as header text and filename
  const woDisplay = `${card.companyCode || 'GRP'}/${card.workOrderNumber || '0000'}`;
  const fileName  = `${woDisplay.replace('/', '-')}.pdf`;

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
  // WORK ORDER  (x=140, y=683, w=128, h=19)
  drawText(page, font, woDisplay,           140, 683, { size: 8, maxWidth: 128 });
  // LPO NO      (x=341, y=683, w=208, h=19)
  drawText(page, font, oc?.lpoNo ?? '',     341, 683, { size: 8, maxWidth: 208 });
  // QTN NO      (x=92,  y=650, w=175, h=20)
  drawText(page, font, oc?.qtnNo ?? '',      92, 650, { size: 8, maxWidth: 175 });
  // DATE        (x=342, y=650, w=208, h=19)
  drawText(page, font, oc?.date ?? '',      342, 650, { size: 8, maxWidth: 208 });

  // ── LPO Confirmations ─────────────────────────────────────────────────────
  // TANK BRAND, SIZE, TYPE VALUE?
  drawCheck(page, font, oc?.tankBrandSizeTypeValue === 'yes', 341, 608);
  drawCheck(page, font, oc?.tankBrandSizeTypeValue === 'no',  436, 607);
  // PAYMENT TERMS?
  drawCheck(page, font, oc?.paymentTermsConfirmed === 'yes',  341, 597);
  drawCheck(page, font, oc?.paymentTermsConfirmed === 'no',   435, 596);
  // OTHER TERMS & CONDITION?
  drawCheck(page, font, oc?.otherTermsCondition === 'yes',    340, 585);
  drawCheck(page, font, oc?.otherTermsCondition === 'no',     437, 586);

  // PENALTY/CONDITIONS/TIME PERIOD NOTE (x=268, y=566, w=282, h=14)
  drawText(page, font, oc?.penaltyConditionsNote ?? '', 268, 566, { size: 7, maxWidth: 282 });

  // ── Advance ───────────────────────────────────────────────────────────────
  // %CDC number (x=171, y=516, w=26, h=17)
  drawText(page, font, oc?.advanceCDC ? (oc?.advancePercent ?? '') : '', 171, 516, { size: 8, maxWidth: 26 });
  drawCheck(page, font, oc?.advanceCDC ?? false, 226, 516);
  // %PDC number (x=296, y=515, w=20, h=13)
  drawText(page, font, oc?.advancePDC ? (oc?.advancePercent ?? '') : '', 296, 515, { size: 8, maxWidth: 20 });
  drawCheck(page, font, oc?.advancePDC ?? false, 344, 516);

  // ── Payment Collection ────────────────────────────────────────────────────
  drawCheck(page, font, oc?.paymentCollectionFromSite   ?? false, 226, 497);
  drawCheck(page, font, oc?.paymentCollectionFromOffice ?? false, 344, 498);

  // ── Delivery ──────────────────────────────────────────────────────────────
  // %CDC number (x=176, y=479, w=22, h=14)
  drawText(page, font, oc?.deliveryCDC ? (oc?.deliveryPercent ?? '') : '', 176, 479, { size: 8, maxWidth: 22 });
  drawCheck(page, font, oc?.deliveryCDC   ?? false, 226, 479);
  // %PDC number (x=296, y=479, w=22, h=15)
  drawText(page, font, oc?.deliveryPDC ? (oc?.deliveryPercent ?? '') : '', 296, 479, { size: 8, maxWidth: 22 });
  drawCheck(page, font, oc?.deliveryPDC   ?? false, 344, 479);
  drawCheck(page, font, oc?.deliveryBefore ?? false, 438, 480);
  drawCheck(page, font, oc?.deliveryAfter  ?? false, 520, 479);

  // ── Security Cheque ───────────────────────────────────────────────────────
  drawCheck(page, font, oc?.securityChequeRequired === 'yes', 226, 462);
  drawCheck(page, font, oc?.securityChequeRequired === 'no',  344, 461);

  // WHEN WILL IT RECOLLECT (x=140, y=444, w=245, h=12)
  drawText(page, font, oc?.whenRecollect ?? '', 140, 444, { size: 8, maxWidth: 245 });

  // WORK IN PROGRESS % (x=142, y=426, w=236, h=12)
  const wipDisplay = oc?.workInProgressPercent ? `${oc.workInProgressPercent} %` : '';
  drawText(page, font, wipDisplay, 142, 426, { size: 8, maxWidth: 236 });

  // ── Completion ────────────────────────────────────────────────────────────
  drawText(page, font, oc?.completionAmount ?? '',       177, 408, { size: 8, maxWidth: 93 });
  drawCheck(page, font, oc?.completionCDC ?? false,      344, 407);
  drawCheck(page, font, oc?.completionPDC ?? false,      476, 407);

  // ── Testing & Commissioning ───────────────────────────────────────────────
  drawText(page, font, oc?.testingCommissioningAmount ?? '', 177, 389, { size: 8, maxWidth: 93 });
  drawCheck(page, font, oc?.testingCommissioningCDC ?? false, 344, 389);
  drawCheck(page, font, oc?.testingCommissioningPDC ?? false, 476, 390);

  // ── Retention ─────────────────────────────────────────────────────────────
  drawText(page, font, oc?.retentionAmount ?? '', 176, 372, { size: 8, maxWidth: 92 });
  drawCheck(page, font, oc?.retentionCDC ?? false, 345, 370);
  drawCheck(page, font, oc?.retentionPDC ?? false, 475, 372);

  // OTHER COMMITTED TERMS (x=176, y=351, w=375, h=14)
  drawText(page, font, oc?.otherCommittedTerms ?? '', 176, 351, { size: 7, maxWidth: 375 });

  // ── Accounts Contact ──────────────────────────────────────────────────────
  drawText(page, font, oc?.accountsName    ?? '',  91, 301, { size: 8, maxWidth: 295 });
  drawText(page, font, oc?.accountsEmail   ?? '',  91, 286, { size: 8, maxWidth: 296 });
  drawText(page, font, oc?.accountsTelMob  ?? '',  91, 268, { size: 8, maxWidth: 297 });

  // ── Document Handovering ──────────────────────────────────────────────────
  drawCheck(page, font, oc?.invoiceSubmissionOffice ?? false, 342, 225);
  drawCheck(page, font, oc?.invoiceSubmissionSite   ?? false, 434, 225);
  // WARRANTY & OPERATIONAL MANUAL SUBMISSION TIME (x=248, y=201, w=104, h=16)
  drawText(page, font, oc?.warrantyManualSubmissionTime ?? '', 248, 201, { size: 7, maxWidth: 104 });

  // ── Project Contact ───────────────────────────────────────────────────────
  drawText(page, font, oc?.projectName   ?? '',  90, 159, { size: 8, maxWidth: 298 });
  drawText(page, font, oc?.projectEmail  ?? '',  91, 143, { size: 8, maxWidth: 296 });
  drawText(page, font, oc?.projectTelMob ?? '',  91, 129, { size: 8, maxWidth: 296 });

  // ── Signatures ────────────────────────────────────────────────────────────
  // SALES EXECUTIVE (x=138, y=87, w=130, h=13)
  drawText(page, font, card.salesPerson ?? '', 138, 87, { size: 8, maxWidth: 130 });

  // ── Serialize & trigger download ─────────────────────────────────────────
  const savedBytes = await pdfDoc.save();
  const blob = new Blob([savedBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);

  const anchor      = document.createElement('a');
  anchor.href       = url;
  anchor.download   = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Free the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
