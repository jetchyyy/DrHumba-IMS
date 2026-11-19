import React, { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Checkbox } from '../ui/checkbox';
import { ReloadIcon as Spinner, CheckIcon as Check } from '@radix-ui/react-icons';
import { ClipboardList, Printer, CheckCheck, UtensilsCrossed } from 'lucide-react';
import type { CartItem, PosTab } from './types';
import { formatPHP } from './types';
import { groupOrderItemsByRound, resolveCartItemKey } from './tableUtils';

interface FullTableOrderDialogProps {
  open: boolean;
  onClose: () => void;
  tableLabel: string;
  tab: PosTab | null;
  cart: CartItem[];
  subtotal: number;
  discountType?: string | null;
  discountAmount?: number;
  serviceChargeAmount?: number;
  totalDue: number;
  orderKitchenNote?: string;
  isOnline: boolean;
  firingKitchen: boolean;
  checkingOut: boolean;
  updatingServedId?: string | null;
  canCheckout: boolean;
  onToggleItemServed: (item: CartItem) => void;
  onMarkAllServed: () => void;
  onSendToKitchen: () => void;
  onPrintBillOut: () => void;
  onSettleAndPay: () => void;
}

export const FullTableOrderDialog: React.FC<FullTableOrderDialogProps> = ({
  open,
  onClose,
  tableLabel,
  tab,
  cart,
  subtotal,
  discountType,
  discountAmount = 0,
  serviceChargeAmount = 0,
  totalDue,
  orderKitchenNote,
  isOnline,
  firingKitchen,
  checkingOut,
  updatingServedId,
  canCheckout,
  onToggleItemServed,
  onMarkAllServed,
  onSendToKitchen,
  onPrintBillOut,
  onSettleAndPay,
}) => {
  const { rounds, unsentItems, servedCount, submittedCount } = useMemo(
    () => groupOrderItemsByRound(cart),
    [cart]
  );

  const allSubmittedServed = submittedCount > 0 && servedCount === submittedCount;
  const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-6">
        <DialogHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="text-lg font-bold flex items-center gap-2 flex-wrap">
                <ClipboardList className="w-5 h-5 text-primary" />
                <span>Full Table Order — {tableLabel}</span>
                <Badge variant="outline" className="text-xs font-bold">
                  {tab?.pax_count || 1} Guests
                </Badge>
                {tab?.status === 'billed_out' ? (
                  <Badge className="bg-amber-500 text-black text-[10px] font-bold uppercase">
                    Billed Out
                  </Badge>
                ) : (
                  <Badge className="bg-rose-500 text-white text-[10px] font-bold uppercase">
                    Occupied
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Server: {tab?.server_name || 'Staff'} &bull; {totalQty} total item(s) &bull; Check off items once served to the table.
              </DialogDescription>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Badge
                variant="outline"
                className={`text-xs font-bold px-2.5 py-1 gap-1.5 ${
                  allSubmittedServed
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>{servedCount} / {submittedCount} Served</span>
              </Badge>

              {submittedCount > 0 && !allSubmittedServed && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isOnline || updatingServedId === '__all__'}
                  onClick={onMarkAllServed}
                  className="h-8 text-xs font-bold gap-1.5 border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10"
                >
                  {updatingServedId === '__all__' ? (
                    <Spinner className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Mark All Served</span>
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Orders List */}
        <div className="flex-1 overflow-y-auto min-h-[260px] max-h-[52vh] space-y-4 py-2 pr-1">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-56 text-muted-foreground text-center">
              <UtensilsCrossed className="w-10 h-10 mb-2 opacity-30" />
              <p className="text-sm font-semibold text-foreground">No items ordered yet</p>
              <p className="text-xs mt-1">Add menu items to this table from the POS catalog.</p>
            </div>
          ) : (
            <>
              {orderKitchenNote?.trim() && (
                <div className="p-3 rounded-xl bg-muted/50 border text-xs flex items-center gap-2">
                  <span className="font-bold text-foreground shrink-0">Table Note:</span>
                  <span className="text-muted-foreground">{orderKitchenNote}</span>
                </div>
              )}

              {/* Unsent Items Section */}
              {unsentItems.length > 0 && (
                <div className="border border-amber-500/40 bg-amber-500/5 rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20 flex items-center justify-between">
                    <span className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                      Ready to Send to Kitchen ({unsentItems.length})
                    </span>
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-700 dark:text-amber-300">
                      Not Yet Sent
                    </Badge>
                  </div>
                  <div className="divide-y divide-border/50">
                    {unsentItems.map(item => (
                      <div
                        key={resolveCartItemKey(item)}
                        className="px-4 py-3 flex items-center justify-between gap-3 opacity-85"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Checkbox disabled checked={false} aria-label="Not yet sent to kitchen" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-sm text-foreground">
                                {item.quantity}&times; {item.name}
                              </span>
                              <Badge variant="outline" className="text-[10px] h-4 border-amber-500/40 text-amber-600">
                                Pending Send
                              </Badge>
                            </div>
                            {item.notes && (
                              <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                Note: {item.notes}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-bold text-sm">{formatPHP(item.price * item.quantity)}</div>
                          <div className="text-[11px] text-muted-foreground">{formatPHP(item.price)} ea</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sent / Served Kitchen Rounds */}
              {rounds.map(round => {
                const roundServed = round.items.filter(i => i.kitchen_status === 'served').length;
                return (
                  <div key={round.roundNumber} className="border rounded-2xl overflow-hidden bg-card">
                    <div className="px-4 py-2.5 bg-muted/40 border-b flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-foreground">
                        Round {round.roundNumber}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        {roundServed} / {round.items.length} served
                      </span>
                    </div>
                    <div className="divide-y divide-border/60">
                      {round.items.map(item => {
                        const isServed = item.kitchen_status === 'served';
                        const isUpdating = updatingServedId === item.tab_item_id;
                        const canToggle = Boolean(item.tab_item_id) && isOnline && !isUpdating;

                        return (
                          <div
                            key={resolveCartItemKey(item)}
                            onClick={() => {
                              if (canToggle) onToggleItemServed(item);
                            }}
                            className={`px-4 py-3 flex items-center justify-between gap-3 transition-colors select-none ${
                              canToggle ? 'cursor-pointer hover:bg-muted/30' : ''
                            } ${isServed ? 'bg-emerald-500/5' : ''}`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div onClick={e => e.stopPropagation()} className="flex items-center">
                                {isUpdating ? (
                                  <Spinner className="w-4 h-4 animate-spin text-primary" />
                                ) : (
                                  <Checkbox
                                    checked={isServed}
                                    disabled={!canToggle}
                                    onCheckedChange={() => {
                                      if (canToggle) onToggleItemServed(item);
                                    }}
                                    aria-label={`Mark ${item.name} as served`}
                                    className="h-5 w-5"
                                  />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span
                                    className={`font-bold text-sm ${
                                      isServed
                                        ? 'line-through text-muted-foreground'
                                        : 'text-foreground'
                                    }`}
                                  >
                                    {item.quantity}&times; {item.name}
                                  </span>
                                  {isServed ? (
                                    <Badge className="bg-emerald-600 text-white text-[10px] h-4 px-1.5 font-bold">
                                      Served
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-500/40 text-amber-600 font-semibold">
                                      Preparing / Sent
                                    </Badge>
                                  )}
                                </div>
                                {item.notes && (
                                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                    Note: {item.notes}
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="font-bold text-sm text-foreground">
                                {formatPHP(item.price * item.quantity)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {formatPHP(item.price)} ea
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer Totals + Same Action Buttons */}
        <div className="pt-3 border-t space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-4 text-muted-foreground">
              <span>
                Subtotal: <strong className="text-foreground">{formatPHP(subtotal)}</strong>
              </span>
              {discountAmount > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  Discount ({discountType?.toUpperCase() || 'DISC'}): <strong>-{formatPHP(discountAmount)}</strong>
                </span>
              )}
              {serviceChargeAmount > 0 && (
                <span>
                  Service Charge: <strong className="text-foreground">{formatPHP(serviceChargeAmount)}</strong>
                </span>
              )}
            </div>
            <div className="text-right">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-bold mr-2">
                Total Due:
              </span>
              <span className="text-2xl font-black text-primary">{formatPHP(totalDue)}</span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onClose}
              className="h-11 text-xs font-bold rounded-xl"
            >
              Close
            </Button>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-1 sm:justify-end">
              {unsentItems.length > 0 && (
                <Button
                  type="button"
                  size="lg"
                  onClick={onSendToKitchen}
                  disabled={firingKitchen}
                  className="h-11 px-4 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-black rounded-xl gap-1.5"
                >
                  {firingKitchen && <Spinner className="w-4 h-4 animate-spin" />}
                  <span>Send to Kitchen ({unsentItems.length})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={() => {
                  onClose();
                  onPrintBillOut();
                }}
                disabled={cart.length === 0}
                className="h-11 px-4 text-xs font-bold border-primary/40 text-primary hover:bg-primary/10 rounded-xl gap-1.5"
              >
                <Printer className="w-4 h-4" />
                <span>Print Bill Out</span>
              </Button>

              <Button
                type="button"
                size="lg"
                onClick={() => {
                  onClose();
                  onSettleAndPay();
                }}
                disabled={!canCheckout || checkingOut || cart.length === 0}
                className="h-11 px-5 text-xs font-black bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl gap-1.5 shadow-md"
              >
                <span>{checkingOut ? 'Processing…' : 'Settle & Pay'}</span>
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
