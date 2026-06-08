using InventoryService.DTOs;
using InventoryService.Services.Interfaces;
using ManuTrack.SharedKernel.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace InventoryService.Controllers;

[ApiController]
[Route("api/v1/inventory")]
[Authorize]
public class InventoryController(IInventoryService service) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<IEnumerable<InventoryItemViewModel>>>> GetAll(
        [FromQuery] string? status, [FromQuery] int? locationId)
    {
        return Ok(await service.GetAllAsync(status, locationId));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<InventoryItemViewModel>>> GetById(int id)
    {
        var result = await service.GetByIdAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpGet("low-stock")]
    public async Task<ActionResult<ApiResponse<IEnumerable<InventoryItemViewModel>>>> GetLowStock()
    {
        return Ok(await service.GetLowStockAsync());
    }

    [HttpGet("{id:int}/movements")]
    public async Task<ActionResult<ApiResponse<IEnumerable<StockMovementViewModel>>>> GetMovements(int id)
    {
        var result = await service.GetMovementsAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPost]
    [Authorize(Roles = "Admin,InventoryManager,Planner")]
    public async Task<ActionResult<ApiResponse<InventoryItemViewModel>>> Create([FromBody] CreateInventoryItemRequest request)
    {
        var result = await service.CreateAsync(request);
        if (!result.Success) return BadRequest(result);
        return CreatedAtAction(nameof(GetById), new { id = result.Data!.InventoryID }, result);
    }

    [HttpPut("{id:int}")]
    [Authorize(Roles = "Admin,InventoryManager")]
    public async Task<ActionResult<ApiResponse<InventoryItemViewModel>>> Update(int id, [FromBody] UpdateInventoryItemRequest request)
    {
        var result = await service.UpdateAsync(id, request);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }

    [HttpPut("{id:int}/adjust")]
    [Authorize(Roles = "Admin,InventoryManager,Operator")]
    public async Task<ActionResult<ApiResponse<InventoryItemViewModel>>> AdjustQuantity(int id, [FromBody] AdjustQuantityRequest request)
    {
        var result = await service.AdjustQuantityAsync(id, request);
        if (!result.Success) return BadRequest(result);
        return Ok(result);
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse>> Delete(int id)
    {
        var result = await service.DeleteAsync(id);
        if (!result.Success) return NotFound(result);
        return Ok(result);
    }
}
