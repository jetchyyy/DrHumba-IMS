import React from 'react';
import { discrepancyColorClass } from '../../lib/utils';
import { CheckCircle } from 'lucide-react';
import {
  FileTextIcon as Printer,
  ReloadIcon as Spinner,
} from '@radix-ui/react-icons';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import type {
  EditingPriceItem,
  LastSaleResult,
  PaymentMethod,
  PriceChannel,
} from './types';
import {
  PAYMENT_LABELS,
  formatPHP,
} from './types';

// ─── 1. Match Delivery Price Dialog ──────────────────────────────────────────

interface MatchPriceDialogProps {
  editingPriceItem: EditingPriceItem | null;
  onClose: () => void;
  priceChannel: PriceChannel;
  priceAdjustmentInput: string;
  setPriceAdjustmentInput: (val: string) => void;
  priceAdjustmentReason: string;
  setPriceAdjustmentReason: (val: string) => void;
  onApply: (price: number, reason: string) => void;
}

export const MatchPriceDialog: React.FC<MatchPriceDialogProps> = ({
  editingPriceItem,
  onClose,
  priceChannel,
  priceAdjustmentInput,
  setPriceAdjustmentInput,
  priceAdjustmentReason,
  setPriceAdjustmentReason,
  onApply,
}) => {
  if (!editingPriceItem) return null;

  const catalogPrice = editingPriceItem.catalogPrice;
  const minFloor = Number((catalogPrice * 0.5).toFixed(2));
  const maxCeil = Number((catalogPrice * 1.5).toFixed(2));
  const enteredVal = Number(priceAdjustmentInput);

  return (
    <Dialog open={!!editingPriceItem} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${priceChannel === 'foodpanda' ? 'bg-amber-500' : 'bg-emerald-600'}`} />
            <span>Match Delivery Price</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Adjust price for <span className="font-bold text-foreground">{editingPriceItem.name}</span> to match what is sold on {priceChannel === 'foodpanda' ? 'Foodpanda' : 'Grab'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 select-none">
          {/* Master Platform Catalog Price & Bounds */}
          <div className="bg-muted/40 border rounded-xl p-3 space-y-1.5 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground font-semibold uppercase tracking-wider text-[10px]">
                Catalog {priceChannel === 'foodpanda' ? 'Foodpanda' : 'Grab'} Price:
              </span>
              <span className="font-bold text-foreground text-sm">{formatPHP(catalogPrice)}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] text-muted-foreground pt-1 border-t border-border/50">
              <span>Safety Corridor (Floor / Ceiling):</span>
              <span className="font-semibold text-foreground">
                {formatPHP(minFloor)} – {formatPHP(maxCeil)}
              </span>
            </div>
          </div>

          {/* Quick Discount Presets */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Quick Match Presets</span>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: '-10%', val: Number((catalogPrice * 0.9).toFixed(2)) },
                { label: '-15%', val: Number((catalogPrice * 0.85).toFixed(2)) },
                { label: '-20%', val: Number((catalogPrice * 0.8).toFixed(2)) },
                { label: '-₱20', val: Math.max(minFloor, catalogPrice - 20) },
                { label: '-₱50', val: Math.max(minFloor, catalogPrice - 50) },
                { label: 'Reset (Catalog)', val: catalogPrice },
              ].map(preset => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 text-xs font-bold rounded-lg hover:bg-primary/10 active:scale-95"
                  onClick={() => setPriceAdjustmentInput(String(preset.val))}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Price Input Field */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase font-bold text-muted-foreground">Actual Price Sold (₱) *</Label>
            <div className="relative">
              <span className="absolute left-3.5 top-3 text-lg font-bold text-muted-foreground">₱</span>
              <Input
                type="number"
                step="0.01"
                value={priceAdjustmentInput}
                onChange={(e) => setPriceAdjustmentInput(e.target.value)}
                placeholder="Enter delivery price..."
                className="h-12 pl-8 text-xl font-black rounded-xl"
              />
            </div>

            {/* Validation Warnings */}
            {enteredVal > 0 && enteredVal < minFloor && (
              <p className="text-[11px] text-destructive font-bold">
                ⚠️ Price is below the 50% safety floor ({formatPHP(minFloor)}). Prevents underdeclaration errors.
              </p>
            )}
            {enteredVal > maxCeil && (
              <p className="text-[11px] text-destructive font-bold">
                ⚠️ Price exceeds the 150% safety ceiling ({formatPHP(maxCeil)}). Prevents extra-zero typos.
              </p>
            )}
          </div>

          {/* Reason Selector */}
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground">Adjustment Reason</Label>
            <div className="flex flex-wrap gap-1.5">
              {['Platform Campaign Promo', 'Vouchered Dish', 'Merchant Co-Funded', 'Price Match'].map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setPriceAdjustmentReason(r)}
                  className={`text-xs px-2.5 py-1 rounded-lg border font-semibold transition-all active:scale-95 ${
                    priceAdjustmentReason === r
                      ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                      : 'bg-background hover:bg-muted text-muted-foreground border-border'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="lg" className="h-11 px-5 font-bold" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="lg"
            onClick={() => {
              const val = parseFloat(priceAdjustmentInput);
              if (isNaN(val) || val < minFloor || val > maxCeil) return;
              onApply(val, priceAdjustmentReason);
            }}
            disabled={
              !priceAdjustmentInput ||
              enteredVal < minFloor ||
              enteredVal > maxCeil
            }
            className="h-11 px-6 font-bold shadow-md active:scale-98"
          >
            Apply Delivery Price
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── 2. Sale Success & Printing Dialog ────────────────────────────────────────

interface SaleSuccessDialogProps {
  lastSaleResult: LastSaleResult | null;
  onClose: () => void;
  isRestaurant: boolean;
  isPrintingReceiptBluetooth: boolean;
  isPrintingKitchenBluetooth: boolean;
  onPrintThermalBluetooth: (sale: LastSaleResult) => Promise<void>;
  onPrintThermalSystem: (sale: LastSaleResult) => Promise<void>;
  onPrintKitchenBluetooth: (sale: LastSaleResult) => Promise<void>;
  onPrintKitchenSystem: (sale: LastSaleResult) => Promise<void>;
  onPrintQueue: (saleId: string) => void;
}

export const SaleSuccessDialog: React.FC<SaleSuccessDialogProps> = ({
  lastSaleResult,
  onClose,
  isRestaurant,
  isPrintingReceiptBluetooth,
  isPrintingKitchenBluetooth,
  onPrintThermalBluetooth,
  onPrintThermalSystem,
  onPrintKitchenBluetooth,
  onPrintKitchenSystem,
  onPrintQueue,
}) => {
  if (!lastSaleResult) return null;

  return (
    <Dialog open={!!lastSaleResult} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="w-6 h-6" />
            <DialogTitle className="text-xl font-bold">Sale Completed!</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Transaction has been recorded successfully.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted/50 p-4 rounded-lg space-y-2 border">
            {lastSaleResult.control_number && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Invoice Serial</span>
                <span className="font-mono font-bold text-foreground">{lastSaleResult.control_number}</span>
              </div>
            )}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Transaction ID</span>
              <span className="font-mono">{lastSaleResult.id.length === 36 ? `${lastSaleResult.id.slice(0, 8)}...` : lastSaleResult.id}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Payment Method</span>
              <span className="font-bold text-foreground">{PAYMENT_LABELS[lastSaleResult.method as PaymentMethod] || lastSaleResult.method}</span>
            </div>

            {lastSaleResult.sale_category && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Sale Category</span>
                <span className="font-bold text-foreground">{lastSaleResult.sale_category}</span>
              </div>
            )}

            {lastSaleResult.reference_number && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Reference Number</span>
                <span className="font-mono text-foreground">{lastSaleResult.reference_number}</span>
              </div>
            )}

            {lastSaleResult.queue_number && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Queue / Order / Table #</span>
                <span className="font-bold text-foreground">{lastSaleResult.queue_number}</span>
              </div>
            )}

            {(Number(lastSaleResult.discount_amount) || 0) > 0 && (
              <div className="flex justify-between text-xs text-rose-500 font-semibold">
                <span>Discount / Voucher Promo</span>
                <span>- {formatPHP(Number(lastSaleResult.discount_amount))}</span>
              </div>
            )}

            {(Number(lastSaleResult.service_charge_amount) || 0) > 0 && (
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Service Charge</span>
                <span className="font-semibold text-foreground">{formatPHP(Number(lastSaleResult.service_charge_amount))}</span>
              </div>
            )}

            {lastSaleResult.total_amount != null && (
              <div className="flex justify-between text-xs text-muted-foreground font-bold">
                <span>Total Amount</span>
                <span className="font-bold text-foreground">{formatPHP(lastSaleResult.total_amount)}</span>
              </div>
            )}

            {lastSaleResult.method === 'cash' && (
              <>
                <Separator className="my-2" />
                {lastSaleResult.amount_tendered != null && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Cash Tendered</span>
                    <span className="font-bold text-foreground">{formatPHP(lastSaleResult.amount_tendered)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-sm font-bold text-muted-foreground">Change Due</span>
                  <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
                    {formatPHP(lastSaleResult.change || 0)}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-col sm:space-x-0 gap-3 w-full">
          {isRestaurant && (
            <div className="grid grid-cols-2 gap-2 w-full">
              <Button
                variant="secondary"
                className="w-full font-bold text-xs"
                disabled={isPrintingKitchenBluetooth}
                onClick={() => onPrintKitchenBluetooth(lastSaleResult)}
              >
                {isPrintingKitchenBluetooth ? (
                  <Spinner className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Printer className="w-4 h-4 mr-2" />
                )}
                Print Kitchen (Bluetooth)
              </Button>
              <Button
                variant="secondary"
                className="w-full font-bold text-xs"
                onClick={() => onPrintKitchenSystem(lastSaleResult)}
              >
                <Printer className="w-4 h-4 mr-2" />
                Print Kitchen (System)
              </Button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 w-full">
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
              disabled={isPrintingReceiptBluetooth}
              onClick={() => onPrintThermalBluetooth(lastSaleResult)}
            >
              {isPrintingReceiptBluetooth ? (
                <Spinner className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Printer className="w-4 h-4 mr-2" />
              )}
              Print Receipt (Bluetooth)
            </Button>
            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs"
              onClick={() => onPrintThermalSystem(lastSaleResult)}
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Receipt (System)
            </Button>
          </div>

          {lastSaleResult.queue_number && (
            <Button
              variant="outline"
              className="w-full font-bold border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-950/20"
              onClick={() => onPrintQueue(lastSaleResult.id)}
            >
              <Printer className="w-4 h-4 mr-2" />
              Print Queue Ticket
            </Button>
          )}

          <Button variant="default" size="lg" onClick={onClose} className="w-full h-12 text-sm font-black shadow-md rounded-xl active:scale-98">
            Start Next Order / New Sale
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── 3. Open Session Dialog ──────────────────────────────────────────────────

interface OpenSessionDialogProps {
  open: boolean;
  onClose: () => void;
  openingBalance: string;
  setOpeningBalance: (val: string) => void;
  onOpenSession: () => void;
}

export const OpenSessionDialog: React.FC<OpenSessionDialogProps> = ({
  open,
  onClose,
  openingBalance,
  setOpeningBalance,
  onOpenSession,
}) => {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">Open Cash Drawer Shift</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Input the opening cash float balance for your register drawer before starting sales.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase font-semibold">Opening Cash Float (₱) *</Label>
            <Input
              type="number"
              step="0.01"
              required
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              placeholder="e.g. 1000.00"
              className="font-bold text-xl h-12 rounded-xl"
            />
            <div className="flex gap-2 pt-1 select-none">
              {['500', '1000', '2000', '5000'].map(val => (
                <Button
                  key={val}
                  type="button"
                  variant={openingBalance === val ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1 font-bold h-9 text-xs rounded-lg active:scale-95"
                  onClick={() => setOpeningBalance(val)}
                >
                  ₱{Number(val).toLocaleString()}
                </Button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              This is the initial cash float used for cashier change at the start of your shift.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="lg" className="h-11 px-5 font-bold" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="lg"
            onClick={onOpenSession}
            disabled={!openingBalance || Number(openingBalance) < 0}
            className="h-11 px-6 font-bold shadow-md active:scale-98"
          >
            Open Register Drawer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── 4. X-Read Report Dialog ─────────────────────────────────────────────────

interface XReadDialogProps {
  open: boolean;
  onClose: () => void;
  sessionSummary: any;
  branchName?: string;
  isPrintingXZBluetooth: boolean;
  onPrintXZBluetooth: (summary: any, isZ: boolean) => Promise<void>;
  onPrintXZSystem: (summary: any, isZ: boolean, branchName: string) => void;
}

export const XReadDialog: React.FC<XReadDialogProps> = ({
  open,
  onClose,
  sessionSummary,
  branchName = 'TERMINAL',
  isPrintingXZBluetooth,
  onPrintXZBluetooth,
  onPrintXZSystem,
}) => {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">X-Read Report (Mid-Shift Status)</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Non-resetting audit report summarizing current transactions in this shift session.
          </DialogDescription>
        </DialogHeader>

        {sessionSummary && (
          <div className="space-y-4 py-2">
            <div className="border rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5 max-h-[50vh] overflow-y-auto">
              <div className="text-center font-bold uppercase">{branchName}</div>
              <div className="text-center text-[10px] text-muted-foreground">X-READ SUMMARY</div>
              <div className="border-t border-dashed my-2" />
              <div className="flex justify-between"><span>Status:</span><span>{sessionSummary.status?.toUpperCase()}</span></div>
              <div className="flex justify-between"><span>Z-Counter:</span><span>#{String(sessionSummary.zCounter || 0).padStart(5, '0')}</span></div>
              <div className="flex justify-between"><span>Opened At:</span><span>{new Date(sessionSummary.openedAt).toLocaleString()}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
              <div className="flex justify-between"><span>Start:</span><span>{formatPHP(sessionSummary.grandTotalStart)}</span></div>
              <div className="flex justify-between"><span>Current:</span><span>{formatPHP(sessionSummary.grandTotalEnd)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(sessionSummary.grossSales)}</span></div>
              <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(sessionSummary.netSales)}</span></div>
              <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(sessionSummary.vatAmount)}</span></div>
              <div className="flex justify-between"><span>VAT-Exempt Sales:</span><span>{formatPHP(sessionSummary.vatExemptSales || 0)}</span></div>
              <div className="flex justify-between"><span>Discount Total:</span><span>{formatPHP(sessionSummary.discountAmount || 0)}</span></div>
              {Number(sessionSummary.serviceChargeTotal || 0) > 0 && (
                <div className="flex justify-between"><span>Service Charge:</span><span>{formatPHP(sessionSummary.serviceChargeTotal)}</span></div>
              )}
              <div className="flex justify-between"><span>Transaction Count:</span><span>{sessionSummary.transactionCount}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
              <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(sessionSummary.cashSales)}</span></div>
              <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(sessionSummary.gcashSales)}</span></div>
              <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(sessionSummary.mayaSales)}</span></div>
              <div className="flex justify-between"><span>Card:</span><span>{formatPHP(sessionSummary.cardSales)}</span></div>
              <div className="flex justify-between"><span>Other:</span><span>{formatPHP(sessionSummary.otherSales)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
              <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(sessionSummary.dineInSales || 0)}</span></div>
              <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(sessionSummary.takeOutSales || 0)}</span></div>
              <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(sessionSummary.foodpandaSales || 0)}</span></div>
              <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(sessionSummary.grabSales || 0)}</span></div>
              {sessionSummary.otherChannelSales > 0 && (
                <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(sessionSummary.otherChannelSales)}</span></div>
              )}
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">VOIDS & REFUNDS</div>
              <div className="flex justify-between"><span>Void Count:</span><span>{sessionSummary.voidCount}</span></div>
              <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(sessionSummary.voidAmount)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">DRAWER FLOW</div>
              <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(sessionSummary.openingBalance)}</span></div>
              <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(sessionSummary.cashSales)}</span></div>
              <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(sessionSummary.openingBalance + sessionSummary.cashSales)}</span></div>
            </div>
          </div>
        )}

        <DialogFooter className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button variant="outline" onClick={onClose} className="sm:flex-1">
            Close
          </Button>
          <Button
            onClick={() => onPrintXZBluetooth(sessionSummary, false)}
            disabled={isPrintingXZBluetooth}
            className="sm:flex-1 font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPrintingXZBluetooth ? <Spinner className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
            Print Bluetooth
          </Button>
          <Button
            onClick={() => onPrintXZSystem(sessionSummary, false, branchName)}
            className="sm:flex-1 font-bold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Printer className="w-4 h-4" />
            Print System
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── 5. Z-Read Close Shift Dialog ────────────────────────────────────────────

interface ZReadDialogProps {
  open: boolean;
  onClose: () => void;
  actualCashStr: string;
  setActualCashStr: (val: string) => void;
  onCloseSession: () => void;
}

export const ZReadDialog: React.FC<ZReadDialogProps> = ({
  open,
  onClose,
  actualCashStr,
  setActualCashStr,
  onCloseSession,
}) => {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold tracking-tight">Close Drawer & Run Z-Read</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            End cashier session. This locks the terminal, runs a Z-Read report, and resets session counters.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs uppercase font-semibold">Actual Cash Counted (₱) *</Label>
            <Input
              type="number"
              step="0.01"
              required
              value={actualCashStr}
              onChange={(e) => setActualCashStr(e.target.value)}
              placeholder="Count all paper cash and coins in drawer..."
              className="font-bold text-xl h-12 text-primary border-primary/30 rounded-xl"
            />
            <p className="text-[10px] text-muted-foreground">
              Enter the exact cash amount inside the physical drawer (including the initial cash float).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="lg" className="h-11 px-5 font-bold" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={onCloseSession}
            disabled={!actualCashStr || Number(actualCashStr) < 0}
            className="h-11 px-6 font-bold shadow-md active:scale-98"
          >
            Confirm Z-Read & Close Shift
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── 6. Closed Z-Report View Dialog ──────────────────────────────────────────

interface ClosedZReportDialogProps {
  summary: any | null;
  onClose: () => void;
  branchName?: string;
  isPrintingXZBluetooth: boolean;
  onPrintXZBluetooth: (summary: any, isZ: boolean) => Promise<void>;
  onPrintXZSystem: (summary: any, isZ: boolean, branchName: string) => void;
}

export const ClosedZReportDialog: React.FC<ClosedZReportDialogProps> = ({
  summary,
  onClose,
  branchName = 'TERMINAL',
  isPrintingXZBluetooth,
  onPrintXZBluetooth,
  onPrintXZSystem,
}) => {
  if (!summary) return null;

  return (
    <Dialog open={!!summary} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl p-0 overflow-hidden">
        <div className="flex flex-col max-h-[90vh] w-full">
          <div className="px-6 pt-6 pb-4 pr-12 shrink-0">
            <DialogTitle className="text-lg font-bold tracking-tight text-destructive">Z-Read Shift Closed Report</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1.5">
              Official shift summary. This terminal session is now locked.
            </DialogDescription>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-3 min-h-0">
            <div className="border border-destructive/20 rounded-md p-4 bg-muted/30 font-mono text-xs space-y-1.5">
              <div className="text-center font-bold uppercase">{branchName}</div>
              <div className="text-center text-[10px] text-destructive font-bold">Z-READ CLOSED REPORT</div>
              <div className="border-t border-dashed my-2" />
              <div className="flex justify-between"><span>Status:</span><span className="font-bold text-destructive">{summary.status?.toUpperCase()}</span></div>
              <div className="flex justify-between"><span>Z-Counter:</span><span className="font-bold text-destructive">#{String(summary.zCounter || 0).padStart(5, '0')}</span></div>
              <div className="flex justify-between"><span>Opened At:</span><span>{new Date(summary.openedAt).toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Closed At:</span><span>{new Date(summary.closedAt).toLocaleString()}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">LIFETIME GRAND TOTALS</div>
              <div className="flex justify-between"><span>Start:</span><span>{formatPHP(summary.grandTotalStart)}</span></div>
              <div className="flex justify-between"><span>End:</span><span>{formatPHP(summary.grandTotalEnd)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="flex justify-between"><span>Gross Sales:</span><span>{formatPHP(summary.grossSales)}</span></div>
              <div className="flex justify-between"><span>Net Sales (Ex-VAT):</span><span>{formatPHP(summary.netSales)}</span></div>
              <div className="flex justify-between"><span>VAT Amount (12%):</span><span>{formatPHP(summary.vatAmount)}</span></div>
              <div className="flex justify-between"><span>VAT-Exempt Sales:</span><span>{formatPHP(summary.vatExemptSales || 0)}</span></div>
              <div className="flex justify-between"><span>Discount Total:</span><span>{formatPHP(summary.discountAmount || 0)}</span></div>
              {Number(summary.serviceChargeTotal || 0) > 0 && (
                <div className="flex justify-between"><span>Service Charge:</span><span>{formatPHP(summary.serviceChargeTotal)}</span></div>
              )}
              <div className="flex justify-between"><span>Transaction Count:</span><span>{summary.transactionCount}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">PAYMENT BREAKDOWN</div>
              <div className="flex justify-between"><span>Cash:</span><span>{formatPHP(summary.cashSales)}</span></div>
              <div className="flex justify-between"><span>GCash:</span><span>{formatPHP(summary.gcashSales)}</span></div>
              <div className="flex justify-between"><span>Maya:</span><span>{formatPHP(summary.mayaSales)}</span></div>
              <div className="flex justify-between"><span>Card:</span><span>{formatPHP(summary.cardSales)}</span></div>
              <div className="flex justify-between"><span>Other:</span><span>{formatPHP(summary.otherSales)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">SALES CHANNEL BREAKDOWN</div>
              <div className="flex justify-between"><span>Dine-in / Store:</span><span>{formatPHP(summary.dineInSales || 0)}</span></div>
              <div className="flex justify-between"><span>Take-out:</span><span>{formatPHP(summary.takeOutSales || 0)}</span></div>
              <div className="flex justify-between text-amber-500 font-bold"><span>FoodPanda:</span><span>{formatPHP(summary.foodpandaSales || 0)}</span></div>
              <div className="flex justify-between text-emerald-500 font-bold"><span>GrabFood:</span><span>{formatPHP(summary.grabSales || 0)}</span></div>
              {summary.otherChannelSales > 0 && (
                <div className="flex justify-between"><span>Other Channels:</span><span>{formatPHP(summary.otherChannelSales)}</span></div>
              )}
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">VOIDS &amp; REFUNDS</div>
              <div className="flex justify-between"><span>Void Count:</span><span>{summary.voidCount}</span></div>
              <div className="flex justify-between"><span>Void Amount:</span><span>{formatPHP(summary.voidAmount)}</span></div>
              <div className="border-t border-dashed my-2" />
              <div className="font-bold text-center">DRAWER FLOW &amp; BALANCING</div>
              <div className="flex justify-between"><span>Opening Float:</span><span>{formatPHP(summary.openingBalance)}</span></div>
              <div className="flex justify-between"><span>Expected Cash:</span><span>{formatPHP(summary.expectedCash)}</span></div>
              <div className="flex justify-between font-bold"><span>Expected Drawer:</span><span>{formatPHP(summary.openingBalance + summary.expectedCash)}</span></div>
              <div className="flex justify-between text-indigo-600 dark:text-indigo-400 font-bold"><span>Actual Drawer:</span><span>{formatPHP(summary.actualCash)}</span></div>
              <div className={`flex justify-between font-bold ${discrepancyColorClass(summary.discrepancy)}`}>
                <span>Discrepancy:</span>
                <span>{formatPHP(summary.discrepancy)}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 px-6 py-4 shrink-0 border-t">
            <Button variant="outline" onClick={onClose} className="sm:flex-1">
              Close &amp; Lock POS
            </Button>
            <Button
              onClick={() => onPrintXZBluetooth(summary, true)}
              disabled={isPrintingXZBluetooth}
              className="sm:flex-1 font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isPrintingXZBluetooth ? <Spinner className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
              Print Bluetooth
            </Button>
            <Button
              onClick={() => onPrintXZSystem(summary, true, branchName)}
              className="sm:flex-1 font-bold gap-1.5 bg-blue-600 hover:bg-blue-700 text-white"
            >
              <Printer className="w-4 h-4" />
              Print System
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
