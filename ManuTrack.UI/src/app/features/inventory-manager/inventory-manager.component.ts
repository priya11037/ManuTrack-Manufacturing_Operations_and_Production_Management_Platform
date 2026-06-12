import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';
import { WorkOrderService, WorkOrderViewModel } from '../../core/services/workorder.service';
import {
  InventoryService, InventoryItemViewModel,
  PurchaseOrderViewModel, SupplierViewModel
} from '../../core/services/inventory.service';
import { ComponentService, ComponentViewModel } from '../../core/services/component.service';
import { AnalyticsService, DashboardSummaryViewModel } from '../../core/services/analytics.service';
import { NotificationViewModel } from '../../core/services/notification.service';
import { WorkOrderStatuses } from '../../shared/constants/enums';

type Section = 'overview' | 'inventory' | 'products' | 'workorders' | 'analytics' | 'notifications';
type InvTab = 'items' | 'po' | 'suppliers';

@Component({
  selector: 'app-inventory-manager',
  standalone: false,
  templateUrl: './inventory-manager.component.html',
  styleUrl: './inventory-manager.component.css'
})
export class InventoryManagerComponent implements OnInit {
  activeSection: Section = 'overview';
  inventoryTab: InvTab = 'items';
  stockTab: 'components' | 'finished' = 'components';

  userName: string;
  userInitials: string;

  inventoryItems: InventoryItemViewModel[] = [];
  purchaseOrders: PurchaseOrderViewModel[] = [];
  suppliers: SupplierViewModel[] = [];
  components: ComponentViewModel[] = [];
  products: ProductViewModel[] = [];
  bomByProduct: Record<number, BomViewModel[]> = {};
  expandedBomProducts = new Set<number>();
  workOrders: WorkOrderViewModel[] = [];
  notifications: NotificationViewModel[] = [];
  unreadCount = 0;
  analytics: DashboardSummaryViewModel | null = null;

  inventoryLoading = false; inventoryError = '';
  poLoading = false; poError = '';
  suppliersLoading = false;
  productsLoading = false;
  workOrdersLoading = false;
  analyticsLoading = false;
  notificationsLoading = false;

  showInventoryModal = false;
  showAdjustModal = false;
  showPOModal = false;
  showSupplierModal = false;

  adjustingItem: InventoryItemViewModel | null = null;
  inventoryForm!: FormGroup;
  adjustForm!: FormGroup;
  poForm!: FormGroup;
  supplierForm!: FormGroup;

  inventoryCreateLoading = false;
  adjustLoading = false;
  poCreateLoading = false;
  supplierLoading = false;

  poLineItems: Array<{ inventoryID: number | string; quantity: number | string; unitPrice: number | string }> = [
    { inventoryID: '', quantity: '', unitPrice: '' }
  ];

  toastMsg = ''; toastType: 'success' | 'error' = 'success';
  errorAlert = '';
  readonly workOrderStatuses = WorkOrderStatuses;

  constructor(
    private auth: AuthService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private workOrderSvc: WorkOrderService,
    private inventorySvc: InventoryService,
    private componentSvc: ComponentService,
    private analyticsSvc: AnalyticsService,
    private fb: FormBuilder,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.userName = this.auth.getName() ?? 'Inventory Manager';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    this.inventoryForm = this.fb.group({
      itemType: ['Product'],
      productID: [''], componentID: [''], productName: [''],
      quantityOnHand: ['', [Validators.required, Validators.min(0)]],
      minimumQuantity: ['', [Validators.required, Validators.min(0)]],
      notes: ['']
    });

    this.adjustForm = this.fb.group({
      adjustment: ['', Validators.required],
      reason: ['', [Validators.required, Validators.minLength(5)]]
    });

    this.poForm = this.fb.group({
      supplierName: ['', Validators.required],
      expectedDeliveryDate: ['', Validators.required],
      notes: ['']
    });

    this.supplierForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      contactPerson: [''], phone: ['', Validators.pattern(/^[0-9]{10}$/)],
      email: ['', Validators.email], address: ['']
    });
  }

  ngOnInit(): void {
    this.loadInventory();
    this.loadPurchaseOrders();
    this.loadSuppliers();
    this.loadProducts();
    this.loadWorkOrders();
    this.loadAnalytics();
    this.loadNotifications();
    this.componentSvc.getAll().pipe(timeout(10000)).subscribe({ next: res => { this.components = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  get sectionTitle(): string {
    const m: Record<Section,string> = { overview:'Overview', inventory:'Inventory & Stock', products:'Products & BOM', workorders:'Work Orders', analytics:'Analytics', notifications:'Notifications' };
    return m[this.activeSection];
  }
  showSection(s: Section): void { this.activeSection = s; }

  // ── Auto-notify Admin after PO creation ─────────────
  private notifyAdminNewPO(po: PurchaseOrderViewModel): void {
    const item = po.items?.[0];
    this.http.post<any>('http://localhost:5000/api/v1/notifications/notify-role', {
      targetRole: 'Admin',
      title: `PO-${po.poid} Approval Required`,
      message: `Purchase Order PO-${po.poid} from ${po.supplierName} for ${item?.productName ?? 'items'} (Qty: ${item?.quantity ?? '—'}, ₹${po.totalAmount?.toFixed(2)}) requires your approval.`,
      category: 'Inventory',
      priority: 'High'
    }).pipe(timeout(8000)).subscribe();
  }

  // ── Analytics computed stats ──────────────────────────
  get totalInventoryItems(): number { return this.inventoryItems.length; }
  get approvedPOCount(): number { return this.purchaseOrders.filter(p => p.status === 'Approved').length; }
  get orderedPOCount(): number { return this.purchaseOrders.filter(p => p.status === 'Ordered').length; }
  get receivedPOCount(): number { return this.purchaseOrders.filter(p => p.status === 'Received').length; }
  get cancelledPOCount(): number { return this.purchaseOrders.filter(p => p.status === 'Cancelled').length; }
  get totalPOValue(): number { return this.purchaseOrders.reduce((sum, p) => sum + (p.totalAmount ?? 0), 0); }
  get stockHealthRate(): number { return this.totalInventoryItems ? Math.round(this.inStockCount / this.totalInventoryItems * 100) : 0; }
  get activeSuppliersCount(): number { return this.suppliers.filter(s => s.isActive).length; }

  woFunnelPct(status: string): number {
    const count = this.workOrders.filter(w => w.status === status).length;
    return this.workOrders.length ? Math.round(count / this.workOrders.length * 100) : 0;
  }
  invDonutGradient(): string {
    const t = this.totalInventoryItems || 1;
    const ok = Math.round(this.inStockCount / t * 100);
    const low = Math.round(this.lowStockCount / t * 100);
    return `conic-gradient(#22c55e 0% ${ok}%, #f59e0b ${ok}% ${ok+low}%, #ef4444 ${ok+low}% 100%)`;
  }
  poDonutGradient(): string {
    const t = this.purchaseOrders.length || 1;
    const p = Math.round(this.pendingPOCount / t * 100);
    const a = Math.round(this.approvedPOCount / t * 100);
    const o = Math.round(this.orderedPOCount / t * 100);
    return `conic-gradient(#f59e0b 0% ${p}%, #3b82f6 ${p}% ${p+a}%, #a855f7 ${p+a}% ${p+a+o}%, #22c55e ${p+a+o}% 100%)`;
  }
  gaugeGradient(rate: number, hi = 70, mid = 40): string {
    const c = rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
    return `conic-gradient(${c} 0% ${rate}%, #e5e7eb ${rate}% 100%)`;
  }
  gaugeColor(rate: number, hi = 70, mid = 40): string {
    return rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
  }
  maxPoStatus(): number {
    return Math.max(this.pendingPOCount, this.approvedPOCount, this.orderedPOCount, this.receivedPOCount, 1);
  }
  supplierPoCountN(name: string): number { return this.purchaseOrders.filter(p => p.supplierName === name).length; }
  maxSupplierPo(): number {
    if (!this.suppliers.length) return 1;
    return Math.max(...this.suppliers.map(s => this.supplierPoCountN(s.name)), 1);
  }

  // INVENTORY FULL CRUD 
  get ivf() { return this.inventoryForm.controls; }
  get af()  { return this.adjustForm.controls; }
  get pof() { return this.poForm.controls; }
  get sf()  { return this.supplierForm.controls; }

  get componentItems()    { return this.inventoryItems.filter(i => i.itemType !== 'Product'); }
  get finishedItems()     { return this.inventoryItems.filter(i => i.itemType === 'Product'); }
  get visibleStockItems() { return this.stockTab === 'components' ? this.componentItems : this.finishedItems; }

  get inStockCount()    { return this.inventoryItems.filter(i => i.status==='InStock').length; }
  get lowStockCount()   { return this.inventoryItems.filter(i => i.status==='LowStock').length; }
  get outOfStockCount() { return this.inventoryItems.filter(i => i.status==='OutOfStock').length; }
  get pendingPOCount()  { return this.purchaseOrders.filter(p => p.status==='Pending').length; }
  get activeComponents(){ return this.components.filter(c => c.isActive); }

  loadInventory(): void {
    this.inventoryLoading = true; this.inventoryError = '';
    this.inventorySvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.inventoryLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.inventoryItems = res?.data ?? []; this.cdr.detectChanges(); }, error: () => { this.inventoryError = 'Failed to load inventory.'; } });
  }

  onInventoryProductSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const p = this.products.find(x => x.productID === id);
    if (p) {
      this.inventoryForm.patchValue({ productName: p.name });
      // Autofill qty from completed work orders for this product
      const completedQty = this.workOrders
        .filter(w => w.productID === id && w.status === 'Completed')
        .reduce((sum, w) => sum + w.quantity, 0);
      if (completedQty > 0) {
        this.inventoryForm.patchValue({ quantityOnHand: completedQty });
      }
    }
  }

  onInventoryComponentSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const c = this.components.find(x => x.componentID === id);
    if (c) this.inventoryForm.patchValue({ productName: c.name });
  }

  createInventoryItem(): void {
    if (this.inventoryForm.invalid) { this.inventoryForm.markAllAsTouched(); return; }
    const v = this.inventoryForm.value;
    const isRaw = v.itemType === 'RawMaterial';
    if (isRaw && !v.componentID) { this.showToast('Select a raw material.', 'error'); return; }
    if (!isRaw && !v.productID) { this.showToast('Select a product.', 'error'); return; }
    this.inventoryCreateLoading = true;
    this.inventorySvc.create({
      itemType: v.itemType,
      productID: isRaw ? undefined : +v.productID,
      componentID: isRaw ? +v.componentID : undefined,
      productName: v.productName,
      quantityOnHand: +v.quantityOnHand, minimumQuantity: +v.minimumQuantity,
      notes: v.notes || undefined
    }).subscribe({
      next: res => {
        this.inventoryCreateLoading = false; this.showInventoryModal = false;
        this.inventoryForm.reset({ itemType: 'Product' });
        this.showToast('Inventory item added.');
        if (res?.data) { this.inventoryItems = [res.data, ...this.inventoryItems]; this.cdr.detectChanges(); }
        else this.loadInventory();
      },
      error: err => { this.inventoryCreateLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  openAdjust(item: InventoryItemViewModel): void { this.adjustingItem = item; this.adjustForm.reset(); this.showAdjustModal = true; }

  submitAdjust(): void {
    if (this.adjustForm.invalid) { this.adjustForm.markAllAsTouched(); return; }
    this.adjustLoading = true;
    const v = this.adjustForm.value;
    this.inventorySvc.adjust(this.adjustingItem!.inventoryID, { adjustment: +v.adjustment, reason: v.reason }).subscribe({
      next: res => {
        this.adjustLoading = false; this.showAdjustModal = false;
        if (res?.data) { const idx = this.inventoryItems.findIndex(i => i.inventoryID === this.adjustingItem!.inventoryID); if (idx >= 0) { this.inventoryItems[idx] = res.data; this.inventoryItems = [...this.inventoryItems]; } }
        this.showToast('Stock adjusted.'); this.cdr.detectChanges();
      },
      error: err => { this.adjustLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  showMinQtyModal = false;
  editingMinQtyItem: InventoryItemViewModel | null = null;
  editingMinQtyValue = 0;
  minQtySaving = false;

  openMinQtyModal(item: InventoryItemViewModel): void {
    this.editingMinQtyItem = item;
    this.editingMinQtyValue = item.minimumQuantity;
    this.showMinQtyModal = true;
  }

  saveMinQty(): void {
    if (!this.editingMinQtyItem) return;
    const newMin = this.editingMinQtyValue;
    if (isNaN(newMin) || newMin < 0) { this.showToast('Enter a valid number ≥ 0.', 'error'); return; }
    this.minQtySaving = true;
    this.cdr.detectChanges();

    this.inventorySvc.updateMinimumQty(this.editingMinQtyItem.inventoryID, newMin)
      .pipe(timeout(8000), finalize(() => { this.minQtySaving = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          if (res?.data) {
            const item = this.editingMinQtyItem!;
            item.minimumQuantity = res.data.minimumQuantity;
            item.status = res.data.status;
            this.inventoryItems = [...this.inventoryItems];
            this.showToast(`Minimum quantity updated to ${newMin}.`);
          } else if (!res?.success) {
            this.showToast(res?.message ?? 'Failed to update.', 'error');
          }
          this.showMinQtyModal = false;
          this.cdr.detectChanges();
        },
        error: err => {
          this.showToast(err.error?.message ?? 'Failed to update minimum quantity.', 'error');
        }
      });
  }

  deleteInventoryItem(item: InventoryItemViewModel): void {
    this.inventorySvc.delete(item.inventoryID).subscribe({
      next: () => { this.inventoryItems = this.inventoryItems.filter(i => i.inventoryID !== item.inventoryID); this.showToast('Item deleted.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  invStatusBadge(s: string): string {
    const m: Record<string,string> = { InStock:'b-active', LowStock:'b-inspector', OutOfStock:'b-admin' };
    return m[s] ?? 'b-draft';
  }

  // PURCHASE ORDERS 
  loadPurchaseOrders(): void {
    this.poLoading = true;
    this.inventorySvc.getAllPO()
      .pipe(timeout(10000), finalize(() => { this.poLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.purchaseOrders = res?.data ?? []; this.cdr.detectChanges(); }, error: () => { this.poError = 'Failed to load POs.'; } });
  }

  addPoLineItem(): void {
    this.poLineItems = [...this.poLineItems, { inventoryID: '', quantity: '', unitPrice: '' }];
  }

  removePoLineItem(i: number): void {
    this.poLineItems = this.poLineItems.filter((_, idx) => idx !== i);
  }

  poLineSubtotal(item: { quantity: number | string; unitPrice: number | string }): number {
    return (+item.quantity || 0) * (+item.unitPrice || 0);
  }

  poGrandTotal(): number {
    return this.poLineItems.reduce((sum, item) => sum + this.poLineSubtotal(item), 0);
  }

  createPO(): void {
    if (this.poForm.invalid) { this.poForm.markAllAsTouched(); return; }
    const v = this.poForm.value;
    if (!v.supplierName) { this.showToast('Select a supplier.', 'error'); return; }
    const validItems = this.poLineItems.filter(li => li.inventoryID && +li.quantity > 0 && +li.unitPrice >= 0);
    if (!validItems.length) { this.showToast('Add at least one item with qty and price.', 'error'); return; }
    this.poCreateLoading = true;
    const items = validItems.map(li => {
      const inv = this.inventoryItems.find(i => i.inventoryID === +li.inventoryID);
      return { inventoryID: +li.inventoryID, productID: inv?.productID ?? inv?.componentID ?? 1, productName: inv?.productName ?? '', quantity: +li.quantity, unitPrice: +li.unitPrice };
    });
    this.inventorySvc.createPO({
      supplierName: v.supplierName,
      expectedDeliveryDate: new Date(v.expectedDeliveryDate).toISOString(),
      notes: v.notes || undefined,
      items
    }).subscribe({
      next: res => {
        this.poCreateLoading = false; this.showPOModal = false;
        this.poForm.reset();
        this.poLineItems = [{ inventoryID: '', quantity: '', unitPrice: '' }];
        this.showToast('Purchase order created.');
        if (res?.data) {
          this.purchaseOrders = [res.data, ...this.purchaseOrders];
          this.notifyAdminNewPO(res.data);
          this.cdr.detectChanges();
        } else this.loadPurchaseOrders();
      },
      error: err => { this.poCreateLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  updatePOStatus(po: PurchaseOrderViewModel, status: string): void {
    this.inventorySvc.updatePOStatus(po.poid, status).subscribe({
      next: () => {
        po.status = status;
        if (status === 'Received') {
          // Backend handles stock adjustment — just reload inventory
          this.loadInventory();
          this.showToast(`PO-${po.poid} received — stock updated automatically.`);
        } else {
          this.showToast('PO status updated.');
        }
        this.cdr.detectChanges();
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  poStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', Approved:'b-planner', Ordered:'b-inventory', Received:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  poCountByStatus(s: string): number { return this.purchaseOrders.filter(p => p.status === s).length; }
  poHasStatus(s: string): boolean { return this.purchaseOrders.some(p => p.status === s); }
  supplierPoCount(name: string): number { return this.purchaseOrders.filter(p => p.supplierName === name).length; }

  // â”€â”€ SUPPLIERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadSuppliers(): void {
    this.suppliersLoading = true;
    this.inventorySvc.getAllSuppliers()
      .pipe(timeout(10000), finalize(() => { this.suppliersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.suppliers = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  createSupplier(): void {
    if (this.supplierForm.invalid) { this.supplierForm.markAllAsTouched(); return; }
    this.supplierLoading = true;
    const v = this.supplierForm.value;
    this.inventorySvc.createSupplier({ name: v.name, contactPerson: v.contactPerson || undefined, phone: v.phone || undefined, email: v.email || undefined, address: v.address || undefined })
      .subscribe({
        next: res => {
          this.supplierLoading = false; this.showSupplierModal = false; this.supplierForm.reset();
          this.showToast('Supplier added.');
          if (res?.data) { this.suppliers = [...this.suppliers, res.data]; this.cdr.detectChanges(); }
        },
        error: err => { this.supplierLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  // â”€â”€ PRODUCTS (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadProducts(): void {
    this.productsLoading = true;
    this.productSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.productsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.products = (res?.data ?? []).sort((a, b) => b.productID - a.productID);
          this.bomSvc.getAll().pipe(timeout(10000)).subscribe({ next: bomRes => { const entries = bomRes?.data ?? []; this.bomByProduct = {}; for (const b of entries) { if (!this.bomByProduct[b.productID!]) this.bomByProduct[b.productID!] = []; this.bomByProduct[b.productID!].push(b); } this.cdr.detectChanges(); }, error: () => {} });
        },
        error: () => {}
      });
  }

  isBomExpanded(id: number): boolean { return this.expandedBomProducts.has(id); }
  toggleBom(id: number): void { if (this.expandedBomProducts.has(id)) this.expandedBomProducts.delete(id); else this.expandedBomProducts.add(id); }
  statusBadgeClass(s: string): string { if (s==='Active') return 'b-active'; if (s==='Draft') return 'b-draft'; return 'b-inactive'; }
  materialTypeBadge(t: string): string { const m: Record<string,string> = { RawMaterial:'b-planner', Part:'b-operator', SubAssembly:'b-inventory', Chemical:'b-inspector', Consumable:'b-inactive' }; return m[t] ?? 'b-draft'; }

  // â”€â”€ WORK ORDERS (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadWorkOrders(): void {
    this.workOrdersLoading = true;
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.workOrders = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  woStatusBadge(s: string): string { const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' }; return m[s] ?? 'b-draft'; }

  // â”€â”€ ANALYTICS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.analyticsSvc.getDashboard()
      .pipe(timeout(10000), finalize(() => { this.analyticsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.analytics = res?.data ?? null; this.cdr.detectChanges(); }, error: () => {} });
  }

  // â”€â”€ NOTIFICATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadNotifications(): void {
    this.notificationsLoading = true;
    this.http.get<any>('http://localhost:5000/api/v1/notifications/my')
      .pipe(timeout(10000), finalize(() => { this.notificationsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.notifications = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
    this.http.get<any>('http://localhost:5000/api/v1/notifications/my/unread-count')
      .pipe(timeout(5000))
      .subscribe({ next: res => { this.unreadCount = res?.data?.totalUnread ?? 0; this.cdr.detectChanges(); }, error: () => {} });
  }

  markRead(id: number): void {
    this.http.put<any>(`http://localhost:5000/api/v1/notifications/${id}/read`, {}).subscribe({
      next: () => { const n = this.notifications.find(x => x.notificationID === id); if (n) { n.status = 'Read'; this.unreadCount = Math.max(0, this.unreadCount - 1); this.cdr.detectChanges(); } },
      error: () => {}
    });
  }

  notifPriorityBadge(p: string): string { const m: Record<string,string> = { High:'b-admin', Medium:'b-inspector', Low:'b-planner', Normal:'b-operator', Critical:'b-admin' }; return m[p] ?? 'b-draft'; }

  showToast(msg: string, type: 'success' | 'error' = 'success'): void {
    if (type === 'error') {
      this.errorAlert = msg;
      this.toastMsg = '';
    } else {
      this.toastMsg = msg;
      this.errorAlert = '';
    }
    setTimeout(() => { this.toastMsg = ''; this.errorAlert = ''; this.cdr.detectChanges(); }, type === 'error' ? 7000 : 4000);
    this.cdr.detectChanges();
  }
  logout(): void { this.auth.logout(); this.router.navigate(['/login'], { replaceUrl: true }); }

  showChangePwModal = false; changePwCurrentPassword = ''; changePwNewPassword = ''; changePwConfirmPassword = ''; changePwLoading = false; changePwError = ''; changePwSuccess = '';
  submitChangePassword(): void {
    this.changePwError = ''; this.changePwSuccess = '';
    if (!this.changePwCurrentPassword || !this.changePwNewPassword || !this.changePwConfirmPassword) { this.changePwError = 'All fields are required.'; return; }
    if (this.changePwNewPassword.length < 6) { this.changePwError = 'New password must be at least 6 characters.'; return; }
    if (this.changePwNewPassword !== this.changePwConfirmPassword) { this.changePwError = 'New passwords do not match.'; return; }
    this.changePwLoading = true;
    this.auth.changePassword(this.changePwCurrentPassword, this.changePwNewPassword).subscribe({
      next: () => { this.changePwLoading = false; this.changePwSuccess = 'Password changed successfully!'; setTimeout(() => { this.showChangePwModal = false; this.changePwCurrentPassword = ''; this.changePwNewPassword = ''; this.changePwConfirmPassword = ''; this.changePwSuccess = ''; }, 1500); },
      error: (err: any) => { this.changePwLoading = false; this.changePwError = err?.error?.message ?? err?.error?.Message ?? 'Failed to change password.'; }
    });
  }
}
