using ComplianceService.Data;
using ComplianceService.Models;
using ComplianceService.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace ComplianceService.Repositories;

public class ComplianceReportRepository(ComplianceReportDbContext db) : IComplianceReportRepository
{
    public async Task<IEnumerable<ComplianceReport>> GetAllAsync(string? status = null, string? reportType = null)
    {
        var query = db.ComplianceReports.AsQueryable();
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(r => r.Status == status);
        if (!string.IsNullOrWhiteSpace(reportType)) query = query.Where(r => r.ReportType == reportType);
        return await query.OrderByDescending(r => r.GeneratedDate).ToListAsync();
    }

    public async Task<ComplianceReport?> GetByIdAsync(int id) => await db.ComplianceReports.FindAsync(id);

    public async Task<ComplianceReport> CreateAsync(ComplianceReport report)
    {
        db.ComplianceReports.Add(report);
        await db.SaveChangesAsync();
        return report;
    }

    public async Task<ComplianceReport> UpdateAsync(ComplianceReport report)
    {
        db.ComplianceReports.Update(report);
        await db.SaveChangesAsync();
        return report;
    }

    public async Task<bool> ExistsAsync(int id) => await db.ComplianceReports.AnyAsync(r => r.ReportID == id);

    public async Task<bool> DeleteAsync(int id)
    {
        var report = await db.ComplianceReports.FindAsync(id);
        if (report == null) return false;
        db.ComplianceReports.Remove(report);
        await db.SaveChangesAsync();
        return true;
    }
}

