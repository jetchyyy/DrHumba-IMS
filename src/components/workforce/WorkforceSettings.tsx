import React, { useCallback, useEffect, useState } from 'react';
import { Crosshair, ExternalLink, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useModal } from '../../contexts/ModalContext';
import { useAuth } from '../../contexts/AuthContext';
import { getDevicePosition, mapsLink } from '../../lib/workforce';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { BranchFilter, PageHeader, PageShell } from './shared';
import { useWorkforceBranch } from '../../hooks/useWorkforceBranch';
import { errorMessage } from '../../lib/workforce';

interface GeoBranch {
  id: string;
  name: string;
  is_warehouse: boolean;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m: number | null;
}

interface Draft { lat: string; lng: string; radius: string }

const WorkforceSettings: React.FC = () => {
  const { profile } = useAuth();
  const { branch: filterBranch } = useWorkforceBranch();
  const { showSuccess, showError } = useModal();
  const [rows, setRows] = useState<GeoBranch[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [locating, setLocating] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const roleName = profile?.role_name;
  const profileBranchId = profile?.branch_id;

  const load = useCallback(async () => {
    let q = supabase.from('branches').select('id, name, is_warehouse, latitude, longitude, geofence_radius_m').order('name');
    if (roleName !== 'super_admin' && profileBranchId) q = q.eq('id', profileBranchId);
    const { data, error } = await q;
    if (error) { showError(errorMessage(error)); return; }
    const list = (data as GeoBranch[]) || [];
    setRows(list);
    setDrafts(Object.fromEntries(list.map(b => [b.id, {
      lat: b.latitude?.toString() ?? '',
      lng: b.longitude?.toString() ?? '',
      radius: String(b.geofence_radius_m ?? 100),
    }])));
  }, [roleName, profileBranchId, showError]);

  useEffect(() => { load(); }, [load]);

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts(d => ({ ...d, [id]: { ...d[id], ...patch } }));

  const fillFromDevice = async (id: string) => {
    setLocating(id);
    try {
      const pos = await getDevicePosition(20000);
      setDraft(id, { lat: pos.latitude.toFixed(6), lng: pos.longitude.toFixed(6) });
      if (pos.accuracy > 50) {
        showError(`Location accuracy is only about ${Math.round(pos.accuracy)} m. For best results do this inside the branch, near the entrance, with GPS on.`);
      }
    } catch (err) {
      showError(errorMessage(err));
    } finally {
      setLocating(null);
    }
  };

  const save = async (id: string, clear = false) => {
    const d = drafts[id];
    const lat = clear ? null : Number(d.lat);
    const lng = clear ? null : Number(d.lng);
    const radius = Number(d.radius || 100);
    if (!clear && (d.lat === '' || d.lng === '' || Number.isNaN(lat) || Number.isNaN(lng))) {
      showError('Enter a latitude and longitude, or use this device\'s location.');
      return;
    }
    if (!clear && (radius < 25 || radius > 1000)) { showError('Radius must be between 25 and 1000 metres.'); return; }
    setSaving(id);
    const { error } = await supabase.rpc('fn_set_branch_geofence', {
      p_branch_id: id, p_latitude: lat, p_longitude: lng, p_radius_m: radius,
    });
    setSaving(null);
    if (error) { showError(errorMessage(error)); return; }
    showSuccess(clear ? 'Branch location cleared. Time clock is off for this branch.' : 'Branch location saved.');
    load();
  };

  return (
    <PageShell>
      <PageHeader
        title="Branch Geofence"
        description="Staff can only time in or out when their phone (or the kiosk device) is within this distance of the branch."
        actions={<BranchFilter />}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.filter(b => !filterBranch || b.id === filterBranch.id).map(b => {
          const d = drafts[b.id];
          if (!d) return null;
          const isSet = b.latitude !== null && b.longitude !== null;
          return (
            <Card key={b.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> {b.name}
                  {b.is_warehouse && <Badge variant="outline" className="text-[10px]">Warehouse</Badge>}
                  {isSet ? <Badge className="ml-auto text-[10px]">Set</Badge> : <Badge variant="outline" className="ml-auto text-[10px]">Not set</Badge>}
                </CardTitle>
                <CardDescription>
                  {isSet ? (
                    <a href={mapsLink(b.latitude!, b.longitude!)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                      Open saved spot in Google Maps <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : 'Time clock is disabled for this branch until a location is saved.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button variant="outline" className="w-full" onClick={() => fillFromDevice(b.id)} disabled={locating !== null}>
                  <Crosshair className={`h-4 w-4 mr-2 ${locating === b.id ? 'animate-spin' : ''}`} />
                  {locating === b.id ? 'Getting location…' : 'Use this device\'s current location'}
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`lat-${b.id}`} className="text-xs">Latitude</Label>
                    <Input id={`lat-${b.id}`} inputMode="decimal" value={d.lat} onChange={e => setDraft(b.id, { lat: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`lng-${b.id}`} className="text-xs">Longitude</Label>
                    <Input id={`lng-${b.id}`} inputMode="decimal" value={d.lng} onChange={e => setDraft(b.id, { lng: e.target.value })} />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`rad-${b.id}`} className="text-xs">Radius (m)</Label>
                    <Input id={`rad-${b.id}`} inputMode="numeric" value={d.radius} onChange={e => setDraft(b.id, { radius: e.target.value.replace(/\D/g, '') })} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  {isSet && <Button variant="ghost" size="sm" onClick={() => save(b.id, true)} disabled={saving !== null}>Clear</Button>}
                  <Button size="sm" onClick={() => save(b.id)} disabled={saving !== null}>{saving === b.id ? 'Saving…' : 'Save'}</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tip: 100 m works for most stores. Use a bigger radius inside malls where GPS drifts.
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </PageShell>
  );
};

export default WorkforceSettings;
