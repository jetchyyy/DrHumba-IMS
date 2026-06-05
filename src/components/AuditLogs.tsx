import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FileTextIcon as FileText, MagnifyingGlassIcon as Search, ReloadIcon as RefreshCw, ChevronDownIcon as ChevronDown, ChevronUpIcon as ChevronUp } from '@radix-ui/react-icons';
import { Card, CardContent } from './ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';

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
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedModule, setSelectedModule] = useState('All');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

  useEffect(() => {
    loadLogs();
  }, []);

  const toggleExpand = (id: string) => {
    if (expandedLogId === id) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(id);
    }
  };

  const modules = ['All', ...Array.from(new Set(logs.map(log => log.module)))];

  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (log.user_id && log.user_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          log.module.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = selectedModule === 'All' || log.module === selectedModule;
    return matchesSearch && matchesModule;
  });

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <FileText className="w-8 h-8 text-primary" />
            <span>Immutable Audit Logs</span>
          </h2>
          <p className="text-muted-foreground mt-1">Read-only ledger tracking all user logins, inventory updates, and role alterations.</p>
        </div>

        <Button variant="outline" size="icon" onClick={loadLogs}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search action or User UUID..."
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
                <TableHead className="pl-6">Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>User ID (UUID)</TableHead>
                <TableHead className="text-right pr-6">Data Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-primary" />
                    Loading audit trail...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No audit entries match filters.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map(log => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <TableRow className="cursor-pointer" onClick={() => toggleExpand(log.id)}>
                        <TableCell className="pl-6 text-muted-foreground font-medium text-xs">
                          {new Date(log.timestamp).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-mono font-bold text-primary">{log.action}</TableCell>
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
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={5} className="p-0">
                            <div className="p-6 pl-10 border-l-2 border-primary">
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
