import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { settingsService } from '../lib/settingsService';
import { printAdjustmentSlip } from '../lib/printService';
import { PlusIcon as Plus, EyeOpenIcon as Eye, ReloadIcon as RefreshCw, TrashIcon as Trash2, FileTextIcon as Printer, ClipboardIcon as ClipboardList, CameraIcon, UploadIcon, ImageIcon, Cross2Icon as XIcon } from '@radix-ui/react-icons';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Badge } from './ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Calendar as CalendarComponent } from './ui/calendar';
import { format } from 'date-fns';
import { CalendarIcon as Calendar } from '@radix-ui/react-icons';
import { useModal } from '../contexts/ModalContext';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./ui/pagination";

interface Adjustment {
  id: string;
  control_number: string | null;
  branch_id: string;
  reason: 'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction';
  remarks: string | null;
  photo_url: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  branches?: { name: string };
}

interface AdjustmentItem {
  id: string;
  item_id: string;
  quantity_base_unit: number;
  inventory_items?: {
    item_name: string;
    base_unit: string;
  };
}

interface CatalogItem {
  id: string;
  item_name: string;
  base_unit: string;
}

export const Adjustments: React.FC = () => {
  const { profile, selectedBranch } = useAuth();
  const { confirm, showSuccess, showError } = useModal();
  
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  
  // Filter state
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, startDate, endDate]);
  
  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [selectedAdjustment, setSelectedAdjustment] = useState<Adjustment | null>(null);
  const [adjustmentItems, setAdjustmentItems] = useState<AdjustmentItem[]>([]);
  
  // Create Form state
  const [reason, setReason] = useState<'damage' | 'spoilage' | 'expired' | 'lost' | 'manual_correction'>('spoilage');
  const [remarks, setRemarks] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [addedItems, setAddedItems] = useState<{ item_id: string; qty: number }[]>([]);
  const [currentSelectedItemId, setCurrentSelectedItemId] = useState('');
  const [currentQty, setCurrentQty] = useState(-10); // Default to negative deduction
  
  const [processing, setProcessing] = useState(false);

  // Camera & File Attachment States
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');

  const startCamera = async (deviceId?: string) => {
    setCameraError('');
    try {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
      
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setCameraStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      // Enumerate devices to allow switching cameras
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(d => d.kind === 'videoinput');
      setDevices(videoDevices);
      
      const activeTrack = stream.getVideoTracks()[0];
      if (activeTrack) {
        const settings = activeTrack.getSettings();
        if (settings.deviceId) {
          setSelectedDeviceId(settings.deviceId);
        }
      }
    } catch (err: any) {
      console.error('Camera access error:', err);
      setCameraError(err.message || 'Could not access camera. Please check permissions.');
    }
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop());
      setCameraStream(null);
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      setPhotoUrl(dataUrl);
      stopCamera();
      setIsCameraActive(false);
      showSuccess("Photo captured successfully!");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 2 * 1024 * 1024) {
      showError("File size must be less than 2MB.");
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const img = new Image();
        img.src = reader.result;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const maxDim = 800;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', 0.7);
            setPhotoUrl(compressed);
            showSuccess("Image loaded and compressed successfully!");
          } else {
            setPhotoUrl(reader.result as string);
          }
        };
      }
    };
    reader.readAsDataURL(file);
  };

  const loadData = async () => {
    try {
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .select(`
          id,
          control_number,
          branch_id,
          reason,
          remarks,
          photo_url,
          status,
          created_at,
          branches (name)
        `)
        .order('created_at', { ascending: false });
      if (adjError) throw adjError;
      setAdjustments((adjData as any[]) || []);

      const { data: catData, error: catError } = await supabase
        .from('inventory_items')
        .select('id, item_name, base_unit')
        .eq('status', 'active');
      if (catError) throw catError;
      setCatalog(catData || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedBranch]);

  const handleOpenCreateModal = () => {
    setReason('spoilage');
    setRemarks('');
    setPhotoUrl('');
    setAddedItems([]);
    setIsCameraActive(false);
    stopCamera();
    if (catalog.length > 0) {
      setCurrentSelectedItemId(catalog[0].id);
      setCurrentQty(-10);
    }
    setShowCreateModal(true);
  };

  const handleAddItem = () => {
    if (!currentSelectedItemId) return;
    
    const exists = addedItems.find(i => i.item_id === currentSelectedItemId);
    if (exists) {
      showError("Item already added. Please modify it or delete first.");
      return;
    }

    setAddedItems([
      ...addedItems,
      {
        item_id: currentSelectedItemId,
        qty: Number(currentQty)
      }
    ]);
  };

  const handleRemoveItem = (index: number) => {
    setAddedItems(addedItems.filter((_, i) => i !== index));
  };

  const handleSaveAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (addedItems.length === 0) {
      showError("Add at least one item to adjust");
      return;
    }

    if (!selectedBranch) {
      showError("No branch context selected");
      return;
    }

    try {
      const { data: adjData, error: adjError } = await supabase
        .from('stock_adjustments')
        .insert({
          branch_id: selectedBranch.id,
          reason,
          remarks: remarks.trim() || null,
          photo_url: photoUrl.trim() || null,
          status: 'pending'
        })
        .select()
        .single();

      if (adjError) throw adjError;

      const itemsPayload = addedItems.map(item => ({
        adjustment_id: adjData.id,
        item_id: item.item_id,
        quantity_base_unit: item.qty
      }));

      const { error: itemsError } = await supabase
        .from('stock_adjustment_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      await supabase
        .from('notifications')
        .insert({
          branch_id: selectedBranch.id,
          type: 'adjustment_pending',
          message: `New adjustment (${reason}) pending approval at ${selectedBranch.name}`
        });

      showSuccess("Adjustment logged and pending approval!");
      setTimeout(() => {
        setShowCreateModal(false);
        loadData();
      }, 800);
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Error logging adjustment');
    }
  };

  const handleViewAdjustment = async (adj: Adjustment) => {
    setSelectedAdjustment(adj);
    try {
      const { data, error } = await supabase
        .from('stock_adjustment_items')
        .select(`
          id,
          item_id,
          quantity_base_unit,
          inventory_items (
            item_name,
            base_unit
          )
        `)
        .eq('adjustment_id', adj.id);
      
      if (error) throw error;
      setAdjustmentItems(data as any[] || []);
      setShowViewModal(true);
    } catch (err) {
      console.error(err);
      showError("Error fetching adjustment items");
    }
  };

  const handleApproveAdjustment = async (adjustmentId: string) => {
    if (!await confirm(
      'Approve Stock Adjustment',
      'Are you sure you want to approve this stock adjustment? Balance corrections will be instantly applied and movement ledgers committed.'
    )) return;

    setProcessing(true);
    try {
      const { error } = await supabase.rpc('fn_process_adjustment', {
        p_adjustment_id: adjustmentId
      });

      if (error) throw error;

      showSuccess("Adjustment approved and inventory records updated!");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to approve adjustment.');
    } finally {
      setProcessing(false);
    }
  };

  const handleRejectAdjustment = async (adjustmentId: string) => {
    if (!await confirm('Reject Adjustment Request', 'Are you sure you want to reject this request?')) return;

    try {
      const { error } = await supabase
        .from('stock_adjustments')
        .update({ status: 'rejected', approved_by: profile?.id })
        .eq('id', adjustmentId);

      if (error) throw error;

      showSuccess("Adjustment request rejected successfully.");
      setShowViewModal(false);
      loadData();
    } catch (err: any) {
      console.error(err);
      showError(err.message || 'Failed to reject adjustment.');
    }
  };

  const canApprove = profile && ['super_admin', 'inventory_manager'].includes(profile.role_name);

  const handlePrintReceipt = async (adjustment: Adjustment, items: AdjustmentItem[]) => {
    try {
      const settings = await settingsService.getSettings();
      printAdjustmentSlip(adjustment, items, settings.transfer_slip);
    } catch (err) {
      console.error('Failed to print adjustment receipt:', err);
      showError("Failed to load print templates.");
    }
  };

  const hasActionPermission = profile && (
    profile.role_name === 'super_admin' || 
    (profile.allowed_tabs && profile.allowed_tabs.includes('action_buttons'))
  );

  const handleDeleteAdjustment = async (adj: Adjustment) => {
    const isApproved = adj.status === 'approved';
    const message = isApproved
      ? `Are you sure you want to delete adjustment request ${adj.control_number || adj.id}? WARNING: This adjustment is already APPROVED. Deleting it will not reverse the inventory changes that occurred.`
      : `Are you sure you want to delete adjustment request ${adj.control_number || adj.id}?`;

    if (!await confirm('Delete Adjustment Request', message)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('stock_adjustments')
        .delete()
        .eq('id', adj.id);

      if (error) throw error;

      showSuccess("Adjustment log deleted successfully");
      loadData();
    } catch (err: any) {
      console.error('Error deleting adjustment request:', err);
      showError(err.message || 'Error deleting adjustment request');
    }
  };

  const filteredAdjustments = adjustments.filter(adj => {
    let matchesDate = true;
    const aDate = new Date(adj.created_at);
    const now = new Date();

    if (dateFilter === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      matchesDate = aDate >= todayStart;
    } else if (dateFilter === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      matchesDate = aDate >= weekAgo;
    } else if (dateFilter === 'month') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      matchesDate = aDate >= monthAgo;
    } else if (dateFilter === 'custom') {
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        matchesDate = matchesDate && aDate >= start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        matchesDate = matchesDate && aDate <= end;
      }
    }
    return matchesDate;
  });

  const totalPages = Math.ceil(filteredAdjustments.length / itemsPerPage);
  const paginatedAdjustments = filteredAdjustments.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex-1 p-4 md:p-8 overflow-y-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 space-y-4 md:space-y-0">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center space-x-2">
            <ClipboardList className="w-8 h-8 text-primary" />
            <span>Stock Adjustments</span>
          </h2>
          <p className="text-muted-foreground">Log damages, spoilage, or manual inventory count corrections.</p>
        </div>

        <div className="flex items-center space-x-3">
          <Button variant="outline" size="icon" onClick={loadData}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          
          <Button onClick={handleOpenCreateModal}>
            <Plus className="mr-2 h-4 w-4" />
            Create Adjustment Log
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-muted-foreground font-medium">Filter by Date:</span>
          <Select value={dateFilter} onValueChange={(v: any) => setDateFilter(v)}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Time" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 Days</SelectItem>
              <SelectItem value="month">Last 30 Days</SelectItem>
              <SelectItem value="custom">Custom Range</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {dateFilter === 'custom' && (
        <Card className="bg-muted/30 mb-6">
          <CardContent className="p-4 flex flex-col sm:flex-row items-center gap-4 text-sm">
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-muted-foreground">Start:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9">
                    <Calendar className="mr-2 h-4 w-4" />
                    {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={startDate} onSelect={setStartDate} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <span className="text-muted-foreground">End:</span>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-[150px] justify-start text-left font-normal h-9">
                    <Calendar className="mr-2 h-4 w-4" />
                    {endDate ? format(endDate, 'PPP') : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <CalendarComponent mode="single" selected={endDate} onSelect={setEndDate} />
                </PopoverContent>
              </Popover>
            </div>
            {(startDate || endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStartDate(undefined);
                  setEndDate(undefined);
                }}
                className="text-muted-foreground"
              >
                Clear Custom
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="px-6 py-4">
          <CardTitle>Adjustment Logs</CardTitle>
          <CardDescription>View all pending and processed inventory corrections.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Control No / Date</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Remarks</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right pr-6">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAdjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    No adjustments found for the selected dates.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedAdjustments.map(adj => (
                <TableRow key={adj.id}>
                  <TableCell className="pl-6">
                    <div className="font-bold">{adj.control_number || 'Pending'}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{new Date(adj.created_at).toLocaleDateString()}</div>
                  </TableCell>
                  <TableCell>{adj.branches?.name || 'Unknown'}</TableCell>
                  <TableCell className="capitalize">
                    {adj.reason.replace('_', ' ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">{adj.remarks || 'No remarks'}</TableCell>
                  <TableCell>
                    <Badge variant={
                      adj.status === 'approved' ? 'default' :
                      adj.status === 'rejected' ? 'destructive' : 'secondary'
                    } className="uppercase text-[10px]">
                      {adj.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex justify-end space-x-1">
                      <Button variant="ghost" size="sm" onClick={() => handleViewAdjustment(adj)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View
                      </Button>
                      {hasActionPermission && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteAdjustment(adj)}
                          title="Delete Adjustment Log"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="py-4 border-t">
              <Pagination>
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className={currentPage === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <PaginationItem key={i}>
                      <PaginationLink 
                        onClick={() => setCurrentPage(i + 1)}
                        isActive={currentPage === i + 1}
                        className="cursor-pointer"
                      >
                        {i + 1}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext 
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      className={currentPage === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CREATE MODAL */}
      <Dialog 
        open={showCreateModal} 
        onOpenChange={(open) => {
          setShowCreateModal(open);
          if (!open) {
            stopCamera();
            setIsCameraActive(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <DialogTitle>Log Stock Adjustment</DialogTitle>
            <DialogDescription>
              Submit an inventory count correction. Requires manager approval.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveAdjustment} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Adjustment Reason *</Label>
                <Select value={reason} onValueChange={(v: any) => setReason(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="spoilage">Spoilage</SelectItem>
                    <SelectItem value="damage">Damage / Spill</SelectItem>
                    <SelectItem value="expired">Expired Goods</SelectItem>
                    <SelectItem value="lost">Lost / Theft</SelectItem>
                    <SelectItem value="manual_correction">Manual Count Correction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex justify-between items-center">
                  <span>Photo Attachment (Optional)</span>
                  {photoUrl && (
                    <Button 
                      type="button" 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 px-2 text-destructive text-xs hover:bg-destructive/10"
                      onClick={() => setPhotoUrl('')}
                    >
                      Remove Photo
                    </Button>
                  )}
                </Label>
                
                {photoUrl ? (
                  <div className="border border-border/80 rounded-lg p-3 bg-muted/20 relative group overflow-hidden">
                    {photoUrl.startsWith('data:image/') ? (
                      <div className="flex flex-col items-center">
                        <img 
                          src={photoUrl} 
                          alt="Attachment preview" 
                          className="max-h-40 rounded-md object-contain border bg-background shadow-sm"
                        />
                        <span className="text-[10px] text-muted-foreground mt-2 font-medium">
                          Captured / Uploaded Image ({Math.round(photoUrl.length / 1024)} KB)
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center space-y-2">
                        <img 
                          src={photoUrl} 
                          alt="Attachment preview" 
                          className="max-h-40 rounded-md object-contain border bg-background shadow-sm"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                          }}
                        />
                        <div className="w-full flex items-center space-x-2">
                          <Input
                            value={photoUrl}
                            onChange={(e) => setPhotoUrl(e.target.value)}
                            placeholder="Image URL"
                            className="text-xs h-8"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-dashed border-border/100 rounded-lg p-6 bg-muted/10 flex flex-col items-center justify-center space-y-4">
                    <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold">Add proof of damage or spoilage</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Capture with camera, upload a file, or provide a link</p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="bg-primary text-primary-foreground font-semibold"
                        onClick={() => {
                          setIsCameraActive(true);
                          startCamera();
                        }}
                      >
                        <CameraIcon className="w-4 h-4 mr-1.5" />
                        Take Photo
                      </Button>
                      
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          id="adjustment-file-upload"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="font-semibold"
                          asChild
                        >
                          <label htmlFor="adjustment-file-upload">
                            <UploadIcon className="w-4 h-4 mr-1.5" />
                            Upload File
                          </label>
                        </Button>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground text-xs hover:bg-muted"
                        onClick={() => setPhotoUrl('https://')}
                      >
                        Use Image URL
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks / Explanation *</Label>
              <Input
                required
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="e.g. Freezers went down overnight"
              />
            </div>

            {/* Add Item Sub-Form */}
            <Card className="bg-muted/50">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                  <div className="md:col-span-2 space-y-2">
                    <Label>Select Item</Label>
                    <Select value={currentSelectedItemId} onValueChange={setCurrentSelectedItemId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an item" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.map(item => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.item_name} ({item.base_unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Qty (Negative to deduct)</Label>
                    <Input
                      type="number"
                      value={currentQty}
                      onChange={(e) => setCurrentQty(Number(e.target.value))}
                    />
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button type="button" variant="secondary" onClick={handleAddItem}>
                    Add Item
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Added Items List */}
            <div>
              <h4 className="text-sm font-semibold mb-3">Adjustments List ({addedItems.length})</h4>
              <div className="border rounded-md max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item Name</TableHead>
                      <TableHead className="text-right">Adjustment Amount</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {addedItems.map((item, idx) => {
                      const info = catalog.find(c => c.id === item.item_id);
                      return (
                        <TableRow key={idx}>
                          <TableCell className="font-medium">{info?.item_name}</TableCell>
                          <TableCell className={`text-right font-bold ${item.qty < 0 ? 'text-destructive' : 'text-primary'}`}>
                            {item.qty > 0 ? `+${item.qty}` : item.qty} {info?.base_unit}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => handleRemoveItem(idx)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            </div>

            <DialogFooter className="p-6 border-t shrink-0">
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button type="submit">
                Submit for Approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CAMERA CAPTURE DIALOG */}
      <Dialog 
        open={isCameraActive} 
        onOpenChange={(open) => {
          if (!open) {
            stopCamera();
            setIsCameraActive(false);
          }
        }}
      >
        <DialogContent className="max-w-md p-0 overflow-hidden bg-black text-white border-none">
          <DialogHeader className="p-4 bg-zinc-900 border-b border-zinc-800 shrink-0 flex-row items-center justify-between space-y-0">
            <DialogTitle className="text-white text-base">Capture Photo Attachment</DialogTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-zinc-400 hover:text-white hover:bg-zinc-800"
              onClick={() => {
                stopCamera();
                setIsCameraActive(false);
              }}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </DialogHeader>

          <div className="relative bg-zinc-950 aspect-video md:aspect-[4/3] flex items-center justify-center">
            {cameraError ? (
              <div className="p-6 text-center text-rose-400 space-y-3">
                <p className="text-sm font-semibold">{cameraError}</p>
                <Button 
                  type="button" 
                  variant="outline" 
                  className="bg-transparent border-zinc-700 text-white hover:bg-zinc-800"
                  onClick={() => startCamera(selectedDeviceId)}
                >
                  Retry Access
                </Button>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-4 border-2 border-dashed border-white/20 rounded-md pointer-events-none flex items-center justify-center">
                  <span className="text-[10px] uppercase tracking-wider text-white/40 font-semibold px-2 py-1 bg-black/40 rounded">
                    Align item in frame
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="p-4 bg-zinc-900 flex flex-col space-y-4 items-center shrink-0">
            {devices.length > 1 && (
              <div className="w-full flex items-center space-x-2 justify-center">
                <span className="text-xs text-zinc-400">Switch Camera:</span>
                <Select 
                  value={selectedDeviceId} 
                  onValueChange={(id) => {
                    setSelectedDeviceId(id);
                    startCamera(id);
                  }}
                >
                  <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 h-8 text-xs text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700 text-white">
                    {devices.map((device, idx) => (
                      <SelectItem key={device.deviceId} value={device.deviceId} className="text-xs hover:bg-zinc-700 focus:bg-zinc-700 text-white">
                        {device.label || `Camera ${idx + 1}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div className="flex items-center justify-center space-x-6 py-2">
              <Button
                type="button"
                variant="outline"
                className="bg-transparent border-zinc-700 text-white hover:bg-zinc-800 px-4 h-10 text-xs font-semibold"
                onClick={() => {
                  stopCamera();
                  setIsCameraActive(false);
                }}
              >
                Cancel
              </Button>
              
              <Button
                type="button"
                disabled={!!cameraError || !cameraStream}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-bold h-12 w-12 rounded-full p-0 flex items-center justify-center border-4 border-zinc-800 hover:scale-105 transition-transform"
                onClick={capturePhoto}
                title="Capture Photo"
              >
                <div className="w-4 h-4 rounded-full bg-white" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
 
      {/* VIEW MODAL */}
      <Dialog open={showViewModal} onOpenChange={setShowViewModal}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="p-6 border-b shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle>
                  {selectedAdjustment && ['spoilage', 'damage', 'expired'].includes(selectedAdjustment.reason) ? 'Food Waste: ' : 'Adjustment: '}
                  {selectedAdjustment?.control_number || 'Pending'}
                </DialogTitle>
                <DialogDescription className="font-mono text-xs">
                  ID: {selectedAdjustment?.id}
                </DialogDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mr-6"
                onClick={() => selectedAdjustment && handlePrintReceipt(selectedAdjustment, adjustmentItems)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Print PDF
              </Button>
            </div>
          </DialogHeader>

          {selectedAdjustment && (
            <>
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded-lg">
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Branch Location</span>
                  <span className="font-medium">{selectedAdjustment.branches?.name}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Reason</span>
                  <span className="font-medium capitalize">{selectedAdjustment.reason.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Created Date</span>
                  <span className="font-medium">{new Date(selectedAdjustment.created_at).toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Status</span>
                  <Badge variant={
                    selectedAdjustment.status === 'approved' ? 'default' :
                    selectedAdjustment.status === 'rejected' ? 'destructive' : 'secondary'
                  } className="uppercase mt-1 text-[10px]">
                    {selectedAdjustment.status}
                  </Badge>
                </div>
                {selectedAdjustment.photo_url && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold mb-1">Attachment Photo</span>
                    {selectedAdjustment.photo_url.startsWith('data:image/') ? (
                      <div className="mt-1 border border-border/80 rounded bg-background p-2 max-w-xs shadow-sm">
                        <img 
                          src={selectedAdjustment.photo_url} 
                          alt="Attachment" 
                          className="max-h-32 rounded object-contain mx-auto"
                        />
                      </div>
                    ) : (
                      <a href={selectedAdjustment.photo_url} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all text-xs font-semibold">
                        {selectedAdjustment.photo_url}
                      </a>
                    )}
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-muted-foreground block text-xs uppercase tracking-wider font-semibold">Remarks</span>
                  <span className="font-medium">{selectedAdjustment.remarks || 'No remarks'}</span>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold mb-3">Adjusted Items</h4>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Name</TableHead>
                        <TableHead className="text-right pr-4">Adjustment Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {adjustmentItems.map((item, idx) => {
                        const name = item.inventory_items?.item_name || 'Deleted Item';
                        const unit = item.inventory_items?.base_unit || 'unit';
                        return (
                          <TableRow key={idx}>
                            <TableCell className="font-medium">{name}</TableCell>
                            <TableCell className={`text-right font-bold pr-4 ${item.quantity_base_unit < 0 ? 'text-destructive' : 'text-primary'}`}>
                              {item.quantity_base_unit > 0 ? `+${item.quantity_base_unit}` : item.quantity_base_unit} {unit}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>

              </div>

              <DialogFooter className="p-6 border-t shrink-0 flex space-x-2 sm:space-x-0">
                {selectedAdjustment.status === 'pending' && canApprove ? (
                  <>
                    <Button variant="destructive" onClick={() => handleRejectAdjustment(selectedAdjustment.id)}>
                      Reject Adjustment
                    </Button>
                    <Button disabled={processing} onClick={() => handleApproveAdjustment(selectedAdjustment.id)}>
                      {processing ? 'Processing...' : 'Approve & Apply'}
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" onClick={() => setShowViewModal(false)}>
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
