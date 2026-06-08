import { Component, OnInit, AfterViewInit, OnDestroy, ChangeDetectorRef, ViewChild, ElementRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { finalize, timeout } from 'rxjs/operators';
import {
  Chart, ChartConfiguration,
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale,
  DoughnutController, BarController, LineController,
  Tooltip, Legend, Filler
} from 'chart.js';

Chart.register(
  ArcElement, BarElement, LineElement, PointElement,
  CategoryScale, LinearScale,
  DoughnutController, BarController, LineController,
  Tooltip, Legend, Filler
);
import { AuthService } from '../../core/services/auth.service';
import { WorkOrderService, WorkOrderViewModel } from '../../core/services/workorder.service';
import { QualityService, InspectionViewModel, DefectViewModel } from '../../core/services/quality.service';
import { ComplianceService, ComplianceReportViewModel } from '../../core/services/compliance.service';
import { AnalyticsService, DashboardSummaryViewModel, KpiReportViewModel } from '../../core/services/analytics.service';
import { AuditEntryViewModel } from '../../core/services/audit.service';
import { NotificationViewModel } from '../../core/services/notification.service';
import { ProductService, ProductViewModel } from '../../core/services/product.service';
import { BomService, BomViewModel } from '../../core/services/bom.service';

type Section = 'overview' | 'reports' | 'audit' | 'quality' | 'workorders' | 'products' | 'analytics' | 'notifications';

@Component({
  selector: 'app-compliance-officer',
  standalone: false,
  templateUrl: './compliance-officer.component.html',
  styleUrl: './compliance-officer.component.css'
})
export class ComplianceOfficerComponent implements OnInit, AfterViewInit, OnDestroy {

  // ── Chart canvas refs ─────────────────────────────────
  @ViewChild('woStatusChart')    woStatusCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('inspResultChart')  inspResultCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('defectSevChart')   defectSevCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('invStatusChart')   invStatusCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('kpiTrendChart')    kpiTrendCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('defectTrendChart') defectTrendCanvasRef!: ElementRef<HTMLCanvasElement>;

  private charts: Chart[] = [];
  chartsReady = false;
  activeSection: Section = 'overview';
  userName: string;
  userInitials: string;

  reports: ComplianceReportViewModel[] = [];
  auditLogs: AuditEntryViewModel[] = [];
  auditTotal = 0; auditPage = 1;
  inspections: InspectionViewModel[] = [];
  defects: DefectViewModel[] = [];
  workOrders: WorkOrderViewModel[] = [];
  products: ProductViewModel[] = [];
  bomByProduct: Record<number, BomViewModel[]> = {};
  expandedBomProducts = new Set<number>();
  analytics: DashboardSummaryViewModel | null = null;
  kpiReports: KpiReportViewModel[] = [];
  notifications: NotificationViewModel[] = [];
  unreadCount = 0;

  reportsLoading = false; auditLoading = false;
  qualityLoading = false; workOrdersLoading = false;
  productsLoading = false; analyticsLoading = false;
  notificationsLoading = false;

  auditServiceFilter = '';
  auditActionFilter = '';

  showReportModal = false;
  showApproveModal = false;
  showKpiModal = false;
  selectedReport: ComplianceReportViewModel | null = null;

  reportForm!: FormGroup;
  approveForm!: FormGroup;
  kpiForm!: FormGroup;
  reportLoading = false; approveLoading = false; kpiLoading = false;

  toastMsg = ''; toastType: 'success' | 'error' = 'success';
  errorAlert = '';

  readonly reportTypes = ['Safety', 'Quality', 'Environmental', 'Regulatory', 'Internal', 'External'];
  // KPI-specific report types matching backend enum
  readonly kpiReportTypes = [
    { value: 'YieldRate',        label: 'Yield Rate',         desc: 'Production output vs planned' },
    { value: 'DefectRate',       label: 'Defect Rate',        desc: 'Defects per total inspections' },
    { value: 'OnTimeCompletion', label: 'On-Time Completion', desc: 'Work orders completed on schedule' },
    { value: 'ProductionVolume', label: 'Production Volume',  desc: 'Total units produced per period' },
    { value: 'InventoryTurnover',label: 'Inventory Turnover', desc: 'Stock consumption rate' },
    { value: 'Custom',           label: 'Custom Report',      desc: 'User-defined metrics' },
  ];
  readonly serviceNames = ['AuthService','ProductService','WorkOrderService','InventoryService','QualityService','ComplianceService','AnalyticsService','NotificationService'];

  constructor(
    private auth: AuthService,
    private workOrderSvc: WorkOrderService,
    private qualitySvc: QualityService,
    private complianceSvc: ComplianceService,
    private analyticsSvc: AnalyticsService,
    private productSvc: ProductService,
    private bomSvc: BomService,
    private fb: FormBuilder,
    private router: Router,
    private cdr: ChangeDetectorRef,
    private http: HttpClient
  ) {
    this.userName = this.auth.getName() ?? 'Compliance Officer';
    this.userInitials = this.userName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    this.reportForm = this.fb.group({
      title: ['', [Validators.required, Validators.minLength(3)]],
      reportType: ['', Validators.required],
      scope: ['', [Validators.required, Validators.minLength(5)]],
      periodStart: [''],
      periodEnd: ['']
    });

    this.approveForm = this.fb.group({
      approvedBy: [this.userName || '', Validators.required]
    });

    this.kpiForm = this.fb.group({
      title:       ['', [Validators.required, Validators.minLength(3)]],
      reportType:  ['', Validators.required],
      scope:       ['', [Validators.required, Validators.minLength(3)]],
      periodStart: [''],
      periodEnd:   ['']
    });
  }

  ngOnInit(): void {
    this.loadReports();
    this.loadAuditLogs();
    this.loadQuality();
    this.loadWorkOrders();
    this.loadProducts();
    this.loadAnalytics();
    this.loadNotifications();
  }

  ngAfterViewInit(): void { /* charts are built when section becomes active */ }

  ngOnDestroy(): void { this.destroyCharts(); }

  private destroyCharts(): void {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    this.chartsReady = false;
  }

  buildCharts(): void {
    // Defer to next tick so *ngIf has rendered the canvases
    setTimeout(() => {
      this.destroyCharts();

      const wos   = this.workOrders   ?? [];
      const insp  = this.inspections  ?? [];
      const defs  = this.defects      ?? [];
      const inv: any[] = [];

      // ── 1. Work Order Status — Doughnut ───────────────
      if (this.woStatusCanvasRef) {
        const completed  = wos.filter(w => w.status === 'Completed').length;
        const inProgress = wos.filter(w => w.status === 'InProgress').length;
        const pending    = wos.filter(w => w.status === 'Pending').length;
        const cancelled  = wos.filter(w => w.status === 'Cancelled').length;
        this.charts.push(new Chart(this.woStatusCanvasRef.nativeElement, {
          type: 'doughnut',
          data: {
            labels: ['Completed', 'In Progress', 'Pending', 'Cancelled'],
            datasets: [{ data: [completed, inProgress, pending, cancelled],
              backgroundColor: ['#22c55e','#3b82f6','#f59e0b','#ef4444'],
              borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } },
              tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}` } } } }
        }));
      }

      // ── 2. Inspection Results — Bar ───────────────────
      if (this.inspResultCanvasRef) {
        const passed  = insp.filter(i => i.result === 'Pass').length;
        const failed  = insp.filter(i => i.result === 'Fail').length;
        const pending = insp.filter(i => !i.result || i.result === 'Pending').length;
        this.charts.push(new Chart(this.inspResultCanvasRef.nativeElement, {
          type: 'bar',
          data: {
            labels: ['Pass', 'Fail', 'Pending'],
            datasets: [{ label: 'Inspections', data: [passed, failed, pending],
              backgroundColor: ['#22c55e','#ef4444','#f59e0b'],
              borderRadius: 6, borderSkipped: false }]
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false },
              tooltip: { callbacks: { label: ctx => ` Count: ${ctx.raw}` } } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f0f0' } },
              x: { grid: { display: false } } } }
        }));
      }

      // ── 3. Defect Severity — Doughnut ─────────────────
      if (this.defectSevCanvasRef) {
        const critical = defs.filter(d => d.severity === 'Critical').length;
        const high     = defs.filter(d => d.severity === 'High').length;
        const medium   = defs.filter(d => d.severity === 'Medium').length;
        const low      = defs.filter(d => d.severity === 'Low').length;
        this.charts.push(new Chart(this.defectSevCanvasRef.nativeElement, {
          type: 'doughnut',
          data: {
            labels: ['Critical', 'High', 'Medium', 'Low'],
            datasets: [{ data: [critical, high, medium, low],
              backgroundColor: ['#ef4444','#f97316','#f59e0b','#3b82f6'],
              borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
          },
          options: { responsive: true, maintainAspectRatio: false, cutout: '68%',
            plugins: { legend: { position: 'bottom', labels: { padding: 12, font: { size: 12 } } } } }
        }));
      }

      // ── 4. Inventory Status — Horizontal Bar ──────────
      if (this.invStatusCanvasRef) {
        const ok       = inv.filter(i => i.status === 'InStock').length;
        const lowStock = inv.filter(i => i.status === 'LowStock').length;
        const outOf    = inv.filter(i => i.status === 'OutOfStock').length;
        this.charts.push(new Chart(this.invStatusCanvasRef.nativeElement, {
          type: 'bar',
          data: {
            labels: ['In Stock', 'Low Stock', 'Out of Stock'],
            datasets: [{ label: 'Items', data: [ok, lowStock, outOf],
              backgroundColor: ['#22c55e','#f59e0b','#ef4444'],
              borderRadius: 6, borderSkipped: false }]
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f0f0' } },
              y: { grid: { display: false } } } }
        }));
      }

      // ── 5. KPI Report Types — Horizontal Bar ─────────
      if (this.kpiTrendCanvasRef) {
        const typeCounts: Record<string,number> = {};
        const kpiLabels = ['YieldRate','DefectRate','OnTimeCompletion','ProductionVolume','InventoryTurnover','Custom'];
        kpiLabels.forEach(t => { typeCounts[t] = this.kpiReports.filter(r => r.reportType === t).length; });
        this.charts.push(new Chart(this.kpiTrendCanvasRef.nativeElement, {
          type: 'bar',
          data: {
            labels: ['Yield Rate','Defect Rate','On-Time','Production Vol','Inv. Turnover','Custom'],
            datasets: [{ label: 'Reports Generated', data: kpiLabels.map(t => typeCounts[t]),
              backgroundColor: ['#22c55e','#ef4444','#3b82f6','#a855f7','#f59e0b','#6b7280'],
              borderRadius: 6, borderSkipped: false }]
          },
          options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f0f0' } },
              y: { grid: { display: false }, ticks: { font: { size: 11 } } } } }
        }));
      }

      // ── 6. Defect Status Trend — Stacked Bar ─────────
      if (this.defectTrendCanvasRef) {
        const open     = defs.filter(d => d.status === 'Open').length;
        const inProg   = defs.filter(d => d.status === 'InProgress').length;
        const resolved = defs.filter(d => d.status === 'Resolved').length;
        const closed   = defs.filter(d => d.status === 'Closed').length;
        this.charts.push(new Chart(this.defectTrendCanvasRef.nativeElement, {
          type: 'bar',
          data: {
            labels: ['Defects by Status'],
            datasets: [
              { label: 'Open',       data: [open],     backgroundColor: '#ef4444', borderRadius: 4 },
              { label: 'In Progress',data: [inProg],   backgroundColor: '#f59e0b', borderRadius: 4 },
              { label: 'Resolved',   data: [resolved], backgroundColor: '#22c55e', borderRadius: 4 },
              { label: 'Closed',     data: [closed],   backgroundColor: '#6b7280', borderRadius: 4 },
            ]
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { padding: 10, font: { size: 12 } } } },
            scales: { x: { stacked: true, grid: { display: false } },
              y: { stacked: true, beginAtZero: true, ticks: { stepSize: 1 }, grid: { color: '#f0f0f0' } } } }
        }));
      }

      this.chartsReady = true;
      this.cdr.detectChanges();
    }, 80);
  }

  get sectionTitle(): string {
    const m: Record<Section,string> = { overview:'Overview', reports:'Compliance Reports', audit:'Audit Logs', quality:'Quality View', workorders:'Work Orders', products:'Products & BOM', analytics:'Analytics', notifications:'Notifications' };
    return m[this.activeSection];
  }
  showSection(s: Section): void {
    this.activeSection = s;
    if (s === 'analytics') { this.buildCharts(); }
  }

  // ── Products & BOMs (read-only) ───────────────────────
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

  get rf() { return this.reportForm.controls; }
  get af() { return this.approveForm.controls; }
  get kf() { return this.kpiForm.controls; }

  getKpiTypeDesc(value: string): string {
    return this.kpiReportTypes.find(t => t.value === value)?.desc ?? '';
  }

  // ── Analytics computed stats ─────────────────────────
  kpiSearchTerm = '';
  get filteredKpiReports() {
    const t = this.kpiSearchTerm.toLowerCase();
    return t ? this.kpiReports.filter(r => r.title.toLowerCase().includes(t) || r.reportType.toLowerCase().includes(t)) : this.kpiReports;
  }
  get completedWOCount(): number { return this.workOrders.filter(w => w.status === 'Completed').length; }
  get inProgressWOCount(): number { return this.workOrders.filter(w => w.status === 'InProgress').length; }
  get pendingWOCount(): number { return this.workOrders.filter(w => w.status === 'Pending').length; }
  get cancelledWOCount(): number { return this.workOrders.filter(w => w.status === 'Cancelled').length; }
  get woCompletionRate(): number { return this.workOrders.length ? Math.round((this.completedWOCount / this.workOrders.length) * 100) : 0; }
  get inspYieldRate(): number { return this.inspections.length ? Math.round((this.inspections.filter(i => i.result === 'Pass').length / this.inspections.length) * 100) : 0; }
  get criticalDefCount(): number { return this.defects.filter(d => d.severity === 'Critical').length; }
  get highDefCount(): number { return this.defects.filter(d => d.severity === 'High').length; }
  get mediumDefCount(): number { return this.defects.filter(d => d.severity === 'Medium').length; }
  get lowDefCount(): number { return this.defects.filter(d => d.severity === 'Low').length; }
  get maxDefSev(): number { return Math.max(this.criticalDefCount, this.highDefCount, this.mediumDefCount, this.lowDefCount, 1); }
  woFunnelPct(status: string): number {
    const count = this.workOrders.filter(w => w.status === status).length;
    return this.workOrders.length ? Math.round((count / this.workOrders.length) * 100) : 0;
  }
  gaugeGradient(rate: number, hi = 60, mid = 30): string {
    const c = rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
    return `conic-gradient(${c} 0% ${rate}%, #e5e7eb ${rate}% 100%)`;
  }
  gaugeColor(rate: number, hi = 60, mid = 30): string {
    return rate > hi ? '#22c55e' : rate > mid ? '#f59e0b' : '#ef4444';
  }
  woCountByStatus(status: string): number { return this.workOrders.filter(w => w.status === status).length; }
  inspFailedCount(): number { return this.inspections.filter(i => i.result === 'Fail').length; }
  inspFailedPct(): number { return this.inspections.length ? Math.round(this.inspFailedCount() / this.inspections.length * 100) : 0; }
  inspDonutGradient(): string {
    if (!this.inspections.length) return 'conic-gradient(#e5e7eb 0% 100%)';
    const pass = this.inspYieldRate;
    const fail = this.inspFailedPct();
    return `conic-gradient(#22c55e 0% ${pass}%, #ef4444 ${pass}% ${pass + fail}%, #e5e7eb ${pass + fail}% 100%)`;
  }
  woDonutGradient(): string {
    const c = this.woCompletionRate;
    const ip = this.woFunnelPct('InProgress');
    const p = this.woFunnelPct('Pending');
    return `conic-gradient(#22c55e 0% ${c}%, #3b82f6 ${c}% ${c+ip}%, #f59e0b ${c+ip}% ${c+ip+p}%, #ef4444 ${c+ip+p}% 100%)`;
  }
  reportCountByType(type: string): number { return this.reports.filter(r => r.reportType === type).length; }
  reportTypeMax(): number { return Math.max(...['Safety','Quality','Environmental','Regulatory','Internal','External'].map(t => this.reportCountByType(t)), 1); }

  parseKpiMetricsFlat(json: string): { key: string; val: string }[] {
    if (!json) return [];
    try {
      const obj = JSON.parse(json);
      return Object.entries(obj).slice(0, 6).map(([k, v]) => ({
        key: k.replace(/([A-Z])/g, ' $1').trim().toUpperCase(),
        val: typeof v === 'number' ? (Number.isInteger(v as number) ? String(v) : (v as number).toFixed(1)) : String(v)
      }));
    } catch { return []; }
  }

  /** Parse the metrics JSON string into an array of {key, value} pairs */
  parseMetrics(metricsJson: string): { key: string; val: string }[] {
    if (!metricsJson) return [];
    try {
      const obj = JSON.parse(metricsJson);
      return Object.entries(obj).map(([k, v]) => ({
        key: k.replace(/([A-Z])/g, ' $1').trim(),   // camelCase → words
        val: typeof v === 'number' ? (Number.isInteger(v) ? String(v) : (v as number).toFixed(2)) : String(v)
      }));
    } catch { return []; }
  }

  /** Returns the headline metric chip for a KPI report row */
  getPrimaryMetric(r: KpiReportViewModel): { label: string; value: string; color: string } | null {
    const pairs = this.parseMetrics(r.metrics);
    if (!pairs.length) return null;

    const colorMap: Record<string, string> = {
      YieldRate:         '#22c55e',
      DefectRate:        '#ef4444',
      OnTimeCompletion:  '#3b82f6',
      ProductionVolume:  '#a855f7',
      InventoryTurnover: '#f59e0b',
      Custom:            '#6b7280',
    };
    const primaryKeyMap: Record<string, string[]> = {
      YieldRate:         ['YieldRate', 'Yield Rate', 'Yield'],
      DefectRate:        ['DefectRate', 'Defect Rate', 'Defects'],
      OnTimeCompletion:  ['OnTimeRate', 'OnTimeCompletion', 'On Time Rate'],
      ProductionVolume:  ['ProductionVolume', 'Production Volume', 'Volume'],
      InventoryTurnover: ['InventoryTurnover', 'Inventory Turnover', 'Turnover'],
    };

    const wanted = primaryKeyMap[r.reportType] ?? [];
    let primary = pairs.find(p => wanted.some(w => p.key.toLowerCase() === w.toLowerCase()));
    if (!primary) primary = pairs[0];   // fall back to first key

    const unit = primary.key.toLowerCase().includes('rate') || primary.key.toLowerCase().includes('yield') ? '%' : '';

    return {
      label: primary.key,
      value: primary.val + unit,
      color: colorMap[r.reportType] ?? '#6b7280'
    };
  }

  /** All secondary metrics (everything except the primary) */
  getSecondaryMetrics(r: KpiReportViewModel): { key: string; val: string }[] {
    const pairs = this.parseMetrics(r.metrics);
    const primary = this.getPrimaryMetric(r);
    if (!primary || pairs.length <= 1) return [];
    return pairs.filter(p => p.key !== primary.label);
  }

  // â”€â”€ COMPLIANCE REPORTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadReports(): void {
    this.reportsLoading = true;
    this.complianceSvc.getAllReports()
      .pipe(timeout(10000), finalize(() => { this.reportsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.reports = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  createReport(): void {
    if (this.reportForm.invalid) { this.reportForm.markAllAsTouched(); return; }
    this.reportLoading = true;
    const v = this.reportForm.value;
    this.complianceSvc.createReport({
      title: v.title, scope: v.scope, reportType: v.reportType,
      periodStart: v.periodStart ? new Date(v.periodStart).toISOString() : undefined,
      periodEnd: v.periodEnd ? new Date(v.periodEnd).toISOString() : undefined
    }).subscribe({
      next: res => {
        this.reportLoading = false; this.showReportModal = false; this.reportForm.reset();
        this.showToast('Compliance report created.');
        if (res?.data) { this.reports = [res.data, ...this.reports]; this.cdr.detectChanges(); }
      },
      error: err => { this.reportLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
    });
  }

  updateReportStatus(report: ComplianceReportViewModel, status: string): void {
    this.complianceSvc.updateStatus(report.reportID, status).subscribe({
      next: () => { report.status = status; this.showToast(`Report moved to ${status}.`); this.cdr.detectChanges(); },
      error: err => this.showToast(err.error?.message ?? 'Failed.', 'error')
    });
  }

  openApprove(report: ComplianceReportViewModel): void {
    this.selectedReport = report;
    this.approveForm.patchValue({ approvedBy: this.userName });
    this.showApproveModal = true;
  }

  submitApprove(): void {
    if (this.approveForm.invalid) { this.approveForm.markAllAsTouched(); return; }
    this.approveLoading = true;
    this.complianceSvc.approveReport(this.selectedReport!.reportID, this.af['approvedBy'].value)
      .subscribe({
        next: res => {
          this.approveLoading = false; this.showApproveModal = false;
          this.showToast('Report approved.');
          if (res?.data) { const idx = this.reports.findIndex(r => r.reportID === this.selectedReport!.reportID); if (idx >= 0) { this.reports[idx] = res.data; this.reports = [...this.reports]; } this.cdr.detectChanges(); }
        },
        error: err => { this.approveLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
  }

  reportStatusBadge(s: string): string {
    const m: Record<string,string> = { Draft:'b-draft', InReview:'b-planner', Approved:'b-active', Closed:'b-inactive' };
    return m[s] ?? 'b-draft';
  }

  get pendingApprovalCount(): number { return this.reports.filter(r => r.status === 'InReview').length; }

  // â”€â”€ AUDIT LOGS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadAuditLogs(): void {
    this.auditLoading = true;
    this.complianceSvc.getAuditLogs(this.auditPage, 30, this.auditServiceFilter || undefined, this.auditActionFilter || undefined)
      .pipe(timeout(10000), finalize(() => { this.auditLoading = false; this.cdr.detectChanges(); }))
      .subscribe({
        next: res => { this.auditLogs = res?.data?.data ?? []; this.auditTotal = res?.data?.pagination?.totalRecords ?? 0; this.cdr.detectChanges(); },
        error: () => {}
      });
  }

  onAuditFilter(): void { this.auditPage = 1; this.loadAuditLogs(); }

  auditBadgeClass(action: string): string {
    const a = action.toLowerCase();
    if (a.includes('login')) return 'audit-badge-login';
    if (a.includes('create') || a.includes('register') || a.includes('add')) return 'audit-badge-create';
    if (a.includes('update') || a.includes('change') || a.includes('activate') || a.includes('deactivate')) return 'audit-badge-update';
    if (a.includes('delete') || a.includes('remove')) return 'audit-badge-delete';
    return 'audit-badge-default';
  }

  initials(name: string): string {
    if (!name) return '?';
    const parts = name.trim().split(' ').filter(p => p.length > 0);
    return parts.length === 1 ? parts[0][0].toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  // â”€â”€ QUALITY (view only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadQuality(): void {
    this.qualityLoading = true;
    this.qualitySvc.getAllInspections()
      .pipe(timeout(10000), finalize(() => { this.qualityLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.inspections = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
    this.qualitySvc.getAllDefects()
      .pipe(timeout(10000))
      .subscribe({ next: res => { this.defects = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  inspResultBadge(r: string): string { if (r==='Pass') return 'b-active'; if (r==='Fail') return 'b-admin'; return 'b-draft'; }
  inspStatusBadge(s: string): string { const m: Record<string,string> = { Scheduled:'b-draft', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' }; return m[s] ?? 'b-draft'; }
  defectSeverityBadge(s: string): string { const m: Record<string,string> = { Critical:'b-admin', High:'b-inspector', Medium:'b-draft', Low:'b-planner' }; return m[s] ?? 'b-draft'; }
  defectStatusBadge(s: string): string { const m: Record<string,string> = { Open:'b-admin', InReview:'b-inspector', Resolved:'b-planner', Closed:'b-active' }; return m[s] ?? 'b-draft'; }

  get openDefectsCount(): number { return this.defects.filter(d => d.status==='Open').length; }
  get failedInspectionsCount(): number { return this.inspections.filter(i => i.result==='Fail').length; }

  // â”€â”€ VIEW-ONLY SECTIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  loadWorkOrders(): void {
    this.workOrdersLoading = true;
    this.workOrderSvc.getAll()
      .pipe(timeout(10000), finalize(() => { this.workOrdersLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => { this.workOrders = res?.data ?? []; this.cdr.detectChanges(); }, error: () => {} });
  }

  loadAnalytics(): void {
    this.analyticsLoading = true;
    this.analyticsSvc.getDashboard()
      .pipe(timeout(10000), finalize(() => { this.analyticsLoading = false; this.cdr.detectChanges(); }))
      .subscribe({ next: res => {
        this.analytics = res?.data ?? null;
        this.cdr.detectChanges();
        if (this.activeSection === 'analytics') { this.buildCharts(); }
      }, error: () => {} });
    this.analyticsSvc.getReports()
      .pipe(timeout(10000))
      .subscribe({ next: res => {
        this.kpiReports = res?.data ?? [];
        this.cdr.detectChanges();
        if (this.activeSection === 'analytics') { this.buildCharts(); }
      }, error: () => {} });
  }

  /** Compute metrics object based on the selected KPI type using live data */
  private computeMetrics(reportType: string): Record<string, number> {
    const wos          = this.workOrders ?? [];
    const totalWOs     = wos.length;
    const completedWOs = wos.filter(w => w.status === 'Completed').length;
    const inProgressWOs = wos.filter(w => w.status === 'InProgress').length;

    const insp     = this.inspections ?? [];
    const passedInsp = insp.filter(i => i.result === 'Pass').length;
    const failedInsp = insp.filter(i => i.result === 'Fail').length;

    const defs     = this.defects ?? [];
    const openDefs = defs.filter(d => d.status === 'Open').length;

    const inv: any[] = [];
    const lowStock = inv.filter(i => i.status === 'LowStock').length;
    const outOfStock = inv.filter(i => i.status === 'OutOfStock').length;

    switch (reportType) {
      case 'YieldRate':
        return {
          YieldRate:      totalWOs > 0 ? parseFloat(((completedWOs / totalWOs) * 100).toFixed(2)) : 0,
          CompletedWOs:   completedWOs,
          TotalWOs:       totalWOs,
          InProgressWOs:  inProgressWOs,
        };
      case 'DefectRate':
        return {
          DefectRate:     insp.length > 0 ? parseFloat(((defs.length / insp.length) * 100).toFixed(2)) : 0,
          TotalDefects:   defs.length,
          OpenDefects:    openDefs,
          TotalInspections: insp.length,
          PassedInspections: passedInsp,
          FailedInspections: failedInsp,
        };
      case 'OnTimeCompletion':
        // Passed inspections of completed WOs as proxy for on-time quality
        return {
          OnTimeRate:       insp.length > 0 ? parseFloat(((passedInsp / insp.length) * 100).toFixed(2)) : 0,
          PassedInspections: passedInsp,
          TotalInspections: insp.length,
          CompletedWOs:     completedWOs,
          TotalWOs:         totalWOs,
        };
      case 'ProductionVolume':
        return {
          ProductionVolume: completedWOs,
          InProgressWOs:    inProgressWOs,
          TotalWOs:         totalWOs,
        };
      case 'InventoryTurnover':
        return {
          InventoryTurnover: inv.length > 0 ? parseFloat(((inv.length - lowStock - outOfStock) / Math.max(inv.length, 1) * 10).toFixed(2)) : 0,
          TotalItems:        inv.length,
          LowStockItems:     lowStock,
          OutOfStockItems:   outOfStock,
        };
      default: // Custom
        return {
          TotalWorkOrders:   totalWOs,
          CompletedWOs:      completedWOs,
          TotalInspections:  insp.length,
          TotalDefects:      defs.length,
          TotalInventory:    inv.length,
          LowStockItems:     lowStock,
        };
    }
  }

  generateKpiReport(): void {
    if (this.kpiForm.invalid) { this.kpiForm.markAllAsTouched(); return; }
    this.kpiLoading = true;
    const v = this.kpiForm.value;
    const metricsObj = this.computeMetrics(v.reportType);
    this.analyticsSvc.createReport({
      title: v.title, reportType: v.reportType, scope: v.scope,
      generatedBy: this.userName,
      metrics: JSON.stringify(metricsObj),
      periodStart: v.periodStart ? new Date(v.periodStart).toISOString() : undefined,
      periodEnd:   v.periodEnd   ? new Date(v.periodEnd).toISOString()   : undefined
    })
      .subscribe({
        next: res => {
          this.kpiLoading = false; this.showKpiModal = false; this.kpiForm.reset();
          this.showToast('KPI report generated.');
          if (res?.data) { this.kpiReports = [res.data, ...this.kpiReports]; this.cdr.detectChanges(); }
        },
        error: err => { this.kpiLoading = false; this.showToast(err.error?.message ?? 'Failed.', 'error'); }
      });
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

  woStatusBadge(s: string): string { const m: Record<string,string> = { Pending:'b-draft', Scheduled:'b-planner', InProgress:'b-inventory', Completed:'b-active', Cancelled:'b-inactive' }; return m[s] ?? 'b-draft'; }
  invStatusBadge(s: string): string { const m: Record<string,string> = { InStock:'b-active', LowStock:'b-inspector', OutOfStock:'b-admin' }; return m[s] ?? 'b-draft'; }
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
