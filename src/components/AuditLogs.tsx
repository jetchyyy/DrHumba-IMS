import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FileTextIcon as FileText, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ChevronDownIcon as ChevronDown, ChevronUpIcon as ChevronUp } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { useAuth } from '../contexts/AuthContext';

interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  module: string;
  old_value: any;
  new_value: any;
  ip_address: string | null;
  timestamp: string;
}

export const AuditLogs: React.FC = () => {
  const { branches } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState('All');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'simple' | 'technical'>('simple');
  
  // Lookup data for resolving UUIDs to friendly names
  const [userEmails, setUserEmails] = useState<Record<string, string>>({});
  const [inventoryItems, setInventoryItems] = useState<Record<string, string>>({});
  const [menuItems, setMenuItems] = useState<Record<string, string>>({});

  const loadLogs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select('*')
        .order('timestamp', { ascending: false });

      if (error) throw error;
      setLogs(data || []);
    } catch (err) {
      console.error('Error fetching audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadLookupData = async () => {
    try {
      // Fetch user profiles (emails)
      const { data: profileData } = await supabase.from('profiles').select('id, email');
      const emailMap: Record<string, string> = {};
      profileData?.forEach(p => {
        emailMap[p.id] = p.email;
      });
      setUserEmails(emailMap);

      // Fetch inventory items
      const { data: invData } = await supabase.from('inventory_items').select('id, item_name');
      const invMap: Record<string, string> = {};
      invData?.forEach(i => {
        invMap[i.id] = i.item_name;
      });
      setInventoryItems(invMap);

      // Fetch menu items
      const { data: menuData } = await supabase.from('menu_items').select('id, name');
      const menuMap: Record<string, string> = {};
      menuData?.forEach(m => {
        menuMap[m.id] = m.name;
      });
      setMenuItems(menuMap);
    } catch (err) {
      console.error('Error loading lookup data for audit logs:', err);
    }
  };

  useEffect(() => {
    loadLogs();
    loadLookupData();
  }, []);

  const toggleExpand = (id: string) => {
    if (expandedLogId === id) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(id);
    }
  };

  const formatFriendlyAction = (log: AuditLog) => {
    const getBranchName = (id: string) => {
      const b = branches.find(branch => branch.id === id);
      return b ? b.name : 'Unknown Branch';
    };

    switch (log.action) {
      case 'CREATE_STAFF': {
        const email = log.new_value?.email || 'N/A';
        const role = (log.new_value?.role || 'N/A').replace('_', ' ');
        return `Created a new staff account for ${email} as a ${role}`;
      }
      case 'RECEIVE_STOCK': {
        const branchName = log.new_value?.branch_id ? getBranchName(log.new_value.branch_id) : 'N/A';
        return `Received stock shipment at ${branchName}`;
      }
      case 'POS_SALE': {
        const total = log.new_value?.total_amount ? `₱${Number(log.new_value.total_amount).toFixed(2)}` : 'N/A';
        const method = (log.new_value?.payment_method || 'cash').toUpperCase();
        const branchName = log.new_value?.branch_id ? getBranchName(log.new_value.branch_id) : 'N/A';
        return `Completed a sale of ${total} (${method}) at ${branchName}`;
      }
      case 'VOID_SALE': {
        const reason = log.new_value?.void_reason || 'No reason specified';
        return `Voided/refunded sale (Reason: "${reason}")`;
      }
      case 'TRANSFER_REQUEST': {
        const source = log.new_value?.source ? getBranchName(log.new_value.source) : 'N/A';
        const target = log.new_value?.target ? getBranchName(log.new_value.target) : 'N/A';
        return `Requested inventory transfer from ${source} to ${target}`;
      }
      case 'TRANSFER_APPROVE': {
        return 'Approved and dispatched stock transfer shipment';
      }
      case 'TRANSFER_SEND': {
        const source = log.new_value?.source ? getBranchName(log.new_value.source) : 'N/A';
        const target = log.new_value?.target ? getBranchName(log.new_value.target) : 'N/A';
        return `Dispatched inventory transfer from ${source} to ${target}`;
      }
      case 'TRANSFER_RECEIVE': {
        return 'Confirmed receipt of inventory transfer';
      }
      case 'ADJUSTMENT_APPROVE': {
        return 'Approved a stock adjustment';
      }
      default: {
        const cleanAction = log.action.toLowerCase().replace(/_/g, ' ');
        return `Performed ${cleanAction} in the ${log.module} module`;
      }
    }
  };

  const renderFriendlyDetails = (log: AuditLog) => {
    const getBranchName = (id: string) => {
      const b = branches.find(branch => branch.id === id);
      return b ? b.name : id;
    };

    const formatVal = (key: string, val: any): string => {
      if (val === null || val === undefined) return 'None';
      if (typeof val === 'boolean') return val ? 'Yes' : 'No';
      if (typeof val === 'object') return JSON.stringify(val);
      
      if (key.includes('branch_id') || key === 'source' || key === 'target') {
        return getBranchName(String(val));
      }
      if (key === 'item_id') {
        return inventoryItems[String(val)] || String(val);
      }
      if (key === 'menu_item_id') {
        return menuItems[String(val)] || String(val);
      }
      if (['user_id', 'staff_id', 'cashier_id', 'voided_by', 'approved_by', 'reviewed_by', 'requested_by'].includes(key)) {
        return userEmails[String(val)] || String(val);
      }
      if (['total_amount', 'amount_tendered', 'change_given', 'price', 'cost_per_base_unit', 'cost_per_purchase_unit', 'unit_price', 'subtotal'].includes(key)) {
        const num = Number(val);
        return isNaN(num) ? String(val) : `₱${num.toFixed(2)}`;
      }
      return String(val);
    };

    const formatKey = (key: string): string => {
      return key
        .replace(/_id$/g, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    };

    const oldVal = log.old_value;
    const newVal = log.new_value;

    if (!oldVal && !newVal) {
      return <div className="text-muted-foreground text-sm">No transaction details recorded.</div>;
    }

    if (!oldVal || !newVal) {
      const targetObj = newVal || oldVal;
      const isAdded = !!newVal;
      return (
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {isAdded ? 'Recorded Details' : 'Removed Details'}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {Object.entries(targetObj).map(([key, val]) => (
              <div key={key} className="bg-muted/40 p-3 rounded-lg border">
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">{formatKey(key)}</div>
                <div className="text-sm font-medium mt-1 text-foreground">{formatVal(key, val)}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const allKeys = Array.from(new Set([...Object.keys(oldVal), ...Object.keys(newVal)]));
    const changes: { key: string; oldV: any; newV: any }[] = [];
    for (const key of allKeys) {
      const ov = oldVal[key];
      const nv = newVal[key];
      if (JSON.stringify(ov) !== JSON.stringify(nv)) {
        changes.push({ key, oldV: ov, newV: nv });
      }
    }

    if (changes.length === 0) {
      return <div className="text-muted-foreground text-sm">No fields were modified.</div>;
    }

    return (
      <div className="space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Modified Fields Summary
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table className="bg-muted/20">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="font-semibold">Field</TableHead>
                <TableHead className="font-semibold">Previous Value</TableHead>
                <TableHead className="font-semibold">Updated Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {changes.map(({ key, oldV, newV }) => (
                <TableRow key={key}>
                  <TableCell className="font-medium">{formatKey(key)}</TableCell>
                  <TableCell className="text-destructive font-mono text-xs line-through bg-red-500/5">{formatVal(key, oldV)}</TableCell>
                  <TableCell className="text-emerald-500 font-mono text-xs font-bold bg-emerald-500/5">{formatVal(key, newV)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  };

  const modules = ['All', ...Array.from(new Set(logs.map(log => log.module)))];

  const filteredLogs = logs.filter(log => {
    const userEmail = log.user_id ? userEmails[log.user_id] || '' : 'system';
    const friendlyAction = formatFriendlyAction(log);
    const searchLower = searchTerm.toLowerCase();

    const matchesSearch = log.action.toLowerCase().includes(searchLower) || 
                          (log.user_id && log.user_id.toLowerCase().includes(searchLower)) ||
                          log.module.toLowerCase().includes(searchLower) ||
                          userEmail.toLowerCase().includes(searchLower) ||
                          friendlyAction.toLowerCase().includes(searchLower);

    const matchesModule = selectedModule === 'All' || log.module === selectedModule;
    return matchesSearch && matchesModule;
  });

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8 space-y-4 lg:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <FileText className="w-8 h-8 text-primary" />
            <span>Immutable Audit Logs</span>
          </h2>
          <p className="text-muted-foreground mt-1">Read-only ledger tracking all user logins, inventory updates, and role alterations.</p>
        </div>

        <div className="flex items-center space-x-3 self-start lg:self-auto">
          <Tabs value={viewMode} onValueChange={(val: any) => setViewMode(val)} className="w-fit">
            <TabsList className="grid grid-cols-2 w-[280px] bg-muted/60 p-1">
              <TabsTrigger value="simple" className="text-xs">Friendly View</TabsTrigger>
              <TabsTrigger value="technical" className="text-xs">Technical View</TabsTrigger>
            </TabsList>
          </Tabs>

          <Button variant="outline" size="icon" onClick={loadLogs} className="h-9 w-9">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={viewMode === 'simple' ? "Search activity, user email, or module..." : "Search action or User UUID..."}
            className="pl-9"
          />
        </div>
        <Select value={selectedModule} onValueChange={setSelectedModule}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="All Modules" />
          </SelectTrigger>
          <SelectContent>
            {modules.map(mod => (
              <SelectItem key={mod} value={mod}>{mod}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Logs Grid */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6 w-[200px]">Timestamp</TableHead>
                {viewMode === 'simple' ? (
                  <>
                    <TableHead>Activity</TableHead>
                    <TableHead className="w-[150px]">Module</TableHead>
                    <TableHead className="w-[200px]">Performed By</TableHead>
                    <TableHead className="text-right pr-6 w-[150px]">Summary</TableHead>
                  </>
                ) : (
                  <>
                    <TableHead>Action</TableHead>
                    <TableHead className="w-[150px]">Module</TableHead>
                    <TableHead>User ID (UUID)</TableHead>
                    <TableHead className="text-right pr-6 w-[150px]">Data Details</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={viewMode === 'simple' ? 5 : 5} className="h-24 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading audit trail...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={viewMode === 'simple' ? 5 : 5} className="h-24 text-center text-muted-foreground">
                    No audit entries match filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map(log => {
                  const isExpanded = expandedLogId === log.id;
                  const userEmail = log.user_id ? userEmails[log.user_id] || log.user_id : 'SYSTEM';
                  return (
                    <React.Fragment key={log.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/40 transition-colors" onClick={() => toggleExpand(log.id)}>
                        <TableCell className="pl-6 text-muted-foreground font-medium text-xs">
                          {new Date(log.timestamp).toLocaleString()}
                        </TableCell>
                        
                        {viewMode === 'simple' ? (
                          <>
                            <TableCell className="font-semibold text-sm text-foreground">
                              {formatFriendlyAction(log)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] bg-muted/50">
                                {log.module}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs font-medium">{userEmail}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="h-8">
                                Inspect
                                {isExpanded ? <ChevronUp className="w-3 h-3 ml-2" /> : <ChevronDown className="w-3 h-3 ml-2" />}
                              </Button>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="font-mono font-bold text-primary text-xs">{log.action}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-[10px] bg-muted/50">
                                {log.module}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs">{log.user_id || 'SYSTEM'}</TableCell>
                            <TableCell className="text-right pr-6">
                              <Button variant="ghost" size="sm" className="h-8">
                                Inspect Payload
                                {isExpanded ? <ChevronUp className="w-3 h-3 ml-2" /> : <ChevronDown className="w-3 h-3 ml-2" />}
                              </Button>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={viewMode === 'simple' ? 5 : 5} className="p-0">
                            <div className="p-6 pl-10 border-l-2 border-primary">
                              {viewMode === 'simple' ? (
                                renderFriendlyDetails(log)
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                  <div>
                                    <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-2">
                                      Old State Values
                                    </span>
                                    <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border overflow-x-auto max-h-48 whitespace-pre-wrap">
                                      {log.old_value ? JSON.stringify(log.old_value, null, 2) : 'NULL'}
                                    </pre>
                                  </div>
                                  <div>
                                    <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider block mb-2">
                                      New State Values
                                    </span>
                                    <pre className="bg-muted p-4 rounded-lg text-xs font-mono text-foreground border overflow-x-auto max-h-48 whitespace-pre-wrap">
                                      {log.new_value ? JSON.stringify(log.new_value, null, 2) : 'NULL'}
                                    </pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
