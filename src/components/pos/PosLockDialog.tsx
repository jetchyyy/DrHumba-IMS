import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Lock, Unlock, KeyRound, Delete } from 'lucide-react';
import { ReloadIcon as Spinner } from '@radix-ui/react-icons';
import { supabase } from '../../lib/supabase';
import {
  isValidLockPin,
  lockPosWithPin,
  verifyAndUnlockPosPin,
  forceUnlockPos,
} from '../../lib/posLock';

interface PosLockDialogProps {
  open: boolean;
  mode: 'lock' | 'unlock';
  isOnline: boolean;
  userEmail?: string | null;
  onClose: () => void;
  onLocked: () => void;
  onUnlocked: () => void;
}

export const PosLockDialog: React.FC<PosLockDialogProps> = ({
  open,
  mode,
  isOnline,
  userEmail,
  onClose,
  onLocked,
  onUnlocked,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPasswordFallback, setShowPasswordFallback] = useState(false);
  const [accountPassword, setAccountPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setConfirmPin('');
      setShowPasswordFallback(false);
      setAccountPassword('');
      setErrorMsg('');
      setSubmitting(false);
    }
  }, [open, mode]);

  const appendDigit = (digit: string) => {
    setErrorMsg('');
    setPin(prev => (prev.length < 6 ? prev + digit : prev));
  };

  const handleLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!isValidLockPin(pin)) {
      setErrorMsg('PIN must be 4 to 6 digits.');
      return;
    }
    if (pin !== confirmPin) {
      setErrorMsg('PINs do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await lockPosWithPin(pin);
      onLocked();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to lock POS.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (showPasswordFallback) {
      if (!userEmail || !accountPassword) {
        setErrorMsg('Enter your account password to unlock.');
        return;
      }
      setSubmitting(true);
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: accountPassword,
        });
        if (error) {
          setErrorMsg('Incorrect account password.');
          return;
        }
        forceUnlockPos();
        onUnlocked();
        onClose();
      } catch (err: any) {
        setErrorMsg(err.message || 'Failed to verify password.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!isValidLockPin(pin)) {
      setErrorMsg('Enter your 4 to 6 digit unlock PIN.');
      return;
    }

    setSubmitting(true);
    try {
      const ok = await verifyAndUnlockPosPin(pin);
      if (!ok) {
        setErrorMsg('Incorrect PIN. Please try again.');
        setPin('');
        return;
      }
      onUnlocked();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to verify PIN.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <DialogContent className="max-w-sm p-6">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            {mode === 'lock' ? (
              <>
                <Lock className="w-4 h-4 text-primary" />
                <span>Lock POS Mode</span>
              </>
            ) : (
              <>
                <Unlock className="w-4 h-4 text-amber-500" />
                <span>Unlock POS Mode</span>
              </>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {mode === 'lock'
              ? 'Set a 4–6 digit PIN to lock this device to POS only (hides sidebar, branch switcher, settings, and sign out—even offline). Pair with Android App Pinning to prevent closing the PWA.'
              : showPasswordFallback
                ? `Verify password for ${userEmail} to clear the POS lock.`
                : 'Enter the 4–6 digit lock PIN to restore full navigation and exit POS lock.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'lock' ? (
          <form onSubmit={handleLockSubmit} className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label className="text-xs">Enter 4–6 Digit PIN *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                placeholder="••••"
                value={pin}
                onChange={e => {
                  setErrorMsg('');
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                }}
                className="text-center text-lg font-mono tracking-[0.4em]"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Confirm PIN *</Label>
              <Input
                type="password"
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                placeholder="••••"
                value={confirmPin}
                onChange={e => {
                  setErrorMsg('');
                  setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                }}
                className="text-center text-lg font-mono tracking-[0.4em]"
              />
            </div>

            {errorMsg && (
              <p className="text-xs font-semibold text-destructive">{errorMsg}</p>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="text-xs font-bold gap-1.5"
              >
                {submitting ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                <span>Lock to POS</span>
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleUnlockSubmit} className="space-y-4 pt-1">
            {showPasswordFallback ? (
              <div className="space-y-1.5">
                <Label className="text-xs">Account Password *</Label>
                <Input
                  type="password"
                  placeholder="Enter account password"
                  value={accountPassword}
                  onChange={e => {
                    setErrorMsg('');
                    setAccountPassword(e.target.value);
                  }}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unlock PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    pattern="\d*"
                    maxLength={6}
                    placeholder="••••"
                    value={pin}
                    onChange={e => {
                      setErrorMsg('');
                      setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                    }}
                    className="text-center text-xl font-mono tracking-[0.5em] h-11"
                    autoFocus
                  />
                </div>

                {/* Touch-friendly numeric keypad */}
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
                    <Button
                      key={digit}
                      type="button"
                      variant="outline"
                      onClick={() => appendDigit(digit)}
                      className="h-11 text-base font-bold rounded-xl"
                    >
                      {digit}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setErrorMsg('');
                      setPin('');
                    }}
                    className="h-11 text-xs font-bold text-muted-foreground rounded-xl"
                  >
                    Clear
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => appendDigit('0')}
                    className="h-11 text-base font-bold rounded-xl"
                  >
                    0
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setErrorMsg('');
                      setPin(prev => prev.slice(0, -1));
                    }}
                    className="h-11 rounded-xl"
                    title="Backspace"
                  >
                    <Delete className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}

            {errorMsg && (
              <p className="text-xs font-semibold text-destructive">{errorMsg}</p>
            )}

            {isOnline && userEmail && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setShowPasswordFallback(prev => !prev);
                  }}
                  className="text-xs text-primary hover:underline font-medium inline-flex items-center gap-1"
                >
                  <KeyRound className="w-3 h-3" />
                  <span>
                    {showPasswordFallback ? 'Use PIN instead' : 'Forgot PIN? Unlock with account password'}
                  </span>
                </button>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={submitting}
                className="text-xs font-bold gap-1.5 bg-amber-500 hover:bg-amber-600 text-black"
              >
                {submitting ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                <span>Unlock POS</span>
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
