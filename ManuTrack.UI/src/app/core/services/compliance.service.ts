import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from './product.service';
import { AuditEntryViewModel, PagedAuditViewModel } from './audit.service';

export interface ComplianceReportViewModel {
  reportID: number;
  title: string;
  scope: string;
  reportType: string;
  metrics: string;
  status: string;
  generatedBy: string;
  generatedDate: string;
  periodStart?: string;
  periodEnd?: string;
  approvedBy?: string;
  approvedDate?: string;
  createdDate: string;
}

export interface CreateComplianceReportRequest {
  title: string;
  scope: string;
  reportType: string;
  periodStart?: string;
  periodEnd?: string;
  metrics?: string;
}

@Injectable({ providedIn: 'root' })
export class ComplianceService {
  private readonly compBase  = 'http://localhost:5000/api/v1/compliance';
  private readonly auditBase = 'http://localhost:5000/api/v1/audit-logs';

  constructor(private http: HttpClient) {}

  // Compliance Reports
  getAllReports(status?: string, reportType?: string): Observable<ApiResponse<ComplianceReportViewModel[]>> {
    let url = this.compBase;
    const params: string[] = [];
    if (status) params.push(`status=${status}`);
    if (reportType) params.push(`reportType=${reportType}`);
    if (params.length) url += '?' + params.join('&');
    return this.http.get<ApiResponse<ComplianceReportViewModel[]>>(url);
  }

  createReport(req: CreateComplianceReportRequest): Observable<ApiResponse<ComplianceReportViewModel>> {
    return this.http.post<ApiResponse<ComplianceReportViewModel>>(this.compBase, req);
  }

  updateStatus(id: number, status: string): Observable<ApiResponse<ComplianceReportViewModel>> {
    return this.http.put<ApiResponse<ComplianceReportViewModel>>(`${this.compBase}/${id}/status`, { status });
  }

  approveReport(id: number, approvedBy: string): Observable<ApiResponse<ComplianceReportViewModel>> {
    return this.http.put<ApiResponse<ComplianceReportViewModel>>(`${this.compBase}/${id}/approve`, { approvedBy });
  }

  deleteReport(id: number): Observable<ApiResponse<boolean>> {
    return this.http.delete<ApiResponse<boolean>>(`${this.compBase}/${id}`);
  }

  // Audit Logs
  getAuditLogs(page = 1, pageSize = 20, serviceName?: string, action?: string, from?: string, to?: string): Observable<ApiResponse<PagedAuditViewModel>> {
    let url = `${this.auditBase}?page=${page}&pageSize=${pageSize}`;
    if (serviceName) url += `&serviceName=${serviceName}`;
    if (action) url += `&action=${action}`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
    return this.http.get<ApiResponse<PagedAuditViewModel>>(url);
  }
}
