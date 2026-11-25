import { useEffect, useState } from 'react';
import { PlusIcon, TrashIcon, FileTextIcon } from '@radix-ui/react-icons';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Label } from './ui/label';
import { useModal } from '../contexts/ModalContext';
import {
  type SavedPrinter,
  addBluetoothPrinter,
  getSavedPrinters,
  isBluetoothSupported,
  isPrinterConnected,
  onPrintersChanged,
  printBluetoothTestPage,
  removeBluetoothPrinter,
  updateBluetoothPrinter,
} from '../lib/bluetoothPrinter';

/**
 * Per-device Bluetooth printer list. Every printer with "Kitchen tickets" checked
 * receives the same full kitchen ticket (e.g. one in the kitchen, one at the bar).
 */
export default function PrinterSettings() {
  const { showSuccess, showError, confirm } = useModal();
  const [printers, setPrinters] = useState<SavedPrinter[]>(() => getSavedPrinters());
  const [busyId, setBusyId] = useState<string | null>(null);
  const supported = isBluetoothSupported();

  useEffect(() => onPrintersChanged(() => setPrinters(getSavedPrinters())), []);

  const handleAdd = async () => {
    setBusyId('add');
    try {
      const printer = await addBluetoothPrinter();
      showSuccess(`${printer.name} added. Run a test print to confirm it works.`);
    } catch (err: any) {
      // User closed the picker — not an error worth showing.
      if (err?.name !== 'NotFoundError') showError(err?.message || 'Could not add printer.');
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (printer: SavedPrinter) => {
    setBusyId(printer.id);
    try {
      await printBluetoothTestPage(printer.id);
      showSuccess(`Test print sent to ${printer.name}.`);
    } catch (err: any) {
      if (err?.name !== 'NotFoundError') showError(`${printer.name}: ${err?.message || 'Test print failed.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleRemove = async (printer: SavedPrinter) => {
    const ok = await confirm('Remove printer?', `${printer.name} will stop printing on this device. You can add it again any time.`);
    if (ok) removeBluetoothPrinter(printer.id);
  };

  const noKitchen = printers.length > 0 && !printers.some(p => p.kitchen);
  const noReceipts = printers.length > 0 && !printers.some(p => p.receipts);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold uppercase tracking-wider flex items-center space-x-2">
          <FileTextIcon className="w-4 h-4 text-primary" />
          <span>Bluetooth Printers (This Device)</span>
        </CardTitle>
        <CardDescription className="text-xs">
          Printers are saved on this tablet/computer only. Kitchen tickets print in full on every printer with
          “Kitchen tickets” checked — for example one in the kitchen and one at the bar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!supported && (
          <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
            This browser can't use Bluetooth printers. Use Google Chrome or Microsoft Edge over HTTPS (Android, Windows, Mac or ChromeOS).
          </div>
        )}

        {printers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No printers added on this device yet.</p>
        ) : (
          <div className="space-y-3">
            {printers.map(printer => {
              const connected = isPrinterConnected(printer.id);
              return (
                <div key={printer.id} className="rounded-lg border p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{printer.name}</p>
                      <Badge variant="outline" className={`text-[10px] mt-1 ${connected ? 'border-emerald-500/40 text-emerald-600' : 'text-muted-foreground'}`}>
                        {connected ? 'Connected' : 'Connects on next print'}
                      </Badge>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="secondary" disabled={!supported || busyId !== null} onClick={() => handleTest(printer)}>
                        {busyId === printer.id ? 'Printing…' : 'Test print'}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" title="Remove printer" onClick={() => handleRemove(printer)}>
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`kitchen-${printer.id}`}
                        checked={printer.kitchen}
                        onCheckedChange={(v) => updateBluetoothPrinter(printer.id, { kitchen: v === true })}
                      />
                      <Label htmlFor={`kitchen-${printer.id}`} className="text-xs cursor-pointer">Kitchen tickets</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`receipts-${printer.id}`}
                        checked={printer.receipts}
                        onCheckedChange={(v) => updateBluetoothPrinter(printer.id, { receipts: v === true })}
                      />
                      <Label htmlFor={`receipts-${printer.id}`} className="text-xs cursor-pointer">Receipts, bills &amp; reports</Label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(noKitchen || noReceipts) && (
          <p className="text-[11px] text-amber-600">
            {noKitchen && 'No printer is set for kitchen tickets. '}
            {noReceipts && 'No printer is set for receipts.'}
          </p>
        )}

        <Button onClick={handleAdd} disabled={!supported || busyId !== null} className="w-full">
          <PlusIcon className="w-4 h-4 mr-1.5" />
          {busyId === 'add' ? 'Choose a printer…' : 'Add Bluetooth Printer'}
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Turn the printer on and add it here — don't pair it in the tablet's own Bluetooth settings.
        </p>
      </CardContent>
    </Card>
  );
}
