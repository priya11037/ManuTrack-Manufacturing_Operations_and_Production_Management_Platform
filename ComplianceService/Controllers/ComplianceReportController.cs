using ComplianceService.DTOs;
using ComplianceService.Services.Interfaces;
using ManuTrack.SharedKernel.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace ComplianceService.Controllers;

[ApiController]
[Route("api/v1/compliance")]
[Authorize]
public class ComplianceReportController(IComplianceReportService service) : ControllerBase
{
    [HttpGet]
    [Authorize(Roles = "Admin,ComplianceOfficer")]
    public async Task<ActionResult<ApiResponse<IEnumerable<ComplianceReportViewModel>>>> GetAll(
        [FromQuery] string? status, [FromQuery] string? reportType)
    {
        return Ok(await service.GetAllAsync(status, reportType));
    }

    [HttpGet("{id:int}")]
    [Authorize(Roles = "Admin,ComplianceOfficer")]
    public async Task<ActionResult<ApiResponse<ComplianceReportViewModel>>> GetById(int id)
    {
        var result = await service.GetByIdAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPost]
    [Authorize(Roles = "Admin,ComplianceOfficer")]
    public async Task<ActionResult<ApiResponse<ComplianceReportViewModel>>> Create(
        [FromBody] CreateComplianceReportRequest request)
    {
        var result = await service.CreateAsync(request);
        if (!result.Success) return BadRequest(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.ReportID }, result);
    }

    [HttpPut("{id:int}/status")]
    [Authorize(Roles = "Admin,ComplianceOfficer")]
    public async Task<ActionResult<ApiResponse<ComplianceReportViewModel>>> UpdateStatus(
        int id, [FromBody] UpdateReportStatusRequest request)
    {
        var result = await service.UpdateStatusAsync(id, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpPut("{id:int}/approve")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Approve(int id, [FromBody] ApproveReportRequest request)
    {
        var result = await service.ApproveReportAsync(id, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,ComplianceOfficer")]
    public async Task<IActionResult> Delete(int id)
    {
        var result = await service.DeleteAsync(id);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }
}
