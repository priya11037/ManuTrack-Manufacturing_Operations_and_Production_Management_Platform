import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import { AuthService } from '../../core/services/auth.service';
import { WorkOrderService, WorkOrderViewModel } from '../../core/services/workorder.service';
import { QualityService, InspectionViewModel, DefectViewModel } from '../../core/services/quality.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';
import { NotificationViewModel } from '../../core/services/notification.service';

type Section = 'overview' | 'inspections' | 'defects' | 'workorders' | 'products' | 'analytics' | 'notifications';

@Component({
  selector: 'app-quality-inspector',
  standalone: false,
  templateUrl: './quality-inspector.component.html',
  styleUrl: './quality-inspector.component.css'
})
export class QualityInspectorComponent implements OnInit {
  activeSection: Section = 'overview';
  userName: string;
  userInitials: string;

  inspections: InspectionViewModel[] = [];
  defects: DefectViewModel[] = [];
  defectsByInspection: Record<number, DefectViewModel[]> = {};
  expandedInspections = new Set<number>();
  workOrders: WorkOrderViewModel[] = [];
  products: ProductViewModel[] = [];
  bomByProduct: Record<number, BomViewModel[]> = {};
  expandedBomProducts = new Set<number>();
  notifications: NotificationViewModel[] = [];
  unreadCount = 0;

  inspectionsLoading = false; inspectionsError = '';
  defectsLoading = false;
  workOrdersLoading = false;
  productsLoading = false;
  notificationsLoading = false;

  showInspectionModal = false;
  showDefectModal = false;
  showResolveModal = false;
  showResultModal = false;

  selectedInspectionForDefect: InspectionViewModel | null = null;
  selectedDefectForResolve: DefectViewModel | null = null;
  selectedInspectionForResult: InspectionViewModel | null = null;

  inspectionForm!: FormGroup;
  defectForm!: FormGroup;
  resolveForm!: FormGroup;
  resultForm!: FormGroup;

  inspectionLoading = false;
  defectLoading = false;
  resolveLoading = false;
  resultLoading = false;

  toastMsg = ''; toastType: 'success' | 'error' = 'success';
  errorAlert = '';

  constructor(
    private auth: AuthService,
    private workOrderSvc: WorkOrderService,
    private qualitySvc: QualityService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private fb: FormBuilder,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.userName = this.auth.getName() ?? 'Inspector';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    this.inspectionForm = this.fb.group({
      workOrderID: ['', Validators.required],
      inspectionDate: ['', Validators.required],
      notes: ['']
    });

    this.defectForm = this.fb.group({
      description: ['', [Validators.required, Validators.minLength(5)]],
      severity: ['', Validators.required]
    });

    this.resolveForm = this.fb.group({
      resolutionDescription: ['', [Validators.required, Validators.minLength(10)]]
    });

    this.resultForm = this.fb.group({
      result: ['', Validators.required],
      status: ['Completed', Validators.required],
      notes: ['']
    });
  }

  ngOnInit(): void {
    this.loadInspections();
    this.loadDefects();
    this.loadWorkOrders();
    this.loadProducts();
    this.loadNotifications();
  }

  get sectionTitle(): string {
    const m: Record<Section,string> = { overview:'Overview', inspections:'Inspections', defects:'Defects', workorders:'Work Orders', products:'Products & BOM', analytics:'Analytics', notifications:'Notifications' };
    return m[this.activeSection];
  }
  showSection(s: Section): void { this.activeSection = s; }

  // ── Products (read-only) ─────────────────────────────
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
            }, error: () => {}
          });
        }, error: () => {}
      });
  }

  isBomExpanded(id: number): boolean { return this.expandedBomProducts.has(id); }
  toggleBom(id: number): void {
    if (this.expandedBomProducts.has(id)) this.expandedBomProducts.delete(id);
    else this.expandedBomProducts.add(id);
  }
  statusBadgeClass(s: string): string { if (s==='Active') return 'b-active'; if (s==='Draft') return 'b-draft'; return 'b-inactive'; }
  materialTypeBadge(t: string): string { const m: Record<string,string> = { RawMaterial:'b-planner', Part:'b-operator', SubAssembly:'b-inventory', Chemical:'b-inspector', Consumable:'b-inactive' }; return m[t] ?? 'b-draft'; }

  // ── Analytics computed stats ─────────────────────────
  get passedCount(): number { return this.inspections.filter(i => i.result === 'Pass').length; }
  get failedCount(): number { return this.inspections.filter(i => i.result === 'Fail').length; }
  get pendingInspCount(): number { return this.inspections.filter(i => !i.result || i.result === '').length; }
  get yieldRate(): number { return this.inspections.length ? Math.round(this.passedCount / this.inspections.length * 100) : 0; }
  get resolvedDefectsCount(): number { return this.defects.filter(d => d.status === 'Resolved' || d.status === 'Closed').length; }
  get inReviewDefectsCount(): number { return this.defects.filter(d => d.status === 'InReview').length; }
  get criticalCount(): number { return this.defects.filter(d => d.severity === 'Critical').length; }
  get highCount(): number { return this.defects.filter(d => d.severity === 'High').length; }
  get mediumCount(): number { return this.defects.filter(d => d.severity === 'Medium').length; }
  get lowCount(): number { return this.defects.filter(d => d.severity === 'Low').length; }
  get maxDefSev(): number { return Math.max(this.criticalCount, this.highCount, this.mediumCount, this.lowCount, 1); }
  get maxDefStatus(): number { return Math.max(this.openDefectsCount, this.inReviewDefectsCount, this.resolvedDefectsCount, 1); }
  get completedWOsInspected(): number {
    const inspectedWOIds = new Set(this.inspections.map(i => i.workOrderID));
    return this.workOrders.filter(w => w.status === 'Completed' && inspectedWOIds.has(w.workOrderID)).length;
  }
  get completedWOsTotal(): number { return this.workOrders.filter(w => w.status === 'Completed').length; }
  get inspectionCoverage(): number { return this.completedWOsTotal ? Math.round(this.completedWOsInspected / this.completedWOsTotal * 100) : 0; }

  inspDonutGradient(): string {
    const t = this.inspections.length || 1;
    const p = Math.round(this.passedCount / t * 100);
    const f = Math.round(this.failedCount / t * 100);
    return `conic-gradient(#22c55e 0% ${p}%, #ef4444 ${p}% ${p+f}%, #e5e7eb ${p+f}% 100%)`;
  }
  defectSevGradient(): string {
    const t = this.defects.length || 1;
    const c = Math.round(this.criticalCount / t * 100);
    const h = Math.round(this.highCount / t * 100);
    const m = Math.round(this.mediumCount / t * 100);
    return `conic-gradient(#ef4444 0% ${c}%, #f97316 ${c}% ${c+h}%, #f59e0b ${c+h}% ${c+h+m}%, #3b82f6 ${c+h+m}% 100%)`;
  }
  gaugeGradient(rate: number, hi = 70, mid = 40): string {
    const c = rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
    return `conic-gradient(${c} 0% ${rate}%, #e5e7eb ${rate}% 100%)`;
  }
  gaugeColor(rate: number, hi = 70, mid = 40): string {
    return rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
  }

  get if_() { return this.inspectionForm.controls; }
  get df()  { return this.defectForm.controls; }
  get rf()  { return this.resolveForm.controls; }
  get rtf() { return this.resultForm.controls; }

  // ── INSPECTIONS ───────────────────────────────────────
  loadInspections(): void {
    this.inspectionsLoading = true; this.inspectionsError = '';
    this.qualitySvc.getAllInspections()
      .pipe(timeout(10000), finalize(() => { this.inspectionsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.inspections = res?.data ?? []; this.applyInspFilters(); this.cdr.detectChanges(); }, error: () => { this.inspectionsError = 'Failed to load inspections.'; } });
  }

  createInspection(): void {
    if (this.inspectionForm.invalid) { this.inspectionForm.markAllAsTouched(); return; }
    this.inspectionLoading = true;
    const v = this.inspectionForm.value;
    this.qualitySvc.createInspection({
      workOrderID: +v.workOrderID,
      inspectionDate: new Date(v.inspectionDate).toISOString(),
      inspectorID: this.auth.getRole() ?? 'Inspector',
      inspectorName: this.userName,
      notes: v.notes || undefined
    }).subscribe({
      next: res => {
        this.inspectionLoading = false; this.showInspectionModal = false; this.inspectionForm.reset();
        this.showToast('Inspection created.');
        if (res?.data) { this.inspections = [res.data, ...this.inspections]; this.cdr.detectChanges(); }
      },
      error: err => { this.inspectionLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  openUpdateResult(insp: InspectionViewModel): void {
    this.selectedInspectionForResult = insp;
    this.resultForm.reset({ status: 'Completed' });
    this.resultForm.get('result')!.valueChanges.subscribe(val => {
      if (val === 'Pass') this.resultForm.patchValue({ status: 'Completed' }, { emitEvent: false });
      else if (val === 'Fail') this.resultForm.patchValue({ status: 'InProgress' }, { emitEvent: false });
    });
    this.showResultModal = true;
  }

  submitResult(): void {
    if (this.resultForm.invalid) { this.resultForm.markAllAsTouched(); return; }
    this.resultLoading = true;
    const v = this.resultForm.value;
    this.qualitySvc.updateInspectionResult(this.selectedInspectionForResult!.inspectionID, v.result, v.status, v.notes || undefined)
      .subscribe({
        next: res => {
          this.resultLoading = false; this.showResultModal = false;
          this.showToast(`Inspection marked as ${v.result}.`);
          if (res?.data) { const idx = this.inspections.findIndex(i => i.inspectionID === this.selectedInspectionForResult!.inspectionID); if (idx >= 0) { this.inspections[idx] = res.data; this.inspections = [...this.inspections]; } this.cdr.detectChanges(); }
        },
        error: err => { this.resultLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  isExpanded(id: number): boolean { return this.expandedInspections.has(id); }
  toggleInspection(id: number): void {
    if (this.expandedInspections.has(id)) this.expandedInspections.delete(id);
    else { this.expandedInspections.add(id); if (!this.defectsByInspection[id]) this.loadDefectsForInspection(id); }
  }

  loadDefectsForInspection(id: number): void {
    this.qualitySvc.getDefectsByInspection(id).subscribe({
      next: res => { this.defectsByInspection = { ...this.defectsByInspection, [id]: res?.data ?? [] }; this.cdr.detectChanges(); },
      error: () => {}
    });
  }

  inspStatusBadge(s: string): string {
    const m: Record<string,string> = { Scheduled:'b-draft', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  inspResultBadge(r: string): string {
    if (r === 'Pass') return 'b-active';
    if (r === 'Fail') return 'b-admin';
    return 'b-draft';
  }

  // ── DEFECTS ───────────────────────────────────────────
  loadDefects(): void {
    this.defectsLoading = true;
    this.qualitySvc.getAllDefects()
      .pipe(timeout(10000), finalize(() => { this.defectsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.defects = res?.data ?? []; this.applyDefectFilters(); this.cdr.detectChanges(); }, error: () => {} });
  }

  openLogDefect(insp: InspectionViewModel): void {
    this.selectedInspectionForDefect = insp;
    this.defectForm.reset();
    this.showDefectModal = true;
  }

  createDefect(): void {
    if (this.defectForm.invalid) { this.defectForm.markAllAsTouched(); return; }
    this.defectLoading = true;
    const v = this.defectForm.value;
    this.qualitySvc.createDefect({ inspectionID: this.selectedInspectionForDefect!.inspectionID, description: v.description, severity: v.severity })
      .subscribe({
        next: res => {
          this.defectLoading = false; this.showDefectModal = false; this.defectForm.reset();
          this.showToast('Defect logged.');
          if (res?.data) {
            this.defects = [res.data, ...this.defects];
            const id = this.selectedInspectionForDefect!.inspectionID;
            this.defectsByInspection = { ...this.defectsByInspection, [id]: [res.data, ...(this.defectsByInspection[id] ?? [])] };
            this.cdr.detectChanges();
          }
        },
        error: err => { this.defectLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  openResolve(d: DefectViewModel): void { this.selectedDefectForResolve = d; this.resolveForm.reset(); this.showResolveModal = true; }

  submitResolve(): void {
    if (this.resolveForm.invalid) { this.resolveForm.markAllAsTouched(); return; }
    this.resolveLoading = true;
    const v = this.resolveForm.value;
    this.qualitySvc.resolveDefect(this.selectedDefectForResolve!.defectID, v.resolutionDescription)
      .subscribe({
        next: res => {
          this.resolveLoading = false; this.showResolveModal = false;
          this.showToast('Defect resolved.');
          if (res?.data) { const idx = this.defects.findIndex(d => d.defectID === this.selectedDefectForResolve!.defectID); if (idx >= 0) { this.defects[idx] = res.data; this.defects = [...this.defects]; } this.cdr.detectChanges(); }
        },
        error: err => { this.resolveLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  updateDefectStatus(defect: DefectViewModel, status: string): void {
    this.qualitySvc.updateDefectStatus(defect.defectID, status).subscribe({
      next: () => { defect.status = status; this.showToast('Defect status updated.'); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  defectSeverityBadge(s: string): string {
    const m: Record<string,string> = { Critical:'b-admin', High:'b-inspector', Medium:'b-draft', Low:'b-planner' };
    return m[s] ?? 'b-draft';
  }

  defectStatusBadge(s: string): string {
    const m: Record<string,string> = { Open:'b-admin', InReview:'b-inspector', Resolved:'b-planner', Closed:'b-active' };
    return m[s] ?? 'b-draft';
  }

  get openDefectsCount(): number { return this.defects.filter(d => d.status === 'Open').length; }
  get criticalDefectsCount(): number { return this.defects.filter(d => d.severity === 'Critical' && d.status === 'Open').length; }

  // ── VIEW-ONLY: Work Orders ────────────────────────────
  loadWorkOrders(): void {
    this.workOrdersLoading = true;
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.workOrders = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

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

  // Only completed WOs are eligible for quality inspection
  get completedWorkOrders() { return this.workOrders.filter(wo => wo.status === 'Completed'); }

  // ── FILTERS ───────────────────────────────────────────
  inspFilterResult = '';
  inspFilterStatus = '';
  filteredInspections: InspectionViewModel[] = [];

  defectFilterSeverity = '';
  defectFilterStatus = '';
  filteredDefects: DefectViewModel[] = [];

  applyInspFilters(): void {
    this.filteredInspections = this.inspections.filter(i =>
      (!this.inspFilterResult || i.result === this.inspFilterResult) &&
      (!this.inspFilterStatus || i.status === this.inspFilterStatus)
    );
    this.cdr.detectChanges();
  }

  applyDefectFilters(): void {
    this.filteredDefects = this.defects.filter(d =>
      (!this.defectFilterSeverity || d.severity === this.defectFilterSeverity) &&
      (!this.defectFilterStatus  || d.status   === this.defectFilterStatus)
    );
    this.cdr.detectChanges();
  }

  woStatusBadge(s: string): string { const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' }; return m[s] ?? 'b-draft'; }
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
  logout(): void { this.auth.logout(); this.router.navigate(['/login']); }

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
