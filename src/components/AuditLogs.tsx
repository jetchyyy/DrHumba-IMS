import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { FileText, Search, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

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

  // Modules list for filtering
  const modules = ['All', ...Array.from(new Set(logs.map(log => log.module)))];

  // Filters
  const filteredLogs = logs.filter(log => {
    const matchesSearch = log.action.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (log.user_id && log.user_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
                          log.module.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesModule = selectedModule === 'All' || log.module === selectedModule;
    return matchesSearch && matchesModule;
  });

  return (
    <div className="flex-1 p-8 overflow-y-auto bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold text-white tracking-tight flex items-center space-x-2">
            <FileText className="w-6 h-6 text-indigo-500" />
            <span>Immutable Audit Logs</span>
          </h2>
          <p className="text-sm text-slate-400">Read-only ledger tracking all user logins, inventory updates, and role alterations.</p>
        </div>

        <button
          onClick={loadLogs}
          className="p-2 bg-slate-900 border border-slate-800 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
        <div className="flex items-center space-x-3 bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-lg flex-1">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search action or User UUID..."
            className="bg-transparent text-sm text-white focus:outline-none w-full"
          />
        </div>
        <div>
          <select
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-xs text-white rounded px-2.5 py-1.5 focus:outline-none"
          >
            {modules.map(mod => (
              <option key={mod} value={mod}>
                {mod}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Logs Grid */}
      {loading ? (
        <div className="flex items-center justify-center p-8">
          <span className="text-xs text-slate-500 animate-pulse">Loading audit trail...</span>
        </div>
      ) : (
        <div className="glass rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-4 pl-6">Timestamp</th>
                  <th className="p-4">Action</th>
                  <th className="p-4">Module</th>
                  <th className="p-4">User ID (UUID)</th>
                  <th className="p-4 text-right pr-6">Data Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filteredLogs.map(log => {
                  const isExpanded = expandedLogId === log.id;
                  return (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-slate-900/10 text-slate-300">
                        <td className="p-4 pl-6 text-slate-500 font-medium">
                          {new Date(log.timestamp).toLocaleString()}
                        </td>
                        <td className="p-4 font-mono font-bold text-indigo-400">{log.action}</td>
                        <td className="p-4">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-400 border border-slate-700/50">
                            {log.module}
                          </span>
                        </td>
                        <td className="p-4 text-slate-500 font-mono">{log.user_id || 'SYSTEM'}</td>
                        <td className="p-4 text-right pr-6">
                          <button
                            onClick={() => toggleExpand(log.id)}
                            className="flex items-center space-x-1 ml-auto bg-slate-900 border border-slate-800 hover:bg-slate-800 px-2 py-1 rounded text-[10px] font-semibold text-slate-300 transition-all"
                          >
                            <span>Inspect Payload</span>
                            {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-950/80">
                          <td colSpan={5} className="p-6 pl-10 border-b border-slate-800/30">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block mb-2">
                                  Old State Values
                                </span>
                                <pre className="bg-slate-900 p-4 rounded-lg text-[10px] text-slate-300 border border-slate-850 overflow-x-auto max-h-40">
                                  {log.old_value ? JSON.stringify(log.old_value, null, 2) : 'NULL'}
                                </pre>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider block mb-2">
                                  New State Values
                                </span>
                                <pre className="bg-slate-900 p-4 rounded-lg text-[10px] text-slate-300 border border-slate-850 overflow-x-auto max-h-40">
                                  {log.new_value ? JSON.stringify(log.new_value, null, 2) : 'NULL'}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filteredLogs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center p-8 text-slate-500">
                      No audit entries matches filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
