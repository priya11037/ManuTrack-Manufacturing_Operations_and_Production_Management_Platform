import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';
import { WorkOrderService, WorkOrderViewModel, WorkOrderTaskViewModel } from '../../core/services/workorder.service';
import { InventoryService, InventoryItemViewModel } from '../../core/services/inventory.service';
import { AnalyticsService, DashboardSummaryViewModel } from '../../core/services/analytics.service';
import { NotificationViewModel } from '../../core/services/notification.service';
import { WorkOrderStatuses } from '../../shared/constants/enums';

type Section = 'overview' | 'tasks' | 'products' | 'notifications';

@Component({
  selector: 'app-operator',
  standalone: false,
  templateUrl: './operator.component.html',
  styleUrl: './operator.component.css'
})
export class OperatorComponent implements OnInit {
  activeSection: Section = 'overview';
  userName: string;
  userInitials: string;

  workOrders: WorkOrderViewModel[] = [];
  tasksByWorkOrder: Record<number, WorkOrderTaskViewModel[]> = {};
  expandedWorkOrders = new Set<number>();
  products: ProductViewModel[] = [];
  bomByProduct: Record<number, BomViewModel[]> = {};
  expandedBomProducts = new Set<number>();
  inventoryItems: InventoryItemViewModel[] = [];
  notifications: NotificationViewModel[] = [];
  unreadCount = 0;
  analytics: DashboardSummaryViewModel | null = null;

  workOrdersLoading = false; workOrdersError = '';
  productsLoading = false;
  inventoryLoading = false;
  analyticsLoading = false;
  notificationsLoading = false;

  toastMsg = ''; toastType: 'success' | 'error' = 'success';
  errorAlert = '';
  readonly workOrderStatuses = WorkOrderStatuses;

  constructor(
    private auth: AuthService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private workOrderSvc: WorkOrderService,
    private inventorySvc: InventoryService,
    private analyticsSvc: AnalyticsService,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.userName = this.auth.getName() ?? 'Operator';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  }

  ngOnInit(): void {
    this.loadWorkOrders();
    this.loadProducts();
    this.loadNotifications();
  }

  get sectionTitle(): string {
    const map: Record<Section, string> = {
      overview: 'Overview', tasks: 'My Work Orders & Tasks',
      products: 'Products & BOM', notifications: 'Notifications'
    };
    return map[this.activeSection];
  }

  // ── Products & BOMs filtered to operator's WO products ──
  get myProductIds(): Set<number> {
    return new Set(this.myWorkOrders.map(wo => wo.productID));
  }
  get myProducts(): ProductViewModel[] {
    const ids = this.myProductIds;
    return this.products.filter(p => ids.has(p.productID));
  }

  // ── Task stats ─────────────────────────────────────────
  get myCompletedTasksCount(): number {
    let count = 0;
    for (const tasks of Object.values(this.tasksByWorkOrder)) {
      count += tasks.filter(t => t.status === 'Completed' && t.assignedTo?.toLowerCase().trim() === this.userName.toLowerCase().trim()).length;
    }
    return count;
  }
  get myInProgressTasksCount(): number {
    let count = 0;
    for (const tasks of Object.values(this.tasksByWorkOrder)) {
      count += tasks.filter(t => t.status === 'InProgress' && t.assignedTo?.toLowerCase().trim() === this.userName.toLowerCase().trim()).length;
    }
    return count;
  }

  showSection(s: Section): void { this.activeSection = s; }

  // â”€â”€ MY TASKS (view WO + update task status) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadWorkOrders(): void {
    this.workOrdersLoading = true; this.workOrdersError = '';
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.workOrders = res?.data ?? [];
          // Load tasks for ALL work orders to filter by assignment
          this.workOrders.forEach(wo => this.loadTasks(wo.workOrderID));
          this.cdr.detectChanges();
        },
        error: () => { this.workOrdersError = 'Failed to load work orders.'; }
      });
  }

  // Only show work orders that have at least one task assigned to this operator
  get myWorkOrders(): WorkOrderViewModel[] {
    return this.workOrders.filter(wo => {
      const tasks = this.tasksByWorkOrder[wo.workOrderID] ?? [];
      return tasks.some(t => t.assignedTo?.toLowerCase().trim() === this.userName.toLowerCase().trim());
    });
  }

  isWorkOrderExpanded(id: number): boolean { return this.expandedWorkOrders.has(id); }
  toggleWorkOrder(id: number): void {
    if (this.expandedWorkOrders.has(id)) this.expandedWorkOrders.delete(id);
    else { this.expandedWorkOrders.add(id); this.loadTasks(id); } // Always reload — no cache guard
  }

  loadTasks(workOrderId: number): void {
    this.workOrderSvc.getTasksByWorkOrder(workOrderId).subscribe({
      next: res => {
        const tasks = res?.data ?? [];
        this.tasksByWorkOrder = { ...this.tasksByWorkOrder, [workOrderId]: tasks };
        // Auto-complete WO if all tasks are done
        this.checkAutoComplete(workOrderId, tasks);
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  private checkAutoComplete(workOrderId: number, tasks: WorkOrderTaskViewModel[]): void {
    if (!tasks.length) return;
    const allDone = tasks.every(t => t.status === 'Completed' || t.status === 'Cancelled');
    if (!allDone) return;
    const wo = this.workOrders.find(w => w.workOrderID === workOrderId);
    if (wo && wo.status !== 'Completed' && wo.status !== 'Cancelled') {
      this.workOrderSvc.updateStatus(workOrderId, 'Completed').subscribe({
        next: res => {
          if (res?.success !== false) {
            wo.status = 'Completed';
            this.showToast(`✓ All tasks done — WO-${workOrderId} auto-completed.`);
            this.cdr.detectChanges();
          }
        },
        error: () => {}
      });
    }
  }

  // Check if this task is assigned to the current operator
  isMyTask(task: WorkOrderTaskViewModel): boolean {
    return task.assignedTo?.toLowerCase().trim() === this.userName.toLowerCase().trim();
  }

  // Operator can only update task status (not create/delete tasks)
  updateTaskStatus(task: WorkOrderTaskViewModel, status: string): void {
    this.workOrderSvc.updateTaskStatus(task.taskID, status).subscribe({
      next: () => {
        task.status = status;
        this.showToast(`Task marked as ${status}.`);
        // Re-load tasks to re-evaluate auto-complete
        this.loadTasks(task.workOrderID);
        this.cdr.detectChanges();
      },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  taskStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  woStatusBadge(s: string): string {
    const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  get myTasksCount(): number {
    let total = 0;
    for (const tasks of Object.values(this.tasksByWorkOrder)) {
      total += tasks.filter(t => t.assignedTo?.toLowerCase() === this.userName.toLowerCase()).length;
    }
    return total;
  }

  get pendingTasksCount(): number {
    let total = 0;
    for (const tasks of Object.values(this.tasksByWorkOrder)) {
      total += tasks.filter(t =>
        (t.status === 'Pending' || t.status === 'InProgress') &&
        t.assignedTo?.toLowerCase().trim() === this.userName.toLowerCase().trim()
      ).length;
    }
    return total;
  }

  // â”€â”€ PRODUCTS (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadProducts(): void {
    this.productsLoading = true;
    this.productSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.productsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => {
          this.products = (res?.data ?? []).sort((a, b) => b.productID - a.productID);
          this.bomSvc.getAll().pipe(timeout(10000)).subscribe({
            next: bomRes => {
              const entries = bomRes?.data ?? [];
              this.bomByProduct = {};
              for (const b of entries) {
                if (!this.bomByProduct[b.productID!]) this.bomByProduct[b.productID!] = [];
                this.bomByProduct[b.productID!].push(b);
              }
              this.cdr.detectChanges();
            },
            error: () => {}
          });
        },
        error: () => {}
      });
  }

  isBomExpanded(id: number): boolean { return this.expandedBomProducts.has(id); }
  toggleBom(id: number): void {
    if (this.expandedBomProducts.has(id)) this.expandedBomProducts.delete(id);
    else this.expandedBomProducts.add(id);
  }

  statusBadgeClass(s: string): string {
    if (s === 'Active') return 'b-active';
    if (s === 'Draft') return 'b-draft';
    return 'b-inactive';
  }

  materialTypeBadge(type: string): string {
    const m: Record<string,string> = { RawMaterial:'b-planner', Part:'b-operator', SubAssembly:'b-inventory', Chemical:'b-inspector', Consumable:'b-inactive' };
    return m[type] ?? 'b-draft';
  }

  // â”€â”€ INVENTORY (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadInventory(): void {
    this.inventoryLoading = true;
    this.inventorySvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.inventoryLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.inventoryItems = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  invStatusBadge(s: string): string {
    const m: Record<string,string> = { InStock:'b-active', LowStock:'b-inspector', OutOfStock:'b-admin' };
    return m[s] ?? 'b-draft';
  }

  get lowStockCount(): number { return this.inventoryItems.filter(i => i.status !== 'InStock').length; }

  // â”€â”€ ANALYTICS (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.analyticsSvc.getDashboard()
      .pipe(timeout(10000), finalize(() => { this.analyticsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.analytics = res?.data ?? null; this.cdr.detectChanges(); }, error: () => {} });
  }

  // â”€â”€ NOTIFICATIONS (own only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ UTILS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
