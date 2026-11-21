import React from 'react';
import { Briefcase, ChevronRight, LogOut, Store, type LucideIcon } from 'lucide-react';
import type { AvailableModule } from '../lib/appModules';

// Icons live here (not in the registry) so the registry stays plain data.
const MODULE_ICONS: Record<string, LucideIcon> = {
  operations: Store,
  workforce: Briefcase,
};

interface Props {
  modules: AvailableModule[];
  onPick: (module: AvailableModule) => void;
  userName: string;
  orgName: string;
  logoUrl: string;
  onSignOut: () => void;
}

export const ModuleChooser: React.FC<Props> = ({ modules, onPick, userName, orgName, logoUrl, onSignOut }) => (
  <div className="min-h-screen bg-background text-foreground flex flex-col">
    <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-white overflow-hidden border flex-shrink-0">
          <img src={logoUrl} alt="" className="w-full h-full object-cover" />
        </div>
        <span className="font-bold truncate">{orgName}</span>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <LogOut className="h-4 w-4" /> Sign out
      </button>
    </header>

    <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Hi {userName}</p>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">Where do you want to work today?</h1>
          <p className="text-sm text-muted-foreground mt-2">You can switch anytime from the sidebar.</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {modules.map((m, i) => {
            const Icon = MODULE_ICONS[m.id] || Store;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onPick(m)}
                autoFocus={i === 0}
                className="group text-left rounded-2xl border bg-card p-5 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary transition"
              >
                <div className="flex items-start gap-4">
                  <span className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-lg font-semibold">{m.name}</span>
                      <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                    </span>
                    <span className="block text-sm text-muted-foreground mt-1">{m.description}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  </div>
);
