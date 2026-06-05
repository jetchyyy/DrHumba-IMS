import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ShoppingCart, Plus, Minus, Trash2, Search, CheckCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { useToast } from '../hooks/use-toast';
import { ScrollArea } from './ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from './ui/sheet';

interface MenuItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  is_available: boolean;
}

interface CartItem {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
}

export const POS: React.FC = () => {
  const { selectedBranch } = useAuth();
  const { toast } = useToast();
  
  const [items, setItems] = useState<MenuItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [loading, setLoading] = useState(true);
  
  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);
  
  // Item Modal state
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [itemQuantity, setItemQuantity] = useState(1);

  // Submission state
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSaleId, setLastSaleId] = useState<string | null>(null);

  const loadMenuItems = async () => {
    setLoading(true);
    try {
      const { data, error: itemError } = await supabase
        .from('menu_items')
        .select('*')
        .eq('status', 'active')
        .eq('is_available', true)
        .order('name');
      
      if (itemError) throw itemError;
      setItems(data || []);
    } catch (err) {
      console.error('Error loading menu items for POS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMenuItems();
  }, []);

  const addToCart = (item: MenuItem, qty: number = 1) => {
    const exists = cart.find(ci => ci.menu_item_id === item.id);
    if (exists) {
      setCart(
        cart.map(ci =>
          ci.menu_item_id === item.id ? { ...ci, quantity: ci.quantity + qty } : ci
        )
      );
    } else {
      setCart([
        ...cart,
        {
          menu_item_id: item.id,
          name: item.name,
          price: Number(item.price),
          quantity: qty
        }
      ]);
    }
    toast({ title: "Added to Cart", description: `${qty}x ${item.name} added.`, duration: 2000 });
  };

  const updateCartQty = (menuItemId: string, amount: number) => {
    setCart(
      cart
        .map(ci => {
          if (ci.menu_item_id === menuItemId) {
            const newQty = ci.quantity + amount;
            return newQty > 0 ? { ...ci, quantity: newQty } : null;
          }
          return ci;
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeFromCart = (menuItemId: string) => {
    setCart(cart.filter(ci => ci.menu_item_id !== menuItemId));
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!selectedBranch) {
      toast({ title: "Validation Error", description: "Please select an active branch context first from the sidebar.", variant: "destructive" });
      return;
    }

    setCheckingOut(true);
    setLastSaleId(null);

    try {
      const payload = cart.map(ci => ({
        menu_item_id: ci.menu_item_id,
        quantity: ci.quantity
      }));

      const { data: saleId, error: rpcError } = await supabase.rpc('fn_process_sale', {
        p_branch_id: selectedBranch.id,
        p_items: payload
      });

      if (rpcError) throw rpcError;

      toast({ title: "Success", description: "Sale successfully completed! Invoice logged." });
      setLastSaleId(saleId);
      setCart([]);
      setIsCartSheetOpen(false);
    } catch (err: any) {
      console.error('POS Checkout Transaction failed:', err);
      toast({ 
        title: "Transaction Failed", 
        description: err.message || 'Transaction rolled back. Insufficient ingredient stocks in this branch!', 
        variant: "destructive" 
      });
    } finally {
      setCheckingOut(false);
    }
  };

  const handleItemClick = (item: MenuItem) => {
    setSelectedItem(item);
    setItemQuantity(1);
  };

  // Categories list
  const categories = ['All', ...Array.from(new Set(items.map(item => item.category)))];

  // Filters
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          item.sku.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const renderCartContent = () => (
    <>
      {/* Cart Header */}
      <div className="p-4 md:p-6 border-b flex items-center space-x-3 bg-background shrink-0">
        <ShoppingCart className="w-5 h-5 text-primary" />
        <h3 className="font-bold text-sm uppercase tracking-wider flex-1">Shopping Cart</h3>
        <Badge variant="default" className="text-[10px]">
          {cart.reduce((sum, item) => sum + item.quantity, 0)} Items
        </Badge>
      </div>

      {/* Cart Item List */}
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-3">
          {cart.map(item => (
            <Card key={item.menu_item_id} className="bg-background/60 backdrop-blur-sm shadow-sm">
              <CardContent className="p-3 flex items-center justify-between text-xs">
                <div className="flex-1 min-w-0 pr-2">
                  <h5 className="font-bold truncate" title={item.name}>{item.name}</h5>
                  <p className="text-[10px] text-muted-foreground mt-0.5">₱{item.price.toFixed(2)} each</p>
                </div>
                <div className="flex items-center space-x-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => updateCartQty(item.menu_item_id, -1)}
                  >
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="font-bold px-1 w-4 text-center select-none">{item.quantity}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => updateCartQty(item.menu_item_id, 1)}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 ml-1 text-muted-foreground hover:text-destructive"
                    onClick={() => removeFromCart(item.menu_item_id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}

          {cart.length === 0 && (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground p-8 mt-10">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                <ShoppingCart className="w-5 h-5 opacity-50" />
              </div>
              <p className="text-sm font-medium">Your cart is empty</p>
              <p className="text-xs mt-1">Tap dishes on the catalog to add them.</p>
            </div>
          )}
          
          {lastSaleId && cart.length === 0 && (
             <Alert className="mt-4 border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle className="h-4 w-4" color="currentColor" />
                <AlertTitle className="text-xs font-bold">Last Sale ID</AlertTitle>
                <AlertDescription className="text-[10px] font-mono break-all mt-1">
                  {lastSaleId}
                </AlertDescription>
             </Alert>
          )}
        </div>
      </ScrollArea>

      {/* Checkout Summary */}
      <div className="p-4 md:p-6 border-t bg-background space-y-4 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] shrink-0">
        <div className="flex justify-between items-center text-sm font-semibold text-muted-foreground">
          <span>Subtotal</span>
          <span>₱{cartTotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between items-center text-base font-bold">
          <span>Total Value</span>
          <span className="text-primary text-xl">₱{cartTotal.toFixed(2)}</span>
        </div>

        {!selectedBranch && (
          <div className="text-[10px] text-amber-500 text-center font-medium bg-amber-500/10 p-2 rounded border border-amber-500/20">
            ⚠️ Warning: You cannot checkout without an assigned branch context.
          </div>
        )}

        <Button
          size="lg"
          className="w-full font-bold shadow-md"
          onClick={handleCheckout}
          disabled={checkingOut || cart.length === 0 || !selectedBranch}
        >
          {checkingOut ? 'Processing Checkout...' : 'Place Order & Complete'}
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex-1 flex overflow-hidden h-full relative">
      {/* Menu / Catalog Panel */}
      <div className="flex-1 flex flex-col p-4 md:p-8 overflow-y-auto pb-32 lg:pb-8">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between space-y-4 md:space-y-0">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Point of Sale (POS)</h2>
            <p className="text-muted-foreground">
              Checkout transactions. Ingredient deductions will be validated at the database layer.
            </p>
          </div>
          {selectedBranch && (
            <Badge variant="outline" className="px-3.5 py-1.5 text-xs font-semibold bg-primary/10 text-primary border-primary/20">
              Checkout location: <span className="underline font-bold ml-1">{selectedBranch.name}</span>
            </Badge>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search dish name or SKU..."
              className="pl-9"
            />
          </div>
          <div className="flex space-x-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
            {categories.map(cat => (
              <Button
                key={cat}
                variant={selectedCategory === cat ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat)}
                className="whitespace-nowrap"
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Grid List */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="text-muted-foreground animate-pulse">Loading menu items...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 content-start">
            {filteredItems.map(item => (
              <Card
                key={item.id}
                onClick={() => handleItemClick(item)}
                className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md group flex flex-col justify-between h-36"
              >
                <CardContent className="p-4 flex flex-col h-full justify-between">
                  <div>
                    <Badge variant="secondary" className="text-[9px] uppercase mb-1">
                      {item.category}
                    </Badge>
                    <h4 className="text-sm font-bold group-hover:text-primary transition-colors line-clamp-2">
                      {item.name}
                    </h4>
                    <span className="text-[10px] text-muted-foreground font-mono mt-0.5 block">{item.sku}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold">₱{Number(item.price).toFixed(2)}</span>
                    <Button variant="secondary" size="sm" className="h-7 text-xs font-bold group-hover:bg-primary group-hover:text-primary-foreground transition-all">
                      Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}

            {filteredItems.length === 0 && (
              <div className="col-span-full text-center p-8 text-muted-foreground">
                No active dishes found matching criteria.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Desktop Cart Panel */}
      <div className="hidden lg:flex w-96 border-l bg-muted/10 flex-col h-full shrink-0">
        {renderCartContent()}
      </div>

      {/* Mobile Cart Floating Bottom Bar */}
      <div className="lg:hidden fixed bottom-16 md:bottom-0 left-0 right-0 p-4 bg-background border-t shadow-[0_-10px_20px_rgba(0,0,0,0.1)] flex justify-between items-center z-40">
        <div>
          <p className="text-xs text-muted-foreground font-semibold">Total ({cart.reduce((sum, item) => sum + item.quantity, 0)} items)</p>
          <p className="text-lg font-bold text-primary">₱{cartTotal.toFixed(2)}</p>
        </div>
        <Sheet open={isCartSheetOpen} onOpenChange={setIsCartSheetOpen}>
          <SheetTrigger asChild>
            <Button size="lg" className="font-bold shadow-md relative">
              View Cart
              {cart.length > 0 && (
                <span className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-background">
                  {cart.reduce((sum, item) => sum + item.quantity, 0)}
                </span>
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-[90vw] sm:w-[400px] p-0 gap-0 flex flex-col bg-muted/10">
            <SheetTitle className="sr-only">Shopping Cart</SheetTitle>
            <SheetDescription className="sr-only">Review your items and checkout</SheetDescription>
            {renderCartContent()}
          </SheetContent>
        </Sheet>
      </div>

      {/* Item Details Modal */}
      <Dialog open={!!selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">{selectedItem?.name}</DialogTitle>
            <DialogDescription>
              SKU: {selectedItem?.sku} | Category: {selectedItem?.category}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col space-y-6 py-4">
            <div className="flex justify-between items-center text-lg font-medium">
              <span className="text-muted-foreground">Price per unit</span>
              <span className="font-bold">₱{Number(selectedItem?.price).toFixed(2)}</span>
            </div>
            
            <div className="flex items-center justify-between">
              <span className="font-semibold">Quantity</span>
              <div className="flex items-center space-x-4">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-10 w-10 rounded-full"
                  onClick={() => setItemQuantity(Math.max(1, itemQuantity - 1))}
                >
                  <Minus className="h-5 w-5" />
                </Button>
                <span className="w-8 text-center font-bold text-xl">{itemQuantity}</span>
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-10 w-10 rounded-full"
                  onClick={() => setItemQuantity(itemQuantity + 1)}
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div className="flex justify-between items-center text-xl font-bold border-t pt-6">
              <span>Total</span>
              <span className="text-primary">₱{(Number(selectedItem?.price) * itemQuantity).toFixed(2)}</span>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-0">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setSelectedItem(null)}>Cancel</Button>
            <Button 
              className="w-full sm:w-auto font-bold" 
              onClick={() => {
                if (selectedItem) {
                  addToCart(selectedItem, itemQuantity);
                  setSelectedItem(null);
                }
              }}
            >
              Add {itemQuantity} to Cart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

