import React, { createContext, useContext, useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../components/ui/dialog';
import { Button } from '../components/ui/button';

interface ModalContextType {
  confirm: (title: string, message: string) => Promise<boolean>;
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const ModalProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Confirm state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  // Status state
  const [statusOpen, setStatusOpen] = useState(false);
  const [statusType, setStatusType] = useState<'success' | 'error'>('success');
  const [statusMessage, setStatusMessage] = useState('');
  const statusTimeoutRef = useRef<any>(null);

  const confirm = (title: string, message: string): Promise<boolean> => {
    // If a confirm is already active, reject it as false first
    if (resolveRef.current) {
      resolveRef.current(false);
    }
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  };

  const handleConfirmClose = (value: boolean) => {
    setConfirmOpen(false);
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
  };

  const showSuccess = (message: string) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusType('success');
    setStatusMessage(message);
    setStatusOpen(true);
    statusTimeoutRef.current = setTimeout(() => {
      setStatusOpen(false);
      statusTimeoutRef.current = null;
    }, 3000);
  };

  const showError = (message: string) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusType('error');
    setStatusMessage(message);
    setStatusOpen(true);
    statusTimeoutRef.current = setTimeout(() => {
      setStatusOpen(false);
      statusTimeoutRef.current = null;
    }, 3000);
  };

  return (
    <ModalContext.Provider value={{ confirm, showSuccess, showError }}>
      {children}
      
      {/* GLOBAL CONFIRMATION DIALOG */}
      <Dialog 
        open={confirmOpen} 
        onOpenChange={(open) => { 
          if (!open) handleConfirmClose(false); 
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmTitle}</DialogTitle>
            <DialogDescription>{confirmMessage}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => handleConfirmClose(false)}>
              Cancel
            </Button>
            <Button onClick={() => handleConfirmClose(true)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* GLOBAL STATUS ALERT DIALOG */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="max-w-md text-center py-8">
          <div className="flex flex-col items-center justify-center space-y-4">
            {statusType === 'success' ? (
              <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center text-3xl font-extrabold animate-bounce">
                ✓
              </div>
            ) : (
              <div className="w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center text-3xl font-extrabold animate-pulse">
                ✕
              </div>
            )}
            <h3 className="text-xl font-bold uppercase tracking-wide">
              {statusType === 'success' ? 'Success' : 'Error'}
            </h3>
            <p className="text-muted-foreground text-sm max-w-xs px-2">
              {statusMessage}
            </p>
            <div className="text-[10px] text-muted-foreground/60 italic pt-2">
              Closing automatically in 3 seconds...
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};
