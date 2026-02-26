import { useState } from 'react';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { WorkOrderFormData, WorkOrderItem, defaultWorkOrderForm } from '@/types';

interface Props {
  workOrderNumber: string;
  companyCode: string;
  salesPerson: string;
  quoteNumber: string;
  existing?: WorkOrderFormData;
  canEdit: boolean;
  onSave: (data: WorkOrderFormData) => void;
  onClose: () => void;
}

const CheckBox = ({
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
  <label className={`flex items-center gap-1.5 cursor-pointer select-none ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500"
    />
    <span className="text-sm font-medium text-gray-700">{label}</span>
  </label>
);

const Field = ({
  label,
  children,
  optional,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  optional?: boolean;
  className?: string;
}) => (
  <div className={className}>
    <label className="block text-xs font-semibold text-gray-600 mb-1 uppercase tracking-wide">
      {label}
      {optional && <span className="ml-1 text-gray-400 normal-case font-normal">(optional)</span>}
    </label>
    {children}
  </div>
);

const inputCls = (disabled: boolean) =>
  `w-full px-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 ${
    disabled
      ? 'bg-gray-50 border-gray-200 text-gray-600 cursor-not-allowed'
      : 'bg-white border-gray-300 text-gray-900'
  }`;

export default function WorkOrderFormModal({
  workOrderNumber,
  companyCode,
  salesPerson,
  quoteNumber,
  existing,
  canEdit,
  onSave,
  onClose,
}: Props) {
  const [form, setForm] = useState<WorkOrderFormData>(
    existing ?? defaultWorkOrderForm(workOrderNumber, salesPerson)
  );

  const set = <K extends keyof WorkOrderFormData>(key: K, value: WorkOrderFormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateItem = (index: number, field: keyof WorkOrderItem, value: string) => {
    const updated = form.items.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    );
    set('items', updated);
  };

  const addItem = () => {
    set('items', [
      ...form.items,
      { slNo: form.items.length + 1, itemDescription: '', qty: '', remarks: '' },
    ]);
  };

  const removeItem = (index: number) => {
    const updated = form.items
      .filter((_, i) => i !== index)
      .map((item, i) => ({ ...item, slNo: i + 1 }));
    set('items', updated.length ? updated : [{ slNo: 1, itemDescription: '', qty: '', remarks: '' }]);
  };

  const disabled = !canEdit;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-700 to-purple-500">
          <div>
            <h2 className="text-lg font-bold text-white tracking-wide">WORK ORDER</h2>
            <p className="text-purple-200 text-sm">
              {companyCode}/{workOrderNumber} &nbsp;|&nbsp; Quote: {quoteNumber || '—'}
            </p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-purple-600 transition-colors">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Row 1 — identifiers */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Field label="W.O. Date">
              <input
                type="date"
                disabled={disabled}
                value={form.woDate}
                onChange={(e) => set('woDate', e.target.value)}
                className={inputCls(disabled)}
              />
            </Field>
            <Field label="Customer ID" optional>
              <input
                type="text"
                disabled={disabled}
                value={form.customerId ?? ''}
                onChange={(e) => set('customerId', e.target.value)}
                placeholder="CID-0001"
                className={inputCls(disabled)}
              />
            </Field>
            <Field label="Invoice No" optional>
              <input
                type="text"
                disabled={disabled}
                value={form.invoiceNo ?? ''}
                onChange={(e) => set('invoiceNo', e.target.value)}
                placeholder="INV-0001"
                className={inputCls(disabled)}
              />
            </Field>
            <Field label="Invoice Date" optional>
              <input
                type="date"
                disabled={disabled}
                value={form.invoiceDate ?? ''}
                onChange={(e) => set('invoiceDate', e.target.value)}
                className={inputCls(disabled)}
              />
            </Field>
          </div>

          {/* Brand selector */}
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">Brand</p>
            <div className="flex gap-4">
              {(['PIPECO TANKS', 'COLEX TANKS'] as const).map((b) => (
                <label key={b} className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 cursor-pointer transition-all text-sm font-medium ${
                  form.brand === b ? 'border-purple-500 bg-purple-50 text-purple-800' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
                  <input
                    type="radio"
                    name="brand"
                    disabled={disabled}
                    checked={form.brand === b}
                    onChange={() => set('brand', b)}
                    className="accent-purple-600"
                  />
                  {b}
                </label>
              ))}
            </div>
          </div>

          {/* Company + Delivery Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Company Details */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
              <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Company Details</h4>
              <Field label="Name">
                <input type="text" disabled={disabled} value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Company Name" className={inputCls(disabled)} />
              </Field>
              <Field label="Contact Name">
                <input type="text" disabled={disabled} value={form.companyContactName} onChange={(e) => set('companyContactName', e.target.value)} placeholder="Contact Person" className={inputCls(disabled)} />
              </Field>
              <Field label="Address">
                <input type="text" disabled={disabled} value={form.companyAddress} onChange={(e) => set('companyAddress', e.target.value)} placeholder="Full Address" className={inputCls(disabled)} />
              </Field>
              <Field label="Phone">
                <input type="text" disabled={disabled} value={form.companyPhone} onChange={(e) => set('companyPhone', e.target.value)} placeholder="+971 00 000 0000" className={inputCls(disabled)} />
              </Field>
              <Field label="Email">
                <input type="email" disabled={disabled} value={form.companyEmail} onChange={(e) => set('companyEmail', e.target.value)} placeholder="email@example.com" className={inputCls(disabled)} />
              </Field>
            </div>

            {/* Delivery Details */}
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-200">
              <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide">Delivery Details</h4>
              <Field label="Date">
                <input type="date" disabled={disabled} value={form.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} className={inputCls(disabled)} />
              </Field>
              <Field label="Location">
                <input type="text" disabled={disabled} value={form.deliveryLocation} onChange={(e) => set('deliveryLocation', e.target.value)} placeholder="Delivery Location" className={inputCls(disabled)} />
              </Field>
              <Field label="Contact Name">
                <input type="text" disabled={disabled} value={form.deliveryContactName} onChange={(e) => set('deliveryContactName', e.target.value)} placeholder="Contact Person" className={inputCls(disabled)} />
              </Field>
              <Field label="Contact Number">
                <input type="text" disabled={disabled} value={form.deliveryContactNumber} onChange={(e) => set('deliveryContactNumber', e.target.value)} placeholder="+971 00 000 0000" className={inputCls(disabled)} />
              </Field>
              <Field label="Installation / Completion Date">
                <input type="date" disabled={disabled} value={form.installationCompletionDate} onChange={(e) => set('installationCompletionDate', e.target.value)} className={inputCls(disabled)} />
              </Field>
            </div>
          </div>

          {/* Specifications checkboxes */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
            <h4 className="font-semibold text-gray-800 text-sm uppercase tracking-wide mb-4">Specifications</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4">
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Type</p>
                <CheckBox label="Insulated" checked={form.typeInsulated} onChange={(v) => set('typeInsulated', v)} disabled={disabled} />
                <CheckBox label="Non-Insulated" checked={form.typeNonInsulated} onChange={(v) => set('typeNonInsulated', v)} disabled={disabled} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Skid</p>
                <CheckBox label="Hollow" checked={form.skidHollow} onChange={(v) => set('skidHollow', v)} disabled={disabled} />
                <CheckBox label="I-Beam" checked={form.skidIBeam} onChange={(v) => set('skidIBeam', v)} disabled={disabled} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Indicator</p>
                <CheckBox label="Tube" checked={form.indicatorTube} onChange={(v) => set('indicatorTube', v)} disabled={disabled} />
                <CheckBox label="Scale" checked={form.indicatorScale} onChange={(v) => set('indicatorScale', v)} disabled={disabled} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Ladder / GRP / HDG / SS</p>
                <CheckBox label="Internal" checked={form.ladderInternal} onChange={(v) => set('ladderInternal', v)} disabled={disabled} />
                <CheckBox label="External" checked={form.ladderExternal} onChange={(v) => set('ladderExternal', v)} disabled={disabled} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Support</p>
                <CheckBox label="Internal" checked={form.supportInternal} onChange={(v) => set('supportInternal', v)} disabled={disabled} />
                <CheckBox label="External" checked={form.supportExternal} onChange={(v) => set('supportExternal', v)} disabled={disabled} />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-500 uppercase">Services</p>
                <CheckBox label="Supply" checked={form.supply} onChange={(v) => set('supply', v)} disabled={disabled} />
                <CheckBox label="Installation" checked={form.installation} onChange={(v) => set('installation', v)} disabled={disabled} />
                <CheckBox label="Testing / Commissioning" checked={form.testingCommissioning} onChange={(v) => set('testingCommissioning', v)} disabled={disabled} />
                <CheckBox label="Maintenance" checked={form.maintenance} onChange={(v) => set('maintenance', v)} disabled={disabled} />
              </div>
            </div>
          </div>

          {/* Job Description */}
          <Field label="Job Description">
            <textarea
              rows={3}
              disabled={disabled}
              value={form.jobDescription}
              onChange={(e) => set('jobDescription', e.target.value)}
              placeholder="Describe the work to be done..."
              className={inputCls(disabled)}
            />
          </Field>

          {/* Items Table */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Items</p>
              {!disabled && (
                <button onClick={addItem} className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium rounded-lg transition-colors">
                  <Plus className="w-3.5 h-3.5" />
                  Add Row
                </button>
              )}
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 text-gray-600 uppercase text-xs">
                  <tr>
                    <th className="px-3 py-2 text-left w-12">Sl.</th>
                    <th className="px-3 py-2 text-left">Item Description</th>
                    <th className="px-3 py-2 text-left w-24">QTY</th>
                    <th className="px-3 py-2 text-left">Remarks</th>
                    {!disabled && <th className="px-3 py-2 w-10"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {form.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-3 py-2 text-gray-500 text-center">{item.slNo}</td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={disabled}
                          value={item.itemDescription}
                          onChange={(e) => updateItem(idx, 'itemDescription', e.target.value)}
                          placeholder="Item description"
                          className={`w-full px-2 py-1 rounded border text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 ${disabled ? 'bg-gray-50 border-gray-100' : 'border-gray-200'}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={disabled}
                          value={item.qty}
                          onChange={(e) => updateItem(idx, 'qty', e.target.value)}
                          placeholder="Qty"
                          className={`w-full px-2 py-1 rounded border text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 ${disabled ? 'bg-gray-50 border-gray-100' : 'border-gray-200'}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          disabled={disabled}
                          value={item.remarks}
                          onChange={(e) => updateItem(idx, 'remarks', e.target.value)}
                          placeholder="Remarks"
                          className={`w-full px-2 py-1 rounded border text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 ${disabled ? 'bg-gray-50 border-gray-100' : 'border-gray-200'}`}
                        />
                      </td>
                      {!disabled && (
                        <td className="px-3 py-2 text-center">
                          <button onClick={() => removeItem(idx)} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            {canEdit ? 'Cancel' : 'Close'}
          </button>
          {canEdit && (
            <button
              onClick={() => onSave(form)}
              className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" />
              Save Work Order
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
