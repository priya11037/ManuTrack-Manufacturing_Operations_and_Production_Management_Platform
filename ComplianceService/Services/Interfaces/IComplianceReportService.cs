using ComplianceService.DTOs;
using ManuTrack.SharedKernel.Responses;

namespace ComplianceService.Services.Interfaces;

public interface IComplianceReportService
{
    Task<ApiResponse<IEnumerable<ComplianceReportViewModel>>> GetAllAsync(string? status, string? reportType);
    Task<ApiResponse<ComplianceReportViewModel>> GetByIdAsync(int id);
    // generatedBy extracted from JWT internally — no longer a parameter
    Task<ApiResponse<ComplianceReportViewModel>> CreateAsync(CreateComplianceReportRequest request);
    Task<ApiResponse<ComplianceReportViewModel>> UpdateStatusAsync(int id, UpdateReportStatusRequest request);
    Task<ApiResponse<ComplianceReportViewModel>> ApproveReportAsync(int id, ApproveReportRequest request);
    Task<ApiResponse<bool>> DeleteAsync(int id);
}
