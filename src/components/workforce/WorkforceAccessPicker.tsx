import React from 'react';
import { useTenant } from '../../contexts/TenantContext';
import {
  getWorkforceRoleDefaults,
  hasCustomWorkforceAccess,
  isWorkforceEnabled,
  isWorkforceTab,
  WORKFORCE_CUSTOM_MARKER,
  WORKFORCE_TAB_IDS,
} from '../../lib/navPermissions';
import { WORKFORCE_TAB_INFO } from '../../lib/workforce';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

interface Props {
  /** The user's allowed_tabs being edited (Operations + Workforce ids together). */
  tabs: string[];
  setTabs: (tabs: string[]) => void;
  /** Role being given to the user (drives the defaults). */
  roleName: string;
  idPrefix: string;
}

/** Staff Management section: which Workforce screens a user can open. */
export const WorkforceAccessPicker: React.FC<Props> = ({ tabs, setTabs, roleName, idPrefix }) => {
  const { tenant } = useTenant();
  if (!isWorkforceEnabled(tenant)) return null;

  const isSuperAdmin = roleName === 'super_admin';
  const isCustom = hasCustomWorkforceAccess(tabs);
  const effective = new Set<string>(
    isSuperAdmin ? WORKFORCE_TAB_IDS
      : isCustom ? WORKFORCE_TAB_IDS.filter(id => tabs.includes(id))
      : getWorkforceRoleDefaults(roleName)
  );

  const write = (next: Set<string>) => {
    const ops = tabs.filter(t => !isWorkforceTab(t));
    setTabs([...ops, WORKFORCE_CUSTOM_MARKER, ...WORKFORCE_TAB_IDS.filter(id => next.has(id))]);
  };
  const toggle = (id: string, checked: boolean) => {
    const next = new Set(effective);
    if (checked) next.add(id); else next.delete(id);
    write(next);
  };
  const useDefaults = () => setTabs(tabs.filter(t => !isWorkforceTab(t)));

  return (
    <div className="space-y-2 pt-3 border-t">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
        <div>
          <Label className="text-sm font-semibold text-foreground">Workforce Access</Label>
          <p className="text-xs text-muted-foreground">
            {isSuperAdmin
              ? 'Super Admins always have every Workforce screen.'
              : isCustom
                ? 'Custom: this person sees only the ticked Workforce screens.'
                : 'Using the defaults for this role. Tick or untick to customise.'}
          </p>
        </div>
        {!isSuperAdmin && (
          <div className="flex items-center space-x-2 text-xs">
            <button type="button" onClick={() => write(new Set(WORKFORCE_TAB_IDS))} className="text-primary hover:underline font-medium">Select All</button>
            <span className="text-muted-foreground">|</span>
            <button type="button" onClick={() => write(new Set())} className="text-muted-foreground hover:underline">Clear</button>
            {isCustom && (
              <>
                <span className="text-muted-foreground">|</span>
                <button type="button" onClick={useDefaults} className="text-muted-foreground hover:underline">Role defaults</button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-3 border rounded-lg max-h-64 overflow-y-auto bg-muted/20">
        {(['Self-service', 'Management'] as const).map(group => (
          <div key={group} className="space-y-1">
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground px-1">{group}</span>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {WORKFORCE_TAB_INFO.filter(t => t.group === group).map(t => {
                const checked = effective.has(t.id);
                return (
                  <label
                    key={t.id}
                    htmlFor={`${idPrefix}-${t.id}`}
                    className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer ${checked ? 'bg-primary/5 border-primary/40' : 'border-transparent hover:bg-muted/40'} ${isSuperAdmin ? 'opacity-70 cursor-default' : ''}`}
                  >
                    <Checkbox
                      id={`${idPrefix}-${t.id}`}
                      checked={checked}
                      disabled={isSuperAdmin}
                      onCheckedChange={c => toggle(t.id, !!c)}
                      className="mt-0.5"
                    />
                    <span className="grid leading-snug">
                      <span className="text-xs font-semibold">{t.name}</span>
                      <span className="text-[11px] text-muted-foreground">{t.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
