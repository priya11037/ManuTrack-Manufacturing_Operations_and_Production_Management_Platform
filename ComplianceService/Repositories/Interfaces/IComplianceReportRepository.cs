using ComplianceService.Models;

namespace ComplianceService.Repositories.Interfaces;

public interface IComplianceReportRepository
{
    Task<IEnumerable<ComplianceReport>> GetAllAsync(string? status = null, string? reportType = null);
    Task<ComplianceReport?> GetByIdAsync(int id);
    Task<ComplianceReport> CreateAsync(ComplianceReport report);
    Task<ComplianceReport> UpdateAsync(ComplianceReport report);
    Task<bool> ExistsAsync(int id);
    Task<bool> DeleteAsync(int id);
}

