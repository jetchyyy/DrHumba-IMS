import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { LayersIcon } from '@radix-ui/react-icons';
import { Badge } from './ui/badge';

export const ActiveBranchPill: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  
  const canSwitchBranch = profile && ['super_admin', 'inventory_manager', 'auditor'].includes(profile.role_name);
  
  if (!canSwitchBranch || !selectedBranch) return null;

  return (
    <div className="hidden md:flex fixed top-4 left-1/2 transform -translate-x-1/2 z-[60] pointer-events-none animate-in slide-in-from-top-4 fade-in duration-500 shadow-xl rounded-full">
      <Badge 
        variant="outline" 
        className="px-3 md:px-4 py-1.5 md:py-2 bg-black text-white hover:bg-black hover:text-white dark:bg-white dark:text-black dark:hover:bg-white dark:hover:text-black border-slate-800 dark:border-slate-200 gap-1.5 md:gap-2 font-medium flex items-center whitespace-nowrap"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75 dark:bg-black"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white dark:bg-black"></span>
        </span>
        <LayersIcon className="w-3.5 h-3.5 md:w-4 md:h-4 opacity-70" />
        <span className="tracking-wide text-[10px] md:text-xs">
          <span className="hidden sm:inline">You are currently using </span>
          <span className="font-bold sm:ml-1">{selectedBranch.name}</span>
          {selectedBranch.is_warehouse && <span className="text-[9px] md:text-[10px] ml-1 uppercase opacity-75">(Warehouse)</span>}
        </span>
      </Badge>
    </div>
  );
};
