import React from 'react';
import { Store } from 'lucide-react';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

export const PageShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="p-4 md:p-6 space-y-5 max-w-7xl w-full mx-auto">{children}</div>
);

export const EmptyState: React.FC<{ title: string; children?: React.ReactNode; icon?: React.ReactNode }> = ({ title, children, icon }) => (
  <div className="border border-dashed rounded-xl p-8 text-center space-y-2 bg-muted/20">
    {icon && <div className="flex justify-center text-muted-foreground">{icon}</div>}
    <p className="font-semibold">{title}</p>
    {children && <div className="text-sm text-muted-foreground max-w-md mx-auto">{children}</div>}
  </div>
);

export const NoBranchNotice: React.FC = () => (
  <EmptyState title="No branch selected">
    Choose a branch with the branch filter above.
  </EmptyState>
);


/** Branch picker for Workforce screens. Branch managers see their branch as a label. */
export const BranchFilter: React.FC<{ allowAll?: boolean }> = ({ allowAll = true }) => {
  const { branchId, options, canAll, setBranchId, branchName, selectedBranch } = useWorkforceBranch();
  const showAll = allowAll && canAll;
  if (options.length <= 1 && !showAll) {
    return (
      <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border text-sm">
        <Store className="h-4 w-4 text-muted-foreground" />
        {branchName(branchId)}
      </span>
    );
  }
  const value = branchId === 'all' && !showAll ? (selectedBranch?.id || options[0]?.id || '') : branchId;
  return (
    <Select value={value} onValueChange={setBranchId}>
      <SelectTrigger className="h-9 w-[200px]" aria-label="Filter by branch">
        <Store className="h-4 w-4 mr-1.5 text-muted-foreground flex-shrink-0" />
        <SelectValue placeholder="Choose branch" />
      </SelectTrigger>
      <SelectContent>
        {showAll && <SelectItem value="all">All branches</SelectItem>}
        {options.map(b => (
          <SelectItem key={b.id} value={b.id}>{b.name}{b.is_warehouse ? ' (Warehouse)' : ''}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/** Small branch label shown next to a staff name when viewing all branches. */
export const BranchTag: React.FC<{ name: string }> = ({ name }) => (
  <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground align-middle">{name}</span>
);
