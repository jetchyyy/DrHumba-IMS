import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { formatPHP } from './types';
import { TrashIcon as Trash2, CheckIcon as Check } from '@radix-ui/react-icons';

interface TabDiscountModalProps {
  open: boolean;
  onClose: () => void;
  subtotal: number;
  paxCount: number;
  initialDiscountType?: string | null;
  initialDiscountAmount?: number;
  initialDiscountMetadata?: any[];
  onApplyDiscount: (
    discountType: string | null,
    discountAmount: number,
    metadata: any[]
  ) => void;
}

export const TabDiscountModal: React.FC<TabDiscountModalProps> = ({
  open,
  onClose,
  subtotal,
  paxCount,
  initialDiscountType,
  initialDiscountAmount = 0,
  initialDiscountMetadata = [],
  onApplyDiscount,
}) => {
  const [discountType, setDiscountType] = useState<string>('sc');
  const [discountCount, setDiscountCount] = useState<number>(1);
  const [idNumber, setIdNumber] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [customRate, setCustomRate] = useState<number>(10);

  useEffect(() => {
    if (open) {
      if (initialDiscountType) {
        setDiscountType(initialDiscountType);
        const meta = Array.isArray(initialDiscountMetadata) && initialDiscountMetadata.length > 0
          ? initialDiscountMetadata[0]
          : null;
        setIdNumber(meta?.id_number || meta?.idNumber || '');
        setCustomerName(meta?.name || meta?.customer_name || '');
        setDiscountCount(meta?.count || 1);
        if (meta?.custom_rate) setCustomRate(meta.custom_rate);
      } else {
        setDiscountType('sc');
        setDiscountCount(1);
        setIdNumber('');
        setCustomerName('');
        setCustomRate(10);
      }
    }
  }, [open, initialDiscountType, initialDiscountMetadata]);

  // Real-time calculation preview
  const preview = React.useMemo(() => {
    const totalPax = Math.max(1, paxCount || 1);
    const validCount = Math.min(totalPax, Math.max(1, discountCount));
    const ratio = validCount / totalPax;

    let discountAmount = 0;
    let vatRelief = 0;

    if (discountType === 'sc' || discountType === 'pwd') {
      // Philippine statutory: 20% discount on VAT-exempt gross portion
      const portionGross = subtotal * ratio;
      const portionNetVat = portionGross / 1.12;
      vatRelief = portionGross - portionNetVat;
      discountAmount = portionNetVat * 0.20;
    } else if (discountType === 'solo') {
      // 10% discount on portion
      const portionGross = subtotal * ratio;
      discountAmount = portionGross * 0.10;
    } else if (discountType === 'custom') {
      // Custom % across entire subtotal
      const rate = Math.max(0, Math.min(100, customRate)) / 100;
      discountAmount = subtotal * rate;
    }

    return {
      discountAmount,
      vatRelief,
      netTotal: Math.max(0, subtotal - vatRelief - discountAmount),
    };
  }, [subtotal, paxCount, discountType, discountCount, customRate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const metadata = [
      {
        type: discountType,
        id_number: idNumber.trim(),
        name: customerName.trim(),
        count: discountCount,
        custom_rate: discountType === 'custom' ? customRate : undefined,
        vat_relief: preview.vatRelief,
      },
    ];

    onApplyDiscount(discountType, preview.discountAmount, metadata);
    onClose();
  };

  const handleRemove = () => {
    onApplyDiscount(null, 0, []);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-md p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <span>Apply Discount to Running Bill</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Discounts applied here will be printed on the customer's Bill Out slip before payment.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Discount Type */}
          <div className="space-y-1.5">
            <Label className="text-xs">Discount Category</Label>
            <Select value={discountType} onValueChange={setDiscountType}>
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sc" className="text-xs">
                  Senior Citizen (20% + 12% VAT Exempt)
                </SelectItem>
                <SelectItem value="pwd" className="text-xs">
                  Person with Disability / PWD (20% + 12% VAT Exempt)
                </SelectItem>
                <SelectItem value="solo" className="text-xs">
                  Solo Parent (10% Discount)
                </SelectItem>
                <SelectItem value="custom" className="text-xs">
                  Special / Employee / Custom Promo (%)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Number of Beneficiaries */}
          {(discountType === 'sc' || discountType === 'pwd' || discountType === 'solo') && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <Label className="text-xs">Number of Seniors/PWDs</Label>
                <span className="text-[11px] text-muted-foreground">
                  Total Guests at Table: <strong>{paxCount || 1}</strong>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  max={Math.max(1, paxCount || 1)}
                  value={discountCount}
                  onChange={e => setDiscountCount(parseInt(e.target.value) || 1)}
                  className="text-xs font-semibold"
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  of {paxCount || 1} guests
                </span>
              </div>
            </div>
          )}

          {/* Custom Rate */}
          {discountType === 'custom' && (
            <div className="space-y-1.5">
              <Label className="text-xs">Discount Percentage (%)</Label>
              <Input
                type="number"
                min="1"
                max="100"
                value={customRate}
                onChange={e => setCustomRate(parseFloat(e.target.value) || 0)}
                className="text-xs"
              />
            </div>
          )}

          {/* ID Number & Name */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">ID Number / OSCA No.</Label>
              <Input
                placeholder="e.g. SC-12345"
                value={idNumber}
                onChange={e => setIdNumber(e.target.value)}
                className="text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Beneficiary Name</Label>
              <Input
                placeholder="e.g. Juan dela Cruz"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Calculation Summary Preview */}
          <div className="p-3 bg-muted/50 rounded-xl border space-y-1 text-xs">
            <div className="flex justify-between text-muted-foreground">
              <span>Gross Bill Subtotal:</span>
              <span>{formatPHP(subtotal)}</span>
            </div>
            {preview.vatRelief > 0 && (
              <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-medium">
                <span>VAT Relief (12% Exemption):</span>
                <span>-{formatPHP(preview.vatRelief)}</span>
              </div>
            )}
            <div className="flex justify-between text-amber-600 dark:text-amber-400 font-bold">
              <span>Estimated Discount:</span>
              <span>-{formatPHP(preview.discountAmount)}</span>
            </div>
            <div className="flex justify-between font-bold pt-1.5 border-t border-border/60 text-foreground text-sm">
              <span>Discounted Subtotal:</span>
              <span className="text-emerald-600 dark:text-emerald-400">{formatPHP(preview.netTotal)}</span>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t flex justify-between sm:justify-between items-center">
            {initialDiscountAmount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                className="text-destructive hover:text-destructive hover:bg-destructive/10 text-xs gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove Discount
              </Button>
            ) : <div />}

            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold">
                <Check className="w-3.5 h-3.5" /> Apply to Running Bill
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

