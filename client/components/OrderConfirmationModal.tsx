import { useState } from 'react';
import { X, Save, ClipboardCheck } from 'lucide-react';
import { OrderConfirmationFormData, defaultOrderConfirmationForm } from '@/types';

interface Props {
  workOrder: string;
  existing?: OrderConfirmationFormData;
  canEdit: boolean;
  onSave: (data: OrderConfirmationFormData) => void;
  onClose: () => void;
}

/* ─── Small reusable primitives ─── */

const inputCls = (disabled: boolean) =>
  `w-full px-3 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${
    disabled ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed' : 'bg-white border-gray-300 text-gray-900'
  }`;

const YesNo = ({
  value,
  onChange,
  disabled,
}: {
  value: 'yes' | 'no' | '';
  onChange: (v: 'yes' | 'no') => void;
  disabled: boolean;
}) => (
  <div className="flex gap-4">
    {(['yes', 'no'] as const).map((opt) => (
      <label key={opt} className={`flex items-center gap-1.5 cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value === opt}
          onChange={() => onChange(opt)}
          className="w-4 h-4 rounded accent-blue-600"
        />
        <span className="text-sm font-semibold text-gray-700 uppercase">{opt}</span>
      </label>
    ))}
  </div>
);

const CB = ({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) => (
  <label className={`flex items-center gap-1.5 cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
    <input
      type="checkbox"
      disabled={disabled}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded accent-blue-600"
    />
    <span className="text-sm text-gray-700">{label}</span>
  </label>
);

const RowLabel = ({ children }: { children: React.ReactNode }) => (
  <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide whitespace-nowrap">{children}</span>
);

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs font-bold text-blue-800 uppercase tracking-widest border-b border-blue-200 pb-1 mb-3">{children}</p>
);

/* ─── Main Component ─── */

export default function OrderConfirmationModal({ workOrder, existing, canEdit, onSave, onClose }: Props) {
  const [form, setForm] = useState<OrderConfirmationFormData>(existing ?? defaultOrderConfirmationForm());

  const set = <K extends keyof OrderConfirmationFormData>(key: K, value: OrderConfirmationFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const disabled = !canEdit;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-hidden flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-700 to-blue-500">
          <div className="flex items-center gap-3">
            <ClipboardCheck className="w-6 h-6 text-white opacity-80" />
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">ORDER CONFIRMATION FORM</h2>
              <p className="text-blue-200 text-sm">Work Order: {workOrder}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-blue-600 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* ── Row 1: Header fields ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Work Order</label>
              <input type="text" readOnly value={workOrder} className="w-full px-3 py-1.5 rounded border border-gray-200 bg-gray-50 text-sm font-semibold text-gray-700 cursor-not-allowed" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">LPO No <span className="text-gray-400 normal-case font-normal">(optional)</span></label>
              <input type="text" disabled={disabled} value={form.lpoNo ?? ''} onChange={(e) => set('lpoNo', e.target.value)} placeholder="LPO-0001" className={inputCls(disabled)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">QTN No <span className="text-gray-400 normal-case font-normal">(optional)</span></label>
              <input type="text" disabled={disabled} value={form.qtnNo ?? ''} onChange={(e) => set('qtnNo', e.target.value)} placeholder="QUO/2026/001" className={inputCls(disabled)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Date <span className="text-gray-400 normal-case font-normal">(optional)</span></label>
              <input type="date" disabled={disabled} value={form.date ?? ''} onChange={(e) => set('date', e.target.value)} className={inputCls(disabled)} />
            </div>
          </div>

          {/* ── LPO Term Confirmations ── */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
            <SectionTitle>Did You Confirm the Following Terms in the LPO?</SectionTitle>
            <div className="space-y-3">
              {[
                { label: 'Tank Brand, Size, Type Value?', key: 'tankBrandSizeTypeValue' as const },
                { label: 'Payment Terms?', key: 'paymentTermsConfirmed' as const },
                { label: 'Other Terms & Condition?', key: 'otherTermsCondition' as const },
              ].map(({ label, key }) => (
                <div key={key} className="flex items-center justify-between gap-4">
                  <span className="text-sm font-medium text-gray-700">{label}</span>
                  <YesNo value={form[key]} onChange={(v) => set(key, v)} disabled={disabled} />
                </div>
              ))}
            </div>
            <div className="mt-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Mention if there any Penalty / Conditions / Time Period in the LPO</label>
              <input type="text" disabled={disabled} value={form.penaltyConditionsNote} onChange={(e) => set('penaltyConditionsNote', e.target.value)} placeholder="Enter details..." className={inputCls(disabled)} />
            </div>
          </div>

          {/* ── Payment Terms ── */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-4">
            <SectionTitle>Details of Payment Terms</SectionTitle>

            {/* Advance */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>Advance</RowLabel>
              <input type="text" disabled={disabled} value={form.advancePercent} onChange={(e) => set('advancePercent', e.target.value)} placeholder="%" className={`w-20 px-2 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300'}`} />
              <CB label="%CDC" checked={form.advanceCDC} onChange={(v) => set('advanceCDC', v)} disabled={disabled} />
              <CB label="%PDC" checked={form.advancePDC} onChange={(v) => set('advancePDC', v)} disabled={disabled} />
            </div>

            {/* Payment Collection */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>Payment Collection</RowLabel>
              <CB label="From Site" checked={form.paymentCollectionFromSite} onChange={(v) => set('paymentCollectionFromSite', v)} disabled={disabled} />
              <CB label="Or Office" checked={form.paymentCollectionFromOffice} onChange={(v) => set('paymentCollectionFromOffice', v)} disabled={disabled} />
            </div>

            {/* Delivery */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>Delivery</RowLabel>
              <input type="text" disabled={disabled} value={form.deliveryPercent} onChange={(e) => set('deliveryPercent', e.target.value)} placeholder="%" className={`w-20 px-2 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300'}`} />
              <CB label="%CDC" checked={form.deliveryCDC} onChange={(v) => set('deliveryCDC', v)} disabled={disabled} />
              <CB label="%PDC" checked={form.deliveryPDC} onChange={(v) => set('deliveryPDC', v)} disabled={disabled} />
              <CB label="Before" checked={form.deliveryBefore} onChange={(v) => set('deliveryBefore', v)} disabled={disabled} />
              <CB label="After" checked={form.deliveryAfter} onChange={(v) => set('deliveryAfter', v)} disabled={disabled} />
            </div>

            {/* Security Cheque */}
            <div className="flex items-center gap-6 flex-wrap">
              <RowLabel>Security Cheque Requirement</RowLabel>
              <YesNo value={form.securityChequeRequired} onChange={(v) => set('securityChequeRequired', v)} disabled={disabled} />
            </div>

            {/* When will it recollect */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>When Will It Recollect</RowLabel>
              <input type="text" disabled={disabled} value={form.whenRecollect} onChange={(e) => set('whenRecollect', e.target.value)} placeholder="Enter date / condition..." className={`flex-1 min-w-[180px] px-3 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300 bg-white'}`} />
            </div>

            {/* Work in Progress */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>Work in Progress</RowLabel>
              <input type="text" disabled={disabled} value={form.workInProgressPercent} onChange={(e) => set('workInProgressPercent', e.target.value)} placeholder="%" className={`w-20 px-2 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300'}`} />
              <span className="text-sm text-gray-500">%</span>
            </div>

            {/* Completion / Testing / Retention */}
            {[
              {
                label: 'Completion',
                amountKey: 'completionAmount' as const,
                cdcKey: 'completionCDC' as const,
                pdcKey: 'completionPDC' as const,
              },
              {
                label: 'Testing & Commissioning',
                amountKey: 'testingCommissioningAmount' as const,
                cdcKey: 'testingCommissioningCDC' as const,
                pdcKey: 'testingCommissioningPDC' as const,
              },
              {
                label: 'Retention',
                amountKey: 'retentionAmount' as const,
                cdcKey: 'retentionCDC' as const,
                pdcKey: 'retentionPDC' as const,
              },
            ].map(({ label, amountKey, cdcKey, pdcKey }) => (
              <div key={label} className="flex items-center gap-4 flex-wrap">
                <RowLabel>{label}</RowLabel>
                <input type="text" disabled={disabled} value={form[amountKey]} onChange={(e) => set(amountKey, e.target.value)} placeholder="Amount" className={`w-28 px-2 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300'}`} />
                <CB label="%CDC" checked={form[cdcKey]} onChange={(v) => set(cdcKey, v)} disabled={disabled} />
                <CB label="%PDC" checked={form[pdcKey]} onChange={(v) => set(pdcKey, v)} disabled={disabled} />
              </div>
            ))}

            {/* Other Committed Terms */}
            <div className="flex items-center gap-4 flex-wrap">
              <RowLabel>Other Committed Terms</RowLabel>
              <input type="text" disabled={disabled} value={form.otherCommittedTerms} onChange={(e) => set('otherCommittedTerms', e.target.value)} placeholder="Enter details..." className={`flex-1 min-w-[180px] px-3 py-1.5 rounded border text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 ${disabled ? 'bg-gray-100 border-gray-200' : 'border-gray-300 bg-white'}`} />
            </div>
          </div>

          {/* ── Accounts Contact ── */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <SectionTitle>Accounts Contact Person Details</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Name', key: 'accountsName' as const, placeholder: 'Full Name' },
                { label: 'Email ID', key: 'accountsEmail' as const, placeholder: 'email@example.com' },
                { label: 'Tel / Mob', key: 'accountsTelMob' as const, placeholder: '+971 00 000 0000' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{label}</label>
                  <input type="text" disabled={disabled} value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className={inputCls(disabled)} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Document Handovering ── */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <SectionTitle>Details of Document Handovering</SectionTitle>
            <div className="space-y-3">
              <div className="flex items-center gap-6 flex-wrap">
                <span className="text-sm font-medium text-gray-700">1. Invoice Submission</span>
                <CB label="Office" checked={form.invoiceSubmissionOffice} onChange={(v) => set('invoiceSubmissionOffice', v)} disabled={disabled} />
                <CB label="Site" checked={form.invoiceSubmissionSite} onChange={(v) => set('invoiceSubmissionSite', v)} disabled={disabled} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">2. Warranty & Operational Manual Submission Time</label>
                <input type="text" disabled={disabled} value={form.warrantyManualSubmissionTime} onChange={(e) => set('warrantyManualSubmissionTime', e.target.value)} placeholder="e.g. Within 30 days of delivery" className={inputCls(disabled)} />
              </div>
            </div>
          </div>

          {/* ── Project Contact ── */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <SectionTitle>Project Contact Person Details</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Name', key: 'projectName' as const, placeholder: 'Full Name' },
                { label: 'Email ID', key: 'projectEmail' as const, placeholder: 'email@example.com' },
                { label: 'Tel / Mob', key: 'projectTelMob' as const, placeholder: '+971 00 000 0000' },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">{label}</label>
                  <input type="text" disabled={disabled} value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} className={inputCls(disabled)} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Signatories ── */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 space-y-3">
            <SectionTitle>Above Details Are Confirmed By</SectionTitle>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Sales Executive</label>
                <input type="text" disabled={disabled} value={form.salesExecutiveName} onChange={(e) => set('salesExecutiveName', e.target.value)} placeholder="Sales Executive Name" className={inputCls(disabled)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Manager</label>
                <input type="text" disabled={disabled} value={form.managerName} onChange={(e) => set('managerName', e.target.value)} placeholder="Manager Name" className={inputCls(disabled)} />
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button onClick={() => onSave(form)} className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
              <Save className="w-4 h-4" />
              Save Confirmation
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
