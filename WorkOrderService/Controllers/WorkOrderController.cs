using ManuTrack.SharedKernel.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using WorkOrderService.DTOs;
using WorkOrderService.Services.Interfaces;

namespace WorkOrderService.Controllers;

[ApiController]
[Route("api/v1/workorders")]
[Authorize]
public class WorkOrderController(IWorkOrderService service) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<IEnumerable<WorkOrderViewModel>>>> GetAll(
        [FromQuery] string? status,
        [FromQuery] int? productId)
    {
        var result = await service.GetAllAsync(status, productId);
        return Ok(result);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<WorkOrderViewModel>>> GetById(int id)
    {
        var result = await service.GetByIdAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Planner")]
    public async Task<ActionResult<ApiResponse<WorkOrderViewModel>>> Create([FromBody] CreateWorkOrderRequest request)
    {
        var result = await service.CreateAsync(request);
        if (!result.Success) return BadRequest(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.WorkOrderID }, result);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,Planner")]
    public async Task<ActionResult<ApiResponse<WorkOrderViewModel>>> Update(int id, [FromBody] UpdateWorkOrderRequest request)
    {
        var result = await service.UpdateAsync(id, request);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPut("{id:int}/status")]
    [Authorize(Roles = "Admin,Planner,Operator")]
    public async Task<ActionResult<ApiResponse<WorkOrderViewModel>>> UpdateStatus(int id, [FromBody] UpdateWorkOrderStatusRequest request)
    {
        var result = await service.UpdateStatusAsync(id, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin,Planner")]
    public async Task<ActionResult<ApiResponse>> Delete(int id)
    {
        var result = await service.DeleteAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }
}
