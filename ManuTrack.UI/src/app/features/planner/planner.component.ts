import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';
import { ComponentService, ComponentViewModel } from '../../core/services/component.service';
import { WorkOrderService, WorkOrderViewModel, WorkOrderTaskViewModel } from '../../core/services/workorder.service';
import { InventoryService, InventoryItemViewModel } from '../../core/services/inventory.service';
import { AnalyticsService, DashboardSummaryViewModel, KpiReportViewModel } from '../../core/services/analytics.service';
import { NotificationAdminService, NotificationViewModel } from '../../core/services/notification.service';
import { QualityService, InspectionViewModel, DefectViewModel } from '../../core/services/quality.service';
import {
  AppRoles, ProductCategories, WorkOrderStatuses, MaterialTypes, MaterialUnits
} from '../../shared/constants/enums';

type Section = 'overview' | 'products' | 'workorders' | 'inventory' | 'quality' | 'analytics' | 'notifications';

@Component({
  selector: 'app-planner',
  standalone: false,
  templateUrl: './planner.component.html',
  styleUrl: './planner.component.css'
})
export class PlannerComponent implements OnInit {
  activeSection: Section = 'overview';

  userName: string;
  userInitials: string;

  // Data
  products: ProductViewModel[] = [];
  bomEntries: BomViewModel[] = [];
  bomByProduct: Record<number, BomViewModel[]> = {};
  components: ComponentViewModel[] = [];
  workOrders: WorkOrderViewModel[] = [];
  inventoryItems: InventoryItemViewModel[] = [];
  notifications: NotificationViewModel[] = [];
  inspections: InspectionViewModel[] = [];
  defects: DefectViewModel[] = [];
  qualityLoading = false;
  unreadCount = 0;
  analytics: DashboardSummaryViewModel | null = null;
  kpiReports: KpiReportViewModel[] = [];

  // Loading & error states
  productsLoading = false; productsError = '';
  bomLoading = false;
  workOrdersLoading = false; workOrdersError = '';
  inventoryLoading = false; inventoryError = '';
  analyticsLoading = false; analyticsError = '';
  notificationsLoading = false;

  // Operators list for task assignment
  operatorsList: { userID: number; name: string }[] = [];

  // Modals
  showProductModal = false;
  showBomModal = false;
  showWorkOrderModal = false;
  showTaskModal = false;
  showKpiModal = false;
  showComponentModal = false;
  showConfirmModal = false;
  confirmTitle = '';
  confirmMessage = '';
  confirmAction: (() => void) | null = null;

  selectedParentProductId: number | null = null;
  expandedBomProducts = new Set<number>();
  expandedWorkOrders = new Set<number>();
  tasksByWorkOrder: Record<number, WorkOrderTaskViewModel[]> = {};
  selectedWorkOrderForTask: WorkOrderViewModel | null = null;
  viewingBomProduct: ProductViewModel | null = null;
  isBomViewExpanded = false;

  // Forms
  productForm!: FormGroup;
  bomForm!: FormGroup;
  workOrderForm!: FormGroup;
  taskForm!: FormGroup;
  kpiForm!: FormGroup;
  componentForm!: FormGroup;

  productLoading = false;
  bomCreateLoading = false;
  workOrderLoading = false;
  woStockError = '';
  stockShortfalls: { component: string; required: number; available: number; unit: string }[] = [];
  stockNotifyLoading = false;
  stockNotifySent = false;
  stockNotifyProductName = '';
  taskLoading = false;
  kpiLoading = false;
  componentCreateLoading = false;
  bomSuccessMsg = '';

  toastMsg = ''; toastType: 'success' | 'error' = 'success';
  errorAlert = '';

  // Enums
  readonly productCategories = ProductCategories;
  readonly workOrderStatuses = WorkOrderStatuses;
  readonly materialTypes = MaterialTypes;
  readonly materialUnits = MaterialUnits;

  constructor(
    private auth: AuthService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private componentSvc: ComponentService,
    private workOrderSvc: WorkOrderService,
    private inventorySvc: InventoryService,
    private analyticsSvc: AnalyticsService,
    private notificationSvc: NotificationAdminService,
    private qualitySvc: QualityService,
    private fb: FormBuilder,
    private router: Router,
    public cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.userName = this.auth.getName() ?? 'Planner';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      category: ['', Validators.required],
      version: ['1.0', [Validators.required, Validators.pattern(/^\d+\.\d+(\.\d+)?$/)]],
      status: ['Draft']
    });

    this.bomForm = this.fb.group({
      productID: ['', Validators.required],
      componentID: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(0.0001)]],
      version: ['1.0', [Validators.required, Validators.pattern(/^\d+\.\d+(\.\d+)?$/)]],
      notes: ['']
    });

    this.workOrderForm = this.fb.group({
      productID: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(1)]],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required]
    });

    this.taskForm = this.fb.group({
      description: ['', [Validators.required, Validators.minLength(5)]],
      assignedTo: ['', Validators.required],
      notes: ['']
    });

    this.kpiForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      reportType: ['Quality', Validators.required],
      scope: ['', [Validators.required, Validators.minLength(5)]]
    });

    this.componentForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      materialType: ['', Validators.required],
      unit: ['', Validators.required],
      description: ['']
    });
  }

  ngOnInit(): void {
    this.loadProducts();
    this.loadBoms();
    this.loadComponents();
    this.loadWorkOrders();
    this.loadInventory();
    this.loadAnalytics();
    this.loadNotifications();
    this.loadQuality();
    this.loadOperators();
  }

  loadOperators(): void {
    this.http.get<any>('http://localhost:5000/api/v1/auth/users/by-role/Operator')
      .pipe(timeout(10000))
      .subscribe({
        next: res => {
          const all = res?.data ?? [];
          this.operatorsList = all
            .filter((u: any) => u.isActive)
            .map((u: any) => ({ userID: u.userID, name: u.name }));
        },
        error: () => {}
      });
  }

  get sectionTitle(): string {
    const map: Record<Section, string> = {
      overview: 'Overview', products: 'Products & BOM',
      workorders: 'Work Orders', inventory: 'Inventory',
      quality: 'Quality View', analytics: 'Analytics', notifications: 'Notifications'
    };
    return map[this.activeSection];
  }

  showSection(s: Section): void { this.activeSection = s; }

  // -- Quality (read-only) ------------------------------
  loadQuality(): void {
    this.qualityLoading = true;
    this.qualitySvc.getAllInspections()
      .pipe(timeout(10000), finalize(() => { this.qualityLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: (res: any) => { this.inspections = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
    this.qualitySvc.getAllDefects()
      .pipe(timeout(10000))
      .subscribe({ next: (res: any) => { this.defects = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  // -- Computed helpers ---------------------------------
  get completedWOCount(): number { return this.workOrders.filter(w => w.status === 'Completed').length; }
  get inProgressWOCount(): number { return this.workOrders.filter(w => w.status === 'InProgress').length; }
  get pendingWOCount(): number { return this.workOrders.filter(w => w.status === 'Pending').length; }
  get overdueWOCount(): number { return this.workOrders.filter(w => w.isOverdue).length; }
  get woCompletionRate(): number { return this.workOrders.length ? Math.round(this.completedWOCount / this.workOrders.length * 100) : 0; }
  get allTasksFlat(): WorkOrderTaskViewModel[] { return Object.values(this.tasksByWorkOrder).flat(); }
  get completedTasksCount(): number { return this.allTasksFlat.filter(t => t.status === 'Completed').length; }
  get inProgressTasksCount(): number { return this.allTasksFlat.filter(t => t.status === 'InProgress').length; }
  get pendingTasksCount(): number { return this.allTasksFlat.filter(t => t.status === 'Pending').length; }
  get totalTasksCount(): number { return this.allTasksFlat.length; }
  get passedInspCount(): number { return this.inspections.filter(i => i.result === 'Pass').length; }
  get failedInspCount(): number { return this.inspections.filter(i => i.result === 'Fail').length; }
  get yieldRate(): number { return this.inspections.length ? Math.round(this.passedInspCount / this.inspections.length * 100) : 0; }
  get openDefectsCount(): number { return this.defects.filter(d => d.status === 'Open').length; }
  get criticalDefectsCount(): number { return this.defects.filter(d => d.severity === 'Critical').length; }
  get activeProductsCount(): number { return this.products.filter(p => p.status === 'Active').length; }
  get draftProductsCount(): number { return this.products.filter(p => p.status === 'Draft').length; }

  woFunnelPct(status: string): number {
    const count = this.workOrders.filter(w => w.status === status).length;
    return this.workOrders.length ? Math.round(count / this.workOrders.length * 100) : 0;
  }
  woDonutGradient(): string {
    const c = this.woCompletionRate, ip = this.woFunnelPct('InProgress'), p = this.woFunnelPct('Pending');
    return `conic-gradient(#22c55e 0% ${c}%, #3b82f6 ${c}% ${c+ip}%, #f59e0b ${c+ip}% ${c+ip+p}%, #ef4444 ${c+ip+p}% 100%)`;
  }
  taskDonutGradient(): string {
    const t = this.totalTasksCount;
    if (!t) return 'conic-gradient(#e5e7eb 0% 100%)';
    const c = Math.round(this.completedTasksCount/t*100), ip = Math.round(this.inProgressTasksCount/t*100);
    return `conic-gradient(#22c55e 0% ${c}%, #3b82f6 ${c}% ${c+ip}%, #f59e0b ${c+ip}% 100%)`;
  }
  gaugeGradient(rate: number, hi = 60, mid = 30): string {
    const color = rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
    return `conic-gradient(${color} 0% ${rate}%, #e5e7eb ${rate}% 100%)`;
  }
  gaugeColor(rate: number, hi = 60, mid = 30): string {
    return rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
  }
  inspResultBadge(r: string): string {
    const m: Record<string,string> = { Passed:'b-active', Failed:'b-inactive', Pending:'b-draft' };
    return m[r] ?? 'b-draft';
  }
  defectSeverityBadge(s: string): string {
    const m: Record<string,string> = { Critical:'b-inactive', High:'b-amber', Medium:'b-planner', Low:'b-draft' };
    return m[s] ?? 'b-draft';
  }
  get lowDefectsCount(): number { return this.defects.filter(d => d.severity === 'Low').length; }
  get mediumDefectsCount(): number { return this.defects.filter(d => d.severity === 'Medium').length; }
  get highDefectsCount(): number { return this.defects.filter(d => d.severity === 'High').length; }
  get maxDefSev(): number { return Math.max(this.criticalDefectsCount, this.highDefectsCount, this.mediumDefectsCount, this.lowDefectsCount, 1); }

  // ── PRODUCTS ──────────────────────────────────────────
  get pf() { return this.productForm.controls; }
  get activeProductsList() { return this.products.filter(p => p.status === 'Active'); }

  loadProducts(): void {
    this.productsLoading = true; this.productsError = '';
    this.productSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.productsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.products = (res?.data ?? []).sort((a, b) => b.productID - a.productID);
          this.cdr.detectChanges();
        },
        error: () => { this.productsError = 'Failed to load products.'; }
      });
  }

  createProduct(): void {
    if (this.productForm.invalid) { this.productForm.markAllAsTouched(); return; }
    this.productLoading = true;
    this.productSvc.create(this.productForm.value).subscribe({
      next: () => {
        this.productLoading = false; this.showProductModal = false;
        this.productForm.reset({ version: '1.0', status: 'Draft' });
        this.showToast('Product registered.'); this.loadProducts();
      },
      error: err => { this.productLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
    });
  }

  // ── BOM ───────────────────────────────────────────────
  get bf() { return this.bomForm.controls; }

  loadBoms(): void {
    this.bomLoading = true;
    this.bomSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.bomLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.bomEntries = res?.data ?? [];
          this.bomByProduct = {};
          for (const b of this.bomEntries) {
            if (!this.bomByProduct[b.productID!]) this.bomByProduct[b.productID!] = [];
            this.bomByProduct[b.productID!].push(b);
          }
          this.cdr.detectChanges();
        },
        error: () => {}
      });
  }

  get activeComponents() { return this.components.filter(c => c.isActive); }

  /** All active components — BOM is a product definition, independent of current stock levels */
  get componentsInInventory() {
    return this.activeComponents;
  }

  loadComponents(): void {
    this.componentSvc.getAll()
      .pipe(timeout(10000))
      .subscribe({ next: res => { this.components = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  openBomForProduct(p: ProductViewModel): void {
    this.viewingBomProduct = p;
    this.bomSuccessMsg = '';
    this.bomForm.reset({ version: '1.0' });
    this.bomForm.patchValue({ productID: p.productID });
    this.selectedParentProductId = p.productID;
    this.showBomModal = true;
  }

  closeBomModal(): void {
    this.showBomModal = false; this.bomSuccessMsg = '';
    this.selectedParentProductId = null;
  }

  createBom(): void {
    if (this.bomForm.invalid) { this.bomForm.markAllAsTouched(); return; }
    const v = this.bomForm.value;
    this.bomCreateLoading = true;
    const selectedComp = this.activeComponents.find(c => c.componentID === +v.componentID);
    this.bomSvc.create({ productID: +v.productID, componentID: +v.componentID, quantity: +v.quantity, version: v.version, notes: v.notes || undefined })
      .subscribe({
        next: () => {
          this.bomCreateLoading = false;
          this.bomSuccessMsg = `"${selectedComp?.name}" added to BOM.`;
          this.bomForm.patchValue({ componentID: '', quantity: '', notes: '' });
          this.bomForm.markAsUntouched();
          this.loadBoms(); this.cdr.detectChanges();
          setTimeout(() => { this.closeBomModal(); this.cdr.detectChanges(); }, 1500);
        },
        error: err => { this.bomCreateLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
      });
  }

  deleteBomEntry(id: number): void {
    this.bomSvc.delete(id).subscribe({ next: () => { this.showToast('BOM entry deleted.'); this.loadBoms(); }, error: err => { this.showToast(this.apiErr(err, 'Failed to remove BOM entry.'), 'error'); } });
  }

  isBomExpanded(id: number): boolean { return this.expandedBomProducts.has(id); }
  toggleBom(id: number): void {
    if (this.expandedBomProducts.has(id)) this.expandedBomProducts.delete(id);
    else this.expandedBomProducts.add(id);
  }

  getProductName(id: number | string): string {
    const p = this.products.find(x => x.productID === +id);
    return p ? `${p.name} (v${p.version})` : '—';
  }

  createComponent(): void {
    if (this.componentForm.invalid) { this.componentForm.markAllAsTouched(); return; }
    this.componentCreateLoading = true;
    const v = this.componentForm.value;
    this.componentSvc.create({ name: v.name, materialType: v.materialType, unit: v.unit, description: v.description || undefined })
      .subscribe({
        next: (res) => {
          this.componentCreateLoading = false;
          const created = res?.data;
          // Inventory item is auto-created by the backend (ProductService ? InventoryService).
          // Reload inventory after a brief delay to reflect the new entry.
          setTimeout(() => this.loadInventory(), 500);
          this.showComponentModal = false;
          this.componentForm.reset();
          this.showToast(`"${created?.name ?? v.name}" added to Inventory with 0 quantity.`);
          this.loadComponents();
        },
        error: err => { this.componentCreateLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
      });
  }

  get cf() { return this.componentForm.controls; }

  // ── WORK ORDERS ───────────────────────────────────────
  get wf() { return this.workOrderForm.controls; }
  get tf() { return this.taskForm.controls; }

  get inProgressCount() { return this.workOrders.filter(w => w.status === 'InProgress').length; }
  get overdueCount()    { return this.workOrders.filter(w => w.isOverdue).length; }

  loadWorkOrders(): void {
    this.workOrdersLoading = true;
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.workOrders = res?.data ?? [];
          // Load tasks for ALL WOs so analytics are accurate
          this.workOrders.forEach(wo => this.loadTasksForWorkOrder(wo.workOrderID));
          this.cdr.detectChanges();
        },
        error: () => { this.workOrdersError = 'Failed to load work orders.'; }
      });
  }

  createWorkOrder(): void {
    if (this.workOrderForm.invalid) { this.workOrderForm.markAllAsTouched(); return; }

    const v = this.workOrderForm.value;
    const productId = +v.productID;
    const woQty = +v.quantity;

    // Check BOM components against inventory stock
    const bomForProduct = this.bomByProduct[productId] ?? [];
    const shortfalls = bomForProduct
      .map(bom => {
        const required = bom.quantity * woQty;
        const invItem = this.inventoryItems.find(i => i.componentID === bom.componentID);
        const available = invItem?.quantityOnHand ?? 0;
        return { component: bom.componentName, required, available, unit: bom.componentUnit };
      })
      .filter(s => s.available < s.required);

    if (shortfalls.length > 0) {
      this.woStockError = 'Insufficient stock for the following BOM components:';
      this.stockShortfalls = shortfalls;
      this.stockNotifyProductName = this.products.find(p => p.productID === productId)?.name ?? '';
      this.stockNotifySent = false;
      return;
    }

    this.woStockError = '';
    this.stockShortfalls = [];
    this.workOrderLoading = true;
    const product = this.products.find(p => p.productID === productId);
    this.workOrderSvc.create({
      productID: productId, productName: product?.name ?? '',
      quantity: woQty,
      startDate: new Date(v.startDate).toISOString(),
      endDate: new Date(v.endDate).toISOString()
    }).subscribe({
      next: () => {
        this.workOrderLoading = false; this.showWorkOrderModal = false;
        this.workOrderForm.reset(); this.showToast('Work order created.'); this.loadWorkOrders();
      },
      error: err => { this.workOrderLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
    });
  }

  notifyInventoryManager(): void {
    const product = this.stockNotifyProductName;
    const lines = this.stockShortfalls
      .map(s => `• ${s.component}: needs ${s.required} ${s.unit}, only ${s.available} available`)
      .join('\n');
    const message = `Work order for "${product}" cannot be created due to insufficient stock:\n\n${lines}\n\nPlease raise purchase orders for these items.`;

    this.stockNotifyLoading = true;
    this.notificationSvc.notifyRole({
      targetRole: 'InventoryManager',
      title: `Restock Required — ${product}`,
      message,
      category: 'Inventory',
      priority: 'High'
    }).subscribe({
      next: () => { this.stockNotifyLoading = false; this.stockNotifySent = true; },
      error: () => { this.stockNotifyLoading = false; this.showToast('Failed to send notification.', 'error'); }
    });
  }

  updateWorkOrderStatus(wo: WorkOrderViewModel, status: string): void {
    this.workOrderSvc.updateStatus(wo.workOrderID, status).subscribe({
      next: () => { wo.status = status; this.showToast('Status updated.'); this.cdr.detectChanges(); },
      error: err => this.showToast(this.apiErr(err, 'Failed.'), 'error')
    });
  }

  deleteWorkOrder(wo: WorkOrderViewModel): void {
    this.confirmTitle = 'Delete Work Order';
    this.confirmMessage = `Are you sure you want to delete WO-${wo.workOrderID} (${wo.productName})? This action cannot be undone.`;
    this.confirmAction = () => {
      this.workOrderSvc.delete(wo.workOrderID).subscribe({
        next: () => {
          this.workOrders = this.workOrders.filter(w => w.workOrderID !== wo.workOrderID);
          this.showToast(`WO-${wo.workOrderID} deleted successfully.`);
          this.cdr.detectChanges();
        },
        error: err => {
          const status = err?.status;
          const msg = status === 403
            ? 'You do not have permission to delete this work order.'
            : status === 404
            ? 'Work order not found.'
            : this.apiErr(err, 'Failed to delete work order.');
          this.showToast(msg, 'error');
        }
      });
    };
    this.showConfirmModal = true;
  }

  runConfirm(): void {
    this.showConfirmModal = false;
    if (this.confirmAction) { this.confirmAction(); this.confirmAction = null; }
  }

  isWorkOrderExpanded(id: number): boolean { return this.expandedWorkOrders.has(id); }
  toggleWorkOrder(id: number): void {
    if (this.expandedWorkOrders.has(id)) this.expandedWorkOrders.delete(id);
    else { this.expandedWorkOrders.add(id); this.loadTasksForWorkOrder(id); } // Always reload
  }

  loadTasksForWorkOrder(id: number): void {
    this.workOrderSvc.getTasksByWorkOrder(id).subscribe({
      next: res => {
        const tasks = res?.data ?? [];
        this.tasksByWorkOrder = { ...this.tasksByWorkOrder, [id]: tasks };
        // Auto-complete WO if all tasks Completed but WO not yet updated
        if (tasks.length > 0 && tasks.every(t => t.status === 'Completed')) {
          const wo = this.workOrders.find(w => w.workOrderID === id);
          if (wo && wo.status !== 'Completed' && wo.status !== 'Cancelled') {
            this.workOrderSvc.updateStatus(id, 'Completed').subscribe({
              next: (res: any) => {
                if (res?.success !== false) {
                  wo.status = 'Completed';
                  this.cdr.detectChanges();
                }
              },
              error: () => {}
            });
          }
        }
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  openAddTask(wo: WorkOrderViewModel): void { this.selectedWorkOrderForTask = wo; this.taskForm.reset(); this.showTaskModal = true; }

  createTask(): void {
    if (this.taskForm.invalid) { this.taskForm.markAllAsTouched(); return; }
    this.taskLoading = true;
    const v = this.taskForm.value;
    this.workOrderSvc.createTask({ workOrderID: this.selectedWorkOrderForTask!.workOrderID, description: v.description, assignedTo: v.assignedTo, notes: v.notes || undefined })
      .subscribe({
        next: () => { this.taskLoading = false; this.showTaskModal = false; this.taskForm.reset(); this.showToast('Task added.'); this.loadTasksForWorkOrder(this.selectedWorkOrderForTask!.workOrderID); },
        error: err => { this.taskLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
      });
  }

  checkAndAutoCompleteWorkOrder(workOrderId: number): void {
    const tasks = this.tasksByWorkOrder[workOrderId];
    if (!tasks || tasks.length === 0) return;
    if (tasks.every(t => t.status === 'Completed')) {
      const wo = this.workOrders.find(w => w.workOrderID === workOrderId);
      if (wo && wo.status !== 'Completed') {
        this.workOrderSvc.updateStatus(workOrderId, 'Completed').subscribe({
          next: () => { wo.status = 'Completed'; this.showToast(`? All tasks done � WO-${workOrderId} auto-completed.`); this.cdr.detectChanges(); },
          error: () => {}
        });
      }
    }
  }

  updateTaskStatus(task: WorkOrderTaskViewModel, status: string): void {
    this.workOrderSvc.updateTaskStatus(task.taskID, status).subscribe({
      next: () => {
        task.status = status;
        this.checkAndAutoCompleteWorkOrder(task.workOrderID);
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  deleteTask(task: WorkOrderTaskViewModel): void {
    this.workOrderSvc.deleteTask(task.taskID).subscribe({
      next: () => {
        const list = this.tasksByWorkOrder[task.workOrderID] ?? [];
        this.tasksByWorkOrder = { ...this.tasksByWorkOrder, [task.workOrderID]: list.filter(t => t.taskID !== task.taskID) };
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  woStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  // ── INVENTORY (view only) ─────────────────────────────
  loadInventory(): void {
    this.inventoryLoading = true;
    this.inventorySvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.inventoryLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.inventoryItems = res?.data ?? []; this.cdr.detectChanges(); },
        error: () => { this.inventoryError = 'Failed to load inventory.'; }
      });
  }

  invStatusBadge(s: string): string {
    const m: Record<string,string> = { InStock:'b-active', LowStock:'b-inspector', OutOfStock:'b-admin' };
    return m[s] ?? 'b-draft';
  }

  get lowStockAlert() { return this.inventoryItems.filter(i => i.status !== 'InStock').length; }

  // ── ANALYTICS ─────────────────────────────────────────
  get kf() { return this.kpiForm.controls; }

  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.analyticsSvc.getDashboard()
      .pipe(timeout(10000), finalize(() => { this.analyticsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.analytics = res?.data ?? null; this.cdr.detectChanges(); },
        error: () => { this.analyticsError = 'Analytics service unavailable.'; }
      });
    this.analyticsSvc.getReports()
      .pipe(timeout(10000))
      .subscribe({ next: res => { this.kpiReports = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  createKpiReport(): void {
    if (this.kpiForm.invalid) { this.kpiForm.markAllAsTouched(); return; }
    this.kpiLoading = true;
    const v = this.kpiForm.value;
    this.analyticsSvc.createReport({ title: v.title, reportType: v.reportType, scope: v.scope, generatedBy: this.userName })
      .subscribe({
        next: res => {
          this.kpiLoading = false; this.showKpiModal = false; this.kpiForm.reset();
          this.showToast('KPI report generated.');
          if (res?.data) { this.kpiReports = [res.data, ...this.kpiReports]; this.cdr.detectChanges(); }
        },
        error: err => { this.kpiLoading = false; this.showToast(this.apiErr(err, 'Failed.'), 'error'); }
      });
  }

  // ── NOTIFICATIONS ─────────────────────────────────────
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
      next: () => {
        const n = this.notifications.find(x => x.notificationID === id);
        if (n) { n.status = 'Read'; this.unreadCount = Math.max(0, this.unreadCount - 1); this.cdr.detectChanges(); }
      },
      error: () => {}
    });
  }

  notifPriorityBadge(p: string): string {
    const m: Record<string,string> = { High:'b-admin', Medium:'b-inspector', Low:'b-planner', Normal:'b-operator', Critical:'b-admin' };
    return m[p] ?? 'b-draft';
  }

  // ── UTILS ─────────────────────────────────────────────
  /** Extracts the readable message from an HTTP error (handles PascalCase + camelCase API responses). */
  apiErr(err: any, fallback = 'Something went wrong.'): string {
    return err?.error?.message ?? err?.error?.Message ?? err?.message ?? fallback;
  }

  showToast(msg: string, type: 'success' | 'error' = 'success'): void {
    this.toastMsg = '';
    this.errorAlert = '';
    this.cdr.detectChanges();              // reset first so animation re-triggers
    setTimeout(() => {
      if (type === 'error') { this.errorAlert = msg; } else { this.toastMsg = msg; }
      this.cdr.detectChanges();
      setTimeout(() => { this.toastMsg = ''; this.errorAlert = ''; this.cdr.detectChanges(); }, type === 'error' ? 6000 : 3500);
    }, 10);
  }

  initials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  materialTypeBadge(type: string): string {
    const m: Record<string,string> = { RawMaterial:'b-planner', Part:'b-operator', SubAssembly:'b-inventory', Chemical:'b-inspector', Consumable:'b-inactive' };
    return m[type] ?? 'b-draft';
  }

  statusBadgeClass(status: string): string {
    if (status === 'Active') return 'b-active';
    if (status === 'Draft') return 'b-draft';
    return 'b-inactive';
  }

  logout(): void { this.auth.logout(); this.router.navigate(['/login'], { replaceUrl: true }); }

  // ── Change Password ──────────────────────────────────────────────────────
  showChangePwModal = false;
  changePwCurrentPassword = '';
  changePwNewPassword = '';
  changePwConfirmPassword = '';
  changePwLoading = false;
  changePwError = '';
  changePwSuccess = '';

  submitChangePassword(): void {
    this.changePwError = ''; this.changePwSuccess = '';
    if (!this.changePwCurrentPassword || !this.changePwNewPassword || !this.changePwConfirmPassword) { this.changePwError = 'All fields are required.'; return; }
    if (this.changePwNewPassword.length < 6) { this.changePwError = 'New password must be at least 6 characters.'; return; }
    if (this.changePwNewPassword !== this.changePwConfirmPassword) { this.changePwError = 'New passwords do not match.'; return; }
    this.changePwLoading = true;
    this.auth.changePassword(this.changePwCurrentPassword, this.changePwNewPassword).subscribe({
      next: () => {
        this.changePwLoading = false; this.changePwSuccess = 'Password changed successfully!';
        setTimeout(() => { this.showChangePwModal = false; this.changePwCurrentPassword = ''; this.changePwNewPassword = ''; this.changePwConfirmPassword = ''; this.changePwSuccess = ''; }, 1500);
      },
      error: (err: any) => { this.changePwLoading = false; this.changePwError = err?.error?.message ?? err?.error?.Message ?? 'Failed to change password.'; }
    });
  }
}
