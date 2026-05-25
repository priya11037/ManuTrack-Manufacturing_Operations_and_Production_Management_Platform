using ComplianceService.DTOs;
using ManuTrack.SharedKernel.Responses;

namespace ComplianceService.Services.Interfaces;

public interface IAuditService
{
    Task<ApiResponse<PagedAuditViewModel>> GetAllAsync(
        string? userId,
        string? serviceName,
        DateTime? from,
        DateTime? to,
        string? entityType,
        string? action,
        string? entityId,
        int page,
        int pageSize);

    Task<ApiResponse<AuditEntryViewModel>> GetByIdAsync(int id);
    Task<ApiResponse<AuditEntryViewModel>> LogAsync(LogAuditEntryRequest request);
}
