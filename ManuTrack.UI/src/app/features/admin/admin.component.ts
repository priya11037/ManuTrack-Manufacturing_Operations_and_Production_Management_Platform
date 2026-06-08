import { Component, OnInit, ChangeDetectorRef, NgZone } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';
import { AuditService, AuditEntryViewModel } from '../../core/services/audit.service';
import { WorkOrderService, WorkOrderViewModel, WorkOrderTaskViewModel } from '../../core/services/workorder.service';
import { ComponentService, ComponentViewModel } from '../../core/services/component.service';
import { InventoryService, InventoryItemViewModel, PurchaseOrderViewModel, SupplierViewModel } from '../../core/services/inventory.service';
import { NotificationAdminService, NotificationViewModel } from '../../core/services/notification.service';
import { QualityService, InspectionViewModel, DefectViewModel } from '../../core/services/quality.service';
import { AnalyticsService, DashboardSummaryViewModel, KpiReportViewModel } from '../../core/services/analytics.service';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import {
  AppRoles, ProductStatuses, ProductCategories, WorkOrderStatuses,
  MaterialTypes, MaterialUnits, NotificationCategories
} from '../../shared/constants/enums';


export interface AuthUserViewModel {
  userID: number;
  name: string;
  role: string;
  email: string;
  phone: string;
  isActive: boolean;
}

type Section = 'overview' | 'users' | 'products' | 'bom' | 'workorders' | 'inventory' | 'quality' | 'analytics' | 'notifications' | 'audit';

@Component({
  selector: 'app-admin',
  standalone: false,
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.css'
})
export class AdminComponent implements OnInit {
  // Enum lists exposed to template
  readonly appRoles = AppRoles;
  readonly productStatuses = ProductStatuses;
  readonly productCategories = ProductCategories;
  readonly workOrderStatuses = WorkOrderStatuses;
  readonly materialTypes = MaterialTypes;
  readonly materialUnits = MaterialUnits;
  readonly notificationCategories = NotificationCategories;
  readonly workOrderStatusList = WorkOrderStatuses;

  activeSection: Section = 'overview';
  showUserModal = false;
  showEditUserModal = false;
  editingUser: AuthUserViewModel | null = null;
  editUserForm!: FormGroup;
  editUserLoading = false;
  showProductModal = false;
  showEditProductModal = false;
  editingProduct: ProductViewModel | null = null;
  editProductStatus = '';
  showBomModal = false;
  showViewBomModal = false;
  viewingBomProduct: ProductViewModel | null = null;
  bomSuccessMsg = '';
  bomSuccessCreatedName = '';

  userName: string;
  userInitials: string;

  users: AuthUserViewModel[] = [];
  products: ProductViewModel[] = [];
  bomEntries: BomViewModel[] = [];
  auditLogs: AuditEntryViewModel[] = [];
  auditTotalRecords = 0;
  components: ComponentViewModel[] = [];
  componentsLoading = false;
  showComponentModal = false;
  componentForm!: FormGroup;
  componentCreateLoading = false;
  componentError = '';
  componentSuccess = '';
  selectedParentProductId: number | null = null; // for per-product BOM button

  workOrders: WorkOrderViewModel[] = [];
  inventoryItems: InventoryItemViewModel[] = [];
  purchaseOrders: PurchaseOrderViewModel[] = [];
  suppliers: SupplierViewModel[] = [];
  inventoryTab: 'items' | 'po' | 'suppliers' = 'items';
  poLoading = false; poError = '';
  suppliersLoading = false; suppliersError = '';
  showPOModal = false; showAdjustModal = false; showSupplierModal = false;
  adjustingItem: InventoryItemViewModel | null = null;
  poForm!: FormGroup; adjustForm!: FormGroup; supplierForm!: FormGroup;
  poLoading2 = false; adjustLoading = false; supplierLoading = false;
  notifications: NotificationViewModel[] = [];
  unreadCount = 0;

  // ── Quality (read-only) ──────────────────────────────
  inspections: InspectionViewModel[] = [];
  defects: DefectViewModel[] = [];
  qualityLoading = false;

  // ── Analytics (read-only) ────────────────────────────
  analytics: DashboardSummaryViewModel | null = null;
  kpiReports: KpiReportViewModel[] = [];
  analyticsLoading = false;

  usersLoading = false;
  productsLoading = false;
  bomLoading = false;
  auditLoading = false;
  workOrdersLoading = false;
  inventoryLoading = false;
  notificationsLoading = false;

  usersError = '';
  productsError = '';
  bomError = '';
  auditError = '';
  workOrdersError = '';
  inventoryError = '';
  notificationsError = '';

  showWorkOrderModal = false;
  showTaskModal = false;
  tasksByWorkOrder: Record<number, WorkOrderTaskViewModel[]> = {};
  expandedWorkOrders = new Set<number>();
  selectedWorkOrderForTask: WorkOrderViewModel | null = null;
  taskForm!: FormGroup;
  taskLoading = false;
  showInventoryModal = false;
  showBroadcastModal = false;
  workOrderForm!: FormGroup;
  inventoryForm!: FormGroup;
  broadcastForm!: FormGroup;
  workOrderLoading = false;
  inventoryCreateLoading = false;
  broadcastLoading = false;

  toastMsg = '';
  toastType: 'success' | 'error' = 'success';
  errorAlert = '';
  private errorTimer: any;

  registerForm: FormGroup;
  productForm: FormGroup;
  bomForm: FormGroup;
  registerLoading = false;
  registerError = '';
  usersSuccessMsg = '';
  productsSuccessMsg = '';
  productLoading = false;
  bomCreateLoading = false;

  showRegPassword = false;
  showRegConfirmPassword = false;

  expandedBomProducts = new Set<number>();
  bomByProduct: Record<number, BomViewModel[]> = {};

  auditActionFilter = '';

  constructor(
    private auth: AuthService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private auditSvc: AuditService,
    private workOrderSvc: WorkOrderService,
    private componentSvc: ComponentService,
    private inventorySvc: InventoryService,
    private notificationSvc: NotificationAdminService,
    private qualitySvc: QualityService,
    private analyticsSvc: AnalyticsService,
    private fb: FormBuilder,
    private router: Router,
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
  ) {
    this.userName = this.auth.getName() ?? 'Admin';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    this.editUserForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      phone: ['', [Validators.required, Validators.pattern(/^[0-9]{10}$/)]],
      role: ['', Validators.required]
    });

    this.registerForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      phone: ['', [Validators.required, Validators.pattern(/^[0-9]{10}$/)]],
      role: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8),
        Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).+$/)]],
      confirmPassword: ['', Validators.required]
    });

    this.productForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      category: ['', Validators.required],
      version: ['1.0', [Validators.required, Validators.pattern(/^\d+\.\d+(\.\d+)?$/)]],
      status: ['Draft']
    });

    this.componentForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      materialType: ['', Validators.required],
      unit: ['', Validators.required],
      description: ['']
    });

    this.workOrderForm = this.fb.group({
      productID: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(1)]],
      startDate: ['', Validators.required],
      endDate: ['', Validators.required]
    });

    this.taskForm = this.fb.group({
      description: ['', [Validators.required, Validators.minLength(5)]],
      assignedTo: ['', [Validators.required, Validators.minLength(2)]],
      notes: ['']
    });

    this.poForm = this.fb.group({
      supplierName: ['', Validators.required],
      expectedDeliveryDate: ['', Validators.required],
      notes: [''],
      inventoryID: ['', Validators.required],
      productName: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(0.0001)]],
      unitPrice: ['', [Validators.required, Validators.min(0)]]
    });

    this.adjustForm = this.fb.group({
      adjustment: ['', [Validators.required]],
      reason: ['', [Validators.required, Validators.minLength(5)]]
    });

    this.supplierForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      contactPerson: [''],
      phone: [''],
      email: ['', Validators.email],
      address: ['']
    });

    this.inventoryForm = this.fb.group({
      itemType: ['Product'],
      productID: [''],
      componentID: [''],
      productName: [''],
      quantityOnHand: ['', [Validators.required, Validators.min(0)]],
      minimumQuantity: ['', [Validators.required, Validators.min(0)]],
      notes: ['']
    });

    this.broadcastForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(2)]],
      message: ['', [Validators.required, Validators.minLength(5)]],
      category: ['General', Validators.required],
      sendToAll: [true]
    });

    this.bomForm = this.fb.group({
      productID: ['', Validators.required],
      componentID: ['', Validators.required],
      quantity: ['', [Validators.required, Validators.min(0.0001)]],
      version: ['1.0', [Validators.required, Validators.pattern(/^\d+\.\d+(\.\d+)?$/)]],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadUsers();
    this.loadProducts();
    this.loadBoms();
    this.loadAudit();
    this.loadWorkOrders();
    this.loadInventory();
    this.loadPurchaseOrders();
    this.loadSuppliers();
    this.loadNotifications();
    this.loadComponents();
    this.loadQuality();
    this.loadAnalytics();
  }

  showSection(s: Section): void {
    this.activeSection = s;
  }

  get sectionTitle(): string {
    const map: Record<Section, string> = {
      overview: 'Admin Overview', users: 'User Management',
      products: 'Product Setup', bom: 'BOM Management',
      workorders: 'Work Orders', inventory: 'Inventory & Stock',
      quality: 'Quality Overview', analytics: 'Analytics & KPI',
      notifications: 'Notifications', audit: 'Audit Logs'
    };
    return map[this.activeSection];
  }

  // ── Quality load ─────────────────────────────────────
  loadQuality(): void {
    this.qualityLoading = true;
    this.qualitySvc.getAllInspections()
      .pipe(timeout(10000), finalize(() => { this.qualityLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: (res: any) => { this.inspections = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
    this.qualitySvc.getAllDefects()
      .pipe(timeout(10000))
      .subscribe({ next: (res: any) => { this.defects = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  // ── Analytics load ───────────────────────────────────
  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.analyticsSvc.getDashboard()
      .pipe(timeout(10000), finalize(() => { this.analyticsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.analytics = res?.data ?? null; this.cdr.detectChanges(); }, error: () => {} });
    this.analyticsSvc.getReports()
      .pipe(timeout(10000))
      .subscribe({ next: res => { this.kpiReports = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  // ── Quality helpers ──────────────────────────────────
  get openDefectsCount(): number { return this.defects.filter(d => d.status === 'Open').length; }
  get criticalDefectsCount(): number { return this.defects.filter(d => d.severity === 'Critical').length; }
  get passedInspectionsCount(): number { return this.inspections.filter(i => i.result === 'Pass').length; }
  get failedInspectionsCount(): number { return this.inspections.filter(i => i.result === 'Fail').length; }

  // ── Analytics computed stats ─────────────────────────
  get completedWOCount(): number { return this.workOrders.filter(w => w.status === 'Completed').length; }
  get pendingWOCount(): number   { return this.workOrders.filter(w => w.status === 'Pending').length; }
  get cancelledWOCount(): number { return this.workOrders.filter(w => w.status === 'Cancelled').length; }
  get completionRate(): number {
    return this.workOrders.length ? Math.round((this.completedWOCount / this.workOrders.length) * 100) : 0;
  }
  get yieldRate(): number {
    const total = this.inspections.length;
    return total ? Math.round((this.passedInspectionsCount / total) * 100) : 0;
  }
  get allTasksFlat(): any[] {
    return Object.values(this.tasksByWorkOrder).flat();
  }
  get pendingTasksCount(): number   { return this.allTasksFlat.filter((t: any) => t.status === 'Pending').length; }
  get completedTasksCount(): number { return this.allTasksFlat.filter((t: any) => t.status === 'Completed').length; }
  get inProgressTasksCount(): number { return this.allTasksFlat.filter((t: any) => t.status === 'InProgress').length; }
  get totalTasksCount(): number { return this.allTasksFlat.length; }

  // WO funnel percentages
  woFunnelPct(status: string): number {
    const count = this.workOrders.filter(w => w.status === status).length;
    return this.workOrders.length ? Math.round((count / this.workOrders.length) * 100) : 0;
  }
  // Defect severity counts
  get highDefectsCount(): number { return this.defects.filter(d => d.severity === 'High').length; }
  get mediumDefectsCount(): number { return this.defects.filter(d => d.severity === 'Medium').length; }
  get lowDefectsCount(): number { return this.defects.filter(d => d.severity === 'Low').length; }
  get maxDefectSev(): number {
    return Math.max(this.criticalDefectsCount, this.highDefectsCount, this.mediumDefectsCount, this.lowDefectsCount, 1);
  }
  // KPI report search
  kpiSearchTerm = '';
  get filteredKpiReports(): KpiReportViewModel[] {
    const t = this.kpiSearchTerm.toLowerCase();
    return t ? this.kpiReports.filter(r => r.title.toLowerCase().includes(t) || r.reportType.toLowerCase().includes(t)) : this.kpiReports;
  }
  woDonutGradient(): string {
    const c = this.completionRate, ip = this.woFunnelPct('InProgress'), p = this.woFunnelPct('Pending');
    return `conic-gradient(#22c55e 0% ${c}%, #3b82f6 ${c}% ${c+ip}%, #f59e0b ${c+ip}% ${c+ip+p}%, #ef4444 ${c+ip+p}% 100%)`;
  }
  taskDonutGradient(): string {
    const t = this.totalTasksCount;
    if (!t) return 'conic-gradient(#e5e7eb 0% 100%)';
    const c = Math.round(this.completedTasksCount/t*100), ip = Math.round(this.inProgressTasksCount/t*100);
    return `conic-gradient(#22c55e 0% ${c}%, #3b82f6 ${c}% ${c+ip}%, #f59e0b ${c+ip}% 100%)`;
  }
  gaugeGradient(rate: number, threshHigh = 60, threshMid = 30): string {
    const color = rate > threshHigh ? '#22c55e' : rate > threshMid ? '#f59e0b' : '#ef4444';
    return `conic-gradient(${color} 0% ${rate}%, #e5e7eb ${rate}% 100%)`;
  }
  gaugeColor(rate: number, threshHigh = 60, threshMid = 30): string {
    return rate > threshHigh ? '#22c55e' : rate > threshMid ? '#f59e0b' : '#ef4444';
  }
  taskPct(count: number): string {
    return this.totalTasksCount ? Math.round(count / this.totalTasksCount * 100) + '%' : '0%';
  }

  parseKpiMetrics(json: string): { key: string; val: string }[] {
    if (!json) return [];
    try {
      const obj = JSON.parse(json);
      return Object.entries(obj).slice(0, 6).map(([k, v]) => ({
        key: k.replace(/([A-Z])/g, ' $1').trim().toUpperCase(),
        val: typeof v === 'number' ? (Number.isInteger(v as number) ? String(v) : (v as number).toFixed(1)) : String(v)
      }));
    } catch { return []; }
  }

  defectSeverityBadge(s: string): string {
    const m: Record<string,string> = { Critical:'b-inactive', High:'b-amber', Medium:'b-planner', Low:'b-draft' };
    return m[s] ?? 'b-draft';
  }
  inspResultBadge(r: string): string {
    const m: Record<string,string> = { Passed:'b-active', Failed:'b-inactive', Pending:'b-draft' };
    return m[r] ?? 'b-draft';
  }

  // --- USERS ---
  loadUsers(): void {
    this.usersLoading = true;
    this.usersError = '';
    this.http.get<any>('http://localhost:5000/api/v1/auth/users')
      .pipe(timeout(10000), finalize(() => { this.usersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.users = (res?.data ?? []).sort((a: AuthUserViewModel, b: AuthUserViewModel) => b.userID - a.userID);
          this.cdr.detectChanges();
        },
        error: err => {
          if (err.name === 'TimeoutError') this.usersError = 'AuthService timed out (port 5100). Please restart it.';
          else if (err.status === 0) this.usersError = 'Cannot connect to API Gateway (localhost:5000). Is it running?';
          else if (err.status === 401) this.usersError = 'Session expired. Please log out and log in again.';
          else if (err.status === 403) this.usersError = 'Access denied. Admin role required.';
          else this.usersError = `Error ${err.status}: ${err.error?.message ?? 'Failed to load users.'}`;
        }
      });
  }

  get activeUsers() { return this.users.filter(u => u.isActive).length; }

  registerUser(): void {
    if (this.registerForm.invalid) { this.registerForm.markAllAsTouched(); return; }
    const v = this.registerForm.value;
    if (v.password !== v.confirmPassword) {
      this.registerError = 'Passwords do not match.'; return;
    }
    this.registerLoading = true;
    this.registerError = '';
    this.http.post<any>('http://localhost:5000/api/v1/auth/register', v)
      .pipe(finalize(() => { this.registerLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
      next: (res) => {
        this.registerError = '';
        this.registerForm.reset();
        this.showUserModal = false;
        // Add new user at the top (newest first)
        if (res?.data) {
          this.users = [res.data, ...this.users];
        } else {
          this.loadUsers();
        }
        // Show inline success instead of toast
        this.usersSuccessMsg = 'User created successfully.';
        setTimeout(() => { this.usersSuccessMsg = ''; this.cdr.detectChanges(); }, 4000);
        this.cdr.detectChanges();
      },
      error: err => {
        if (err.status === 409)
          this.registerError = err.error?.message ?? 'This email is already registered.';
        else if (err.status === 400)
          this.registerError = err.error?.message ?? 'Invalid data. Please check all fields.';
        else
          this.registerError = err.error?.message ?? 'Failed to create user. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  get euf() { return this.editUserForm.controls; }

  openEditUser(user: AuthUserViewModel): void {
    this.editingUser = user;
    this.editUserForm.patchValue({ name: user.name, phone: user.phone, role: user.role });
    this.showEditUserModal = true;
  }

  saveEditUser(): void {
    if (this.editUserForm.invalid) { this.editUserForm.markAllAsTouched(); return; }
    if (!this.editingUser) return;
    this.editUserLoading = true;
    const v = this.editUserForm.value;
    this.http.put<any>(`http://localhost:5000/api/v1/auth/users/${this.editingUser.userID}`, v)
      .subscribe({
        next: (res) => {
          this.editUserLoading = false;
          this.showEditUserModal = false;
          const updated = res?.data;
          if (updated) {
            const idx = this.users.findIndex(u => u.userID === this.editingUser!.userID);
            if (idx >= 0) {
              this.users[idx] = { ...this.users[idx], name: updated.name, phone: updated.phone, role: updated.role };
              this.cdr.detectChanges();
            }
          }
          this.showToast('User updated successfully.');
        },
        error: err => {
          this.editUserLoading = false;
          this.showToast(err.error?.message ?? 'Failed to update user.', 'error');
        }
      });
  }

  trackByUserId(_: number, u: AuthUserViewModel): number { return u.userID; }

  toggleUserStatus(user: AuthUserViewModel): void {
    const userId = user.userID;
    const isCurrentlyActive = user.isActive;
    const action = isCurrentlyActive ? 'deactivate' : 'activate';
    const url = `http://localhost:5000/api/v1/auth/users/${userId}/${action}`;

    this.http.put<any>(url, {}).subscribe({
      next: () => {
        // Find by ID and replace with new object â€” avoids stale reference issues
        const idx = this.users.findIndex(u => u.userID === userId);
        if (idx >= 0) {
          this.users = [
            ...this.users.slice(0, idx),
            { ...this.users[idx], isActive: !isCurrentlyActive },
            ...this.users.slice(idx + 1)
          ];
        }
        this.usersSuccessMsg = `User ${isCurrentlyActive ? 'deactivated' : 'activated'} successfully.`;
        setTimeout(() => { this.usersSuccessMsg = ''; this.cdr.detectChanges(); }, 4000);
        this.cdr.detectChanges();
      },
      error: err => this.showToast(err.error?.message ?? 'Action failed.', 'error')
    });
  }

  // --- PRODUCTS ---
  loadProducts(): void {
    this.productsLoading = true;
    this.productsError = '';
    this.productSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.productsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.products = (res?.data ?? []).sort((a, b) => b.productID - a.productID);
          this.cdr.detectChanges();
        },
        error: err => {
          this.productsError = err.name === 'TimeoutError'
            ? 'Request timed out. Is ProductService running on port 5101?'
            : (err.status === 0 ? 'Cannot connect to API Gateway (localhost:5000).' : err.error?.message ?? 'Failed to load products.');
        }
      });
  }

  get activeProducts() { return this.products.filter(p => p.status === 'Active').length; }
  get draftProducts() { return this.products.filter(p => p.status === 'Draft').length; }

  createProduct(): void {
    if (this.productForm.invalid) { this.productForm.markAllAsTouched(); return; }
    this.productLoading = true;
    this.productSvc.create({ ...this.productForm.value, status: 'Draft' }).subscribe({
      next: () => {
        this.productLoading = false;
        this.productForm.reset({ version: '1.0', status: 'Draft' });
        this.showProductModal = false;
        this.productsSuccessMsg = 'Product registered successfully.';
        setTimeout(() => { this.productsSuccessMsg = ''; this.cdr.detectChanges(); }, 4000);
        this.loadProducts(); // reloads and re-sorts
      },
      error: err => {
        this.productLoading = false;
        this.showToast(err.error?.message ?? 'Failed to register product.', 'error');
      }
    });
  }

  openEditProduct(product: ProductViewModel): void {
    this.editingProduct = product;
    this.editProductStatus = product.status;
    this.showEditProductModal = true;
  }

  saveProductStatus(): void {
    if (!this.editingProduct || !this.editProductStatus) return;
    this.updateProductStatus(this.editingProduct, this.editProductStatus);
    this.showEditProductModal = false;
  }

  updateProductStatus(product: ProductViewModel, status: string): void {
    this.productSvc.updateStatus(product.productID, status).subscribe({
      next: () => { product.status = status; this.showToast('Status updated.'); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  deleteProduct(product: ProductViewModel): void {
    this.productSvc.delete(product.productID).subscribe({
      next: () => {
        this.products = this.products.filter(p => p.productID !== product.productID);
        this.showToast('Product deleted.');
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  // --- BOM ---
  loadBoms(): void {
    this.bomLoading = true;
    this.bomSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.bomLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.bomEntries = res?.data ?? [];
          this.bomByProduct = {};
          for (const b of this.bomEntries) {
            if (!this.bomByProduct[b.productID]) this.bomByProduct[b.productID] = [];
            this.bomByProduct[b.productID].push(b);
          }
          this.cdr.detectChanges();
        },
        error: err => {
          this.bomError = err.name === 'TimeoutError'
            ? 'Request timed out. Is ProductService running on port 5101?'
            : (err.status === 0 ? 'Cannot connect to API Gateway (localhost:5000).' : err.error?.message ?? 'Failed to load BOMs.');
        }
      });
  }

  get bomProducts(): { productID: number; productName: string; version: string; status: string; components: BomViewModel[] }[] {
    const map: Record<number, { productID: number; productName: string; version: string; status: string; components: BomViewModel[] }> = {};
    for (const b of this.bomEntries) {
      if (!map[b.productID]) {
        map[b.productID] = { productID: b.productID, productName: b.productName, version: b.version, status: b.status, components: [] };
      }
      map[b.productID].components.push(b);
    }
    return Object.values(map);
  }

  toggleBom(productId: number): void {
    if (this.expandedBomProducts.has(productId)) {
      this.expandedBomProducts.delete(productId);
    } else {
      this.expandedBomProducts.add(productId);
    }
  }

  isBomExpanded(productId: number): boolean {
    return this.expandedBomProducts.has(productId);
  }

  deleteBomEntry(id: number): void {
    this.bomSvc.delete(id).subscribe({
      next: () => {
        this.showToast('BOM entry deleted.');
        this.loadBoms();
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  // --- AUDIT ---
  loadAudit(action?: string): void {
    this.auditLoading = true;
    this.auditSvc.getAll(1, 20, action)
      .pipe(timeout(10000), finalize(() => { this.auditLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.auditLogs = res?.data?.data ?? [];
          this.auditTotalRecords = res?.data?.pagination?.totalRecords ?? 0;
          this.cdr.detectChanges();
        },
        error: err => {
          this.auditError = err.name === 'TimeoutError'
            ? 'Request timed out. Is ComplianceService running on port 5105?'
            : (err.status === 0 ? 'Cannot connect to API Gateway (localhost:5000).' : err.error?.message ?? 'Failed to load audit logs.');
        }
      });
  }

  onAuditFilterChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.loadAudit(val || undefined);
  }

  // --- UTILS ---
  // Both success and error now show as inline page alerts (no floating toast)
  showToast(msg: string, type: 'success' | 'error' = 'success'): void {
    clearTimeout(this.errorTimer);
    if (type === 'error') {
      this.errorAlert = msg;
      this.toastMsg = '';
      this.errorTimer = setTimeout(() => { this.errorAlert = ''; this.cdr.detectChanges(); }, 7000);
    } else {
      this.toastMsg = msg;    // reuse toastMsg for inline success
      this.errorAlert = '';
      this.errorTimer = setTimeout(() => { this.toastMsg = ''; this.cdr.detectChanges(); }, 4000);
    }
    this.cdr.detectChanges();
  }

  dismissError(): void { this.errorAlert = ''; }
  dismissSuccess(): void { this.toastMsg = ''; }

  roleBadgeClass(role: string): string {
    const map: Record<string, string> = {
      Admin: 'b-admin', Planner: 'b-planner', Operator: 'b-operator',
      Inspector: 'b-inspector', InventoryManager: 'b-inventory', ComplianceOfficer: 'b-compliance'
    };
    return map[role] ?? 'b-draft';
  }

  statusBadgeClass(status: string): string {
    if (status === 'Active') return 'b-active';
    if (status === 'Draft') return 'b-draft';
    return 'b-inactive';
  }

  // --- WORK ORDERS ---
  loadWorkOrders(): void {
    this.workOrdersLoading = true; this.workOrdersError = '';
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.workOrders = res?.data ?? [];
          // Auto-fix any WO where all tasks are already completed but WO status is stale
          this.workOrders.forEach(wo => {
            if (wo.status !== 'Completed' && wo.status !== 'Cancelled') {
              this.loadTasksForWorkOrder(wo.workOrderID);
            }
          });
          this.cdr.detectChanges();
        },
        error: err => { this.workOrdersError = err.status === 0 ? 'Cannot connect to WorkOrderService.' : err.error?.message ?? 'Failed to load work orders.'; }
      });
  }

  get wf() { return this.workOrderForm.controls; }

  onProductSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const p = this.products.find(x => x.productID === id);
    if (p) this.workOrderForm.patchValue({ productName: p.name });
  }

  onInventoryProductSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const p = this.products.find(x => x.productID === id);
    if (p) this.inventoryForm.patchValue({ productName: p.name, componentID: '' });
  }

  createWorkOrder(): void {
    if (this.workOrderForm.invalid) { this.workOrderForm.markAllAsTouched(); return; }
    this.workOrderLoading = true;
    const v = this.workOrderForm.value;
    const product = this.products.find(p => p.productID === +v.productID);
    this.workOrderSvc.create({
      productID: +v.productID,
      productName: product?.name ?? '',
      quantity: +v.quantity,
      startDate: new Date(v.startDate).toISOString(),
      endDate: new Date(v.endDate).toISOString()
    }).subscribe({
      next: () => {
        this.workOrderLoading = false; this.showWorkOrderModal = false;
        this.workOrderForm.reset(); this.showToast('Work order created.');
        this.loadWorkOrders();
      },
      error: err => { this.workOrderLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  // --- TASKS ---
  get tf() { return this.taskForm.controls; }

  toggleWorkOrder(id: number): void {
    if (this.expandedWorkOrders.has(id)) {
      this.expandedWorkOrders.delete(id);
    } else {
      this.expandedWorkOrders.add(id);
      this.loadTasksForWorkOrder(id); // Always reload to get fresh task statuses
    }
  }

  isWorkOrderExpanded(id: number): boolean {
    return this.expandedWorkOrders.has(id);
  }

  loadTasksForWorkOrder(workOrderId: number): void {
    this.workOrderSvc.getTasksByWorkOrder(workOrderId).subscribe({
      next: res => {
        const tasks = res?.data ?? [];
        this.tasksByWorkOrder = { ...this.tasksByWorkOrder, [workOrderId]: tasks };
        // Auto-complete WO if all tasks are Completed but WO status is not yet Completed
        if (tasks.length > 0 && tasks.every(t => t.status === 'Completed')) {
          const wo = this.workOrders.find(w => w.workOrderID === workOrderId);
          if (wo && wo.status !== 'Completed' && wo.status !== 'Cancelled') {
            this.workOrderSvc.updateStatus(workOrderId, 'Completed').subscribe({
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

  openAddTask(wo: WorkOrderViewModel): void {
    this.selectedWorkOrderForTask = wo;
    this.taskForm.reset();
    this.showTaskModal = true;
  }

  createTask(): void {
    if (this.taskForm.invalid) { this.taskForm.markAllAsTouched(); return; }
    if (!this.selectedWorkOrderForTask) return;
    this.taskLoading = true;
    const v = this.taskForm.value;
    this.workOrderSvc.createTask({
      workOrderID: this.selectedWorkOrderForTask.workOrderID,
      description: v.description,
      assignedTo: v.assignedTo,
      notes: v.notes || undefined
    }).subscribe({
      next: () => {
        this.taskLoading = false; this.showTaskModal = false; this.taskForm.reset();
        this.showToast('Task added.');
        this.loadTasksForWorkOrder(this.selectedWorkOrderForTask!.workOrderID);
      },
      error: err => { this.taskLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  checkAndAutoCompleteWorkOrder(workOrderId: number): void {
    const tasks = this.tasksByWorkOrder[workOrderId];
    if (!tasks || tasks.length === 0) return;
    const allCompleted = tasks.every(t => t.status === 'Completed');
    if (allCompleted) {
      const wo = this.workOrders.find(w => w.workOrderID === workOrderId);
      if (wo && wo.status !== 'Completed') {
        this.workOrderSvc.updateStatus(workOrderId, 'Completed').subscribe({
          next: () => {
            wo.status = 'Completed';
            this.showToast(`✓ All tasks done — WO-${workOrderId} auto-completed.`);
            this.cdr.detectChanges();
          },
          error: () => {}
        });
      }
    }
  }

  updateTaskStatus(task: WorkOrderTaskViewModel, status: string): void {
    this.workOrderSvc.updateTaskStatus(task.taskID, status).subscribe({
      next: () => {
        task.status = status;
        this.showToast('Task status updated.');
        this.checkAndAutoCompleteWorkOrder(task.workOrderID);
        this.cdr.detectChanges();
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  deleteTask(task: WorkOrderTaskViewModel): void {
    this.workOrderSvc.deleteTask(task.taskID).subscribe({
      next: () => {
        const list = this.tasksByWorkOrder[task.workOrderID] ?? [];
        this.tasksByWorkOrder = { ...this.tasksByWorkOrder, [task.workOrderID]: list.filter(t => t.taskID !== task.taskID) };
        this.showToast('Task deleted.'); this.cdr.detectChanges();
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  taskStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  updateWorkOrderStatus(wo: WorkOrderViewModel, status: string): void {
    this.workOrderSvc.updateStatus(wo.workOrderID, status).subscribe({
      next: () => { wo.status = status; this.showToast('Status updated.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  deleteWorkOrder(wo: WorkOrderViewModel): void {
    this.workOrderSvc.delete(wo.workOrderID).subscribe({
      next: () => { this.workOrders = this.workOrders.filter(w => w.workOrderID !== wo.workOrderID); this.showToast('Work order deleted.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  woStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  // --- INVENTORY ---
  loadInventory(): void {
    this.inventoryLoading = true; this.inventoryError = '';
    this.inventorySvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.inventoryLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.inventoryItems = res?.data ?? []; this.cdr.detectChanges(); },
        error: err => { this.inventoryError = err.status === 0 ? 'Cannot connect to InventoryService.' : err.error?.message ?? 'Failed to load inventory.'; }
      });
  }

  get ivf() { return this.inventoryForm.controls; }


  onInventoryComponentSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const c = this.components.find(x => x.componentID === id);
    if (c) this.inventoryForm.patchValue({ productName: c.name });
  }

  createInventoryItem(): void {
    if (this.inventoryForm.invalid) { this.inventoryForm.markAllAsTouched(); return; }
    const v = this.inventoryForm.value;
    const isRaw = v.itemType === 'RawMaterial';
    if (isRaw && !v.componentID) { this.showToast('Please select a raw material.', 'error'); return; }
    if (!isRaw && !v.productID) { this.showToast('Please select a product.', 'error'); return; }
    this.inventoryCreateLoading = true;
    this.inventorySvc.create({
      itemType: v.itemType,
      productID: isRaw ? undefined : +v.productID,
      componentID: isRaw ? +v.componentID : undefined,
      productName: v.productName,
      quantityOnHand: +v.quantityOnHand, minimumQuantity: +v.minimumQuantity,
      notes: v.notes || undefined
    }).subscribe({
      next: () => {
        this.inventoryCreateLoading = false; this.showInventoryModal = false;
        this.inventoryForm.reset(); this.showToast('Inventory item added.');
        this.loadInventory();
      },
      error: err => { this.inventoryCreateLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  deleteInventoryItem(item: InventoryItemViewModel): void {
    this.inventorySvc.delete(item.inventoryID).subscribe({
      next: () => { this.inventoryItems = this.inventoryItems.filter(i => i.inventoryID !== item.inventoryID); this.showToast('Item deleted.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  // --- NOTIFICATIONS ---
  loadNotifications(): void {
    this.notificationsLoading = true; this.notificationsError = '';
    this.notificationSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.notificationsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.notifications = res?.data ?? []; this.unreadCount = this.notifications.filter(n => n.status !== 'Read').length; this.cdr.detectChanges(); },
        error: err => { this.notificationsError = err.status === 0 ? 'Cannot connect to NotificationService.' : err.error?.message ?? 'Failed to load notifications.'; }
      });
  }

  get brf() { return this.broadcastForm.controls; }

  broadcastNotification(): void {
    if (this.broadcastForm.invalid) { this.broadcastForm.markAllAsTouched(); return; }
    this.broadcastLoading = true;
    const v = this.broadcastForm.value;
    const req = {
      userIDs: this.users.filter(u => u.isActive).map(u => u.userID),
      title: v.title, message: v.message, category: v.category
    };
    this.notificationSvc.broadcast(req).subscribe({
      next: () => {
        this.broadcastLoading = false; this.showBroadcastModal = false;
        this.broadcastForm.reset({ category: 'General', sendToAll: true });
        this.showToast('Notification broadcast sent.');
        this.loadNotifications();
      },
      error: err => { this.broadcastLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  cleanupNotifications(): void {
    this.notificationSvc.cleanup().subscribe({
      next: () => { this.showToast('Old notifications cleaned up.'); this.loadNotifications(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  notifPriorityBadge(p: string): string {
    const m: Record<string,string> = { High:'b-admin', Medium:'b-inspector', Low:'b-planner', Normal:'b-operator' };
    return m[p] ?? 'b-draft';
  }

  // --- COMPONENTS ---
  loadComponents(): void {
    this.componentsLoading = true;
    this.componentSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.componentsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.components = res?.data ?? []; this.cdr.detectChanges(); },
        error: () => {}
      });
  }

  get cf() { return this.componentForm.controls; }
  get activeComponents() { return this.components.filter(c => c.isActive); }
  // Inventory items that are raw materials (for BOM dropdown)
  get rawMaterialInventory() {
    return this.inventoryItems.filter(i => i.itemType === 'RawMaterial' && i.componentID);
  }
  selectedBomInventoryItem: InventoryItemViewModel | null = null;

  onBomComponentSelect(event: Event): void {
    const componentId = +(event.target as HTMLSelectElement).value;
    this.selectedBomInventoryItem = this.rawMaterialInventory.find(i => i.componentID === componentId) ?? null;
  }

  createComponent(): void {
    if (this.componentForm.invalid) { this.componentForm.markAllAsTouched(); return; }
    this.componentCreateLoading = true;
    this.componentError = '';
    const v = this.componentForm.value;
    this.componentSvc.create({ name: v.name, materialType: v.materialType, unit: v.unit, description: v.description || undefined })
      .pipe(finalize(() => { this.componentCreateLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: (res) => {
          const createdComponent = res?.data;
          // Inventory item is auto-created by the backend (ProductService → InventoryService).
          // Just reload inventory here to reflect the new entry.
          setTimeout(() => this.loadInventory(), 500);
          this.componentSuccess = `”${createdComponent?.name ?? v.name}” registered and added to Inventory.`;
          this.componentForm.reset();
          this.loadComponents();
          this.ngZone.run(() => {
            setTimeout(() => {
              this.showComponentModal = false;
              this.componentSuccess = '';
              this.cdr.detectChanges();
            }, 1800);
          });
          this.cdr.detectChanges();
        },
        error: err => {
          this.componentError = err.error?.message ?? 'Failed to register material.';
        }
      });
  }

  deleteComponent(c: ComponentViewModel): void {
    this.componentSvc.delete(c.componentID).subscribe({
      next: () => { this.components = this.components.filter(x => x.componentID !== c.componentID); this.showToast('Component deleted.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  // Open BOM modal for a specific product
  closeBomModal(): void {
    this.showBomModal = false;
    this.bomSuccessMsg = '';
    this.selectedParentProductId = null;
    this.selectedBomInventoryItem = null;
  }

  openViewBom(product: ProductViewModel): void {
    this.viewingBomProduct = product;
    this.showViewBomModal = true;
  }

  openBomModalForProduct(product: ProductViewModel): void {
    this.showViewBomModal = false;
    this.bomSuccessMsg = '';
    this.selectedBomInventoryItem = null;
    this.bomForm.reset({ version: '1.0' });
    this.bomForm.patchValue({ productID: product.productID });
    this.selectedParentProductId = product.productID;
    this.showBomModal = true;
  }

  // Prevent same product selected as both parent and component
  onBomProductChange(): void {
    const pid = +this.bomForm.value.productID;
    if (pid && +this.bomForm.value.componentID === pid) {
      this.bomForm.patchValue({ componentID: '' });
    }
  }

  createBom(): void {
    if (this.bomForm.invalid) { this.bomForm.markAllAsTouched(); return; }
    const v = this.bomForm.value;
    this.bomCreateLoading = true;
    const selectedComponent = this.activeComponents.find(c => c.componentID === +v.componentID);
    this.bomSvc.create({
      productID: +v.productID,
      componentID: +v.componentID,
      quantity: +v.quantity,
      version: v.version,
      notes: v.notes || undefined
    }).subscribe({
      next: () => {
        this.bomCreateLoading = false;
        this.bomSuccessCreatedName = selectedComponent?.name ?? 'Component';
        this.bomSuccessMsg = `"${this.bomSuccessCreatedName}" added successfully to the BOM.`;
        this.loadBoms();
        this.cdr.detectChanges();
        setTimeout(() => {
          this.closeBomModal();
          this.cdr.detectChanges();
        }, 1500);
      },
      error: err => {
        this.bomCreateLoading = false;
        this.showToast(err.error?.message ?? 'Failed to add BOM entry.', 'error');
      }
    });
  }

  initials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  get viewingBomEntries(): BomViewModel[] {
    if (!this.viewingBomProduct) return [];
    return this.bomByProduct[this.viewingBomProduct.productID] ?? [];
  }

  getProductName(id: number | string): string {
    const p = this.products.find(x => x.productID === +id);
    return p ? `${p.name} (v${p.version})` : 'â€”';
  }

  materialTypeBadge(type: string): string {
    const m: Record<string,string> = {
      RawMaterial: 'b-planner', Part: 'b-operator',
      SubAssembly: 'b-inventory', Chemical: 'b-inspector', Consumable: 'b-inactive'
    };
    return m[type] ?? 'b-draft';
  }

  // Inventory getters
  get pof() { return this.poForm.controls; }
  get af()  { return this.adjustForm.controls; }
  get sf()  { return this.supplierForm.controls; }
  get inStockCount()    { return this.inventoryItems.filter(i => i.status === 'InStock').length; }
  get outOfStockCount() { return this.inventoryItems.filter(i => i.status === 'OutOfStock').length; }
  get pendingPOCount()  { return this.purchaseOrders.filter(p => p.status === 'Pending').length; }
  get lowStockCount()   { return this.inventoryItems.filter(i => i.status === 'LowStock').length; }

  loadPurchaseOrders(): void {
    this.poLoading = true; this.poError = '';
    this.inventorySvc.getAllPO()
      .pipe(timeout(10000), finalize(() => { this.poLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.purchaseOrders = res?.data ?? []; this.cdr.detectChanges(); },
        error: () => { this.poError = 'Failed to load purchase orders.'; }
      });
  }

  onPOItemSelect(event: Event): void {
    const id = +(event.target as HTMLSelectElement).value;
    const inv = this.inventoryItems.find(i => i.inventoryID === id);
    if (inv) this.poForm.patchValue({ productName: inv.productName });
  }

  createPO(): void {
    if (this.poForm.invalid) { this.poForm.markAllAsTouched(); return; }
    const v = this.poForm.value;
    if (!v.supplierName) { this.showToast('Please select a supplier.', 'error'); return; }
    if (!v.inventoryID) { this.showToast('Please select an inventory item.', 'error'); return; }
    this.poLoading2 = true;
    const inv = this.inventoryItems.find(i => i.inventoryID === +v.inventoryID);
    this.inventorySvc.createPO({
      supplierName: v.supplierName,
      expectedDeliveryDate: new Date(v.expectedDeliveryDate).toISOString(),
      notes: v.notes || undefined,
      items: [{ inventoryID: +v.inventoryID, productID: inv?.productID ?? inv?.componentID ?? 1, productName: inv?.productName ?? v.productName ?? '', quantity: +v.quantity, unitPrice: +v.unitPrice }]
    }).subscribe({
      next: res => {
        this.poLoading2 = false; this.showPOModal = false; this.poForm.reset();
        this.showToast('Purchase order created.');
        if (res?.data) { this.purchaseOrders = [...this.purchaseOrders, res.data]; this.cdr.detectChanges(); }
        else this.loadPurchaseOrders();
      },
      error: err => { this.poLoading2 = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  updatePOStatus(po: PurchaseOrderViewModel, status: string): void {
    this.inventorySvc.updatePOStatus(po.poid, status).subscribe({
      next: () => {
        po.status = status;
        this.cdr.detectChanges();

        if (status === 'Received') {
          // Backend already adjusts stock — just reload inventory to reflect updated quantities
          this.loadInventory();
          this.showToast(`PO-${po.poid} received — stock updated automatically.`);
        } else {
          this.showToast('PO status updated.');
        }
        this.cdr.detectChanges();
      },
      error: err => {
        this.showToast(err.error?.message ?? 'Failed.', 'error');
      }
    });
  }

  openAdjust(item: InventoryItemViewModel): void {
    this.adjustingItem = item;
    this.adjustForm.reset();
    this.showAdjustModal = true;
  }

  submitAdjust(): void {
    if (this.adjustForm.invalid) { this.adjustForm.markAllAsTouched(); return; }
    this.adjustLoading = true;
    const v = this.adjustForm.value;
    this.inventorySvc.adjust(this.adjustingItem!.inventoryID, { adjustment: +v.adjustment, reason: v.reason })
      .subscribe({
        next: res => {
          this.adjustLoading = false; this.showAdjustModal = false;
          if (res?.data) {
            const idx = this.inventoryItems.findIndex(i => i.inventoryID === this.adjustingItem!.inventoryID);
            if (idx >= 0) { this.inventoryItems[idx] = res.data; this.inventoryItems = [...this.inventoryItems]; this.cdr.detectChanges(); }
          }
          this.showToast('Stock adjusted successfully.');
        },
        error: err => { this.adjustLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  loadSuppliers(): void {
    this.suppliersLoading = true;
    this.inventorySvc.getAllSuppliers()
      .pipe(timeout(10000), finalize(() => { this.suppliersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.suppliers = res?.data ?? []; this.cdr.detectChanges(); },
        error: () => { this.suppliersError = 'Failed to load suppliers.'; }
      });
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

  poCountByStatus(status: string): number { return this.purchaseOrders.filter(p => p.status === status).length; }
  poHasStatus(status: string): boolean    { return this.purchaseOrders.some(p => p.status === status); }
  supplierPoCount(name: string): number   { return this.purchaseOrders.filter(p => p.supplierName === name).length; }

  invStatusBadge(s: string): string {
    const m: Record<string,string> = { InStock:'b-active', LowStock:'b-inspector', OutOfStock:'b-admin' };
    return m[s] ?? 'b-draft';
  }

  poStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', Approved:'b-planner', Ordered:'b-inventory', Received:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  auditBadgeClass(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('login'))    return 'audit-badge-login';
    if (a.includes('create') || a.includes('register') || a.includes('add')) return 'audit-badge-create';
    if (a.includes('update') || a.includes('change') || a.includes('activate') || a.includes('deactivate')) return 'audit-badge-update';
    if (a.includes('delete') || a.includes('remove')) return 'audit-badge-delete';
    return 'audit-badge-default';
  }

  logout(): void {
    this.auth.logout();
    this.router.navigate(['/login'], { replaceUrl: true });
  }

  // ── Change Password ──────────────────────────────────────────────────────
  showChangePwModal = false;
  changePwCurrentPassword = '';
  changePwNewPassword = '';
  changePwConfirmPassword = '';
  changePwLoading = false;
  changePwError = '';
  changePwSuccess = '';

  submitChangePassword(): void {
    this.changePwError = '';
    this.changePwSuccess = '';
    if (!this.changePwCurrentPassword || !this.changePwNewPassword || !this.changePwConfirmPassword) {
      this.changePwError = 'All fields are required.'; return;
    }
    if (this.changePwNewPassword.length < 6) {
      this.changePwError = 'New password must be at least 6 characters.'; return;
    }
    if (this.changePwNewPassword !== this.changePwConfirmPassword) {
      this.changePwError = 'New passwords do not match.'; return;
    }
    this.changePwLoading = true;
    this.auth.changePassword(this.changePwCurrentPassword, this.changePwNewPassword).subscribe({
      next: () => {
        this.changePwLoading = false;
        this.changePwSuccess = 'Password changed successfully!';
        setTimeout(() => { this.showChangePwModal = false; this.changePwCurrentPassword = ''; this.changePwNewPassword = ''; this.changePwConfirmPassword = ''; this.changePwSuccess = ''; }, 1500);
      },
      error: (err: any) => {
        this.changePwLoading = false;
        this.changePwError = err?.error?.message ?? err?.error?.Message ?? 'Failed to change password.';
      }
    });
  }

  get f() { return this.registerForm.controls; }
  get pf() { return this.productForm.controls; }
  get bf() { return this.bomForm.controls; }

  get activeProductsList() { return this.products.filter(p => p.status === 'Active'); }
  get operators() { return this.users.filter(u => u.role === 'Operator' && u.isActive); }
  get inProgressCount() { return this.workOrders.filter(w => w.status === 'InProgress').length; }
  get overdueCount() { return this.workOrders.filter(w => w.isOverdue).length; }
}
