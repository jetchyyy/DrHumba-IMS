import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SymbolIcon as ArrowLeftRight } from '@radix-ui/react-icons';

export const ActiveBranchSplashScreen: React.FC = () => {
  const { selectedBranch } = useAuth();
  const [showSplash, setShowSplash] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [isWarehouse, setIsWarehouse] = useState(false);
  const prevBranchId = useRef<string | null>(null);

  useEffect(() => {
    if (selectedBranch?.id) {
      if (prevBranchId.current && prevBranchId.current !== selectedBranch.id) {
        // Trigger splash screen
        setBranchName(selectedBranch.name);
        setIsWarehouse(!!selectedBranch.is_warehouse);
        setShowSplash(true);
        setIsFadingOut(false);
        
        // Start fade out after 1.5 seconds
        const timer = setTimeout(() => {
          setIsFadingOut(true);
          
          // Remove from DOM after fade out completes
          setTimeout(() => {
            setShowSplash(false);
          }, 500);
        }, 1500);

        return () => clearTimeout(timer);
      }
      prevBranchId.current = selectedBranch.id;
    }
  }, [selectedBranch?.id, selectedBranch?.name, selectedBranch?.is_warehouse]);

  if (!showSplash) return null;

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black text-white ${
      isFadingOut ? 'animate-out fade-out duration-500' : 'animate-in fade-in duration-300'
    }`}>
      <div className={`flex flex-col items-center justify-center space-y-6 ${
        isFadingOut ? 'animate-out slide-out-to-top-8 fade-out duration-500 zoom-out-95' : 'animate-in slide-in-from-bottom-8 duration-700 fade-in zoom-in-95'
      }`}>
        <ArrowLeftRight className="w-16 h-16 animate-[spin_3s_linear_infinite]" />
        <div className="text-center space-y-2">
          <p className="text-xs uppercase tracking-[0.3em] text-gray-400 font-bold">Switching Context</p>
          <h1 className="text-5xl font-black tracking-tighter">{branchName}</h1>
          {isWarehouse && (
            <div className="mt-4">
              <span className="text-[10px] uppercase tracking-widest text-black bg-white font-bold px-3 py-1 rounded-sm">
                Warehouse
              </span>
            </div>
          )}
        </div>
      </div>
      
      {/* Decorative lines for a sleek look */}
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white to-transparent opacity-20"></div>
      <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-white to-transparent opacity-20"></div>
    </div>
  );
};

