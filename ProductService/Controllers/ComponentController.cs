using ManuTrack.SharedKernel.Helpers;
using ManuTrack.SharedKernel.Responses;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ProductService.DTOs;
using ProductService.Models;
using ProductService.Repositories;
using ProductService.Repositories.Interfaces;
using System.Net.Http.Json;

namespace ProductService.Controllers;

[ApiController]
[Route("api/v1/components")]
[Authorize]
public class ComponentController(
    IComponentRepository repo,
    IBomRepository bomRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<ComponentController> logger) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ApiResponse<IEnumerable<ComponentViewModel>>>> GetAll(
        [FromQuery] string? materialType)
    {
        var items = await repo.GetAllAsync(materialType);
        var result = items.Select(Map);
        return Ok(ApiResponse<IEnumerable<ComponentViewModel>>.Ok(result));
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<ApiResponse<ComponentViewModel>>> GetById(int id)
    {
        var c = await repo.GetByIdAsync(id);
        if (c == null)
            return NotFound(ApiResponse<ComponentViewModel>.Fail($"Component {id} not found."));
        return Ok(ApiResponse<ComponentViewModel>.Ok(Map(c)));
    }

    [HttpPost]
    [Authorize(Roles = "Admin,Planner")]
    public async Task<ActionResult<ApiResponse<ComponentViewModel>>> Create([FromBody] CreateComponentRequest req)
    {
        if (await repo.ExistsByNameAsync(req.Name.Trim()))
            return Conflict(ApiResponse<ComponentViewModel>.Fail(
                $"A material named '{req.Name.Trim()}' already exists. Please use a different name."));

        var component = new Component
        {
            Name = req.Name.Trim(),
            MaterialType = req.MaterialType,
            Unit = req.Unit,
            Description = req.Description?.Trim(),
            IsActive = true,
        };
        var created = await repo.CreateAsync(component);

        // Auto-create an InventoryItem in InventoryService with 0 qty so it shows up in Stock Inventory
        try
        {
            var inventoryClient = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "InventoryService");
            var inventoryPayload = new
            {
                ItemType      = "RawMaterial",
                ComponentID   = created.ComponentID,
                ProductName   = created.Name,
                QuantityOnHand  = 0,
                MinimumQuantity = 0,
                Notes         = $"Auto-created when component '{created.Name}' was registered."
            };
            var response = await inventoryClient.PostAsJsonAsync("api/v1/inventory", inventoryPayload);
            if (!response.IsSuccessStatusCode)
                logger.LogWarning("InventoryService returned {Status} when auto-creating inventory item for component {Id}.",
                    response.StatusCode, created.ComponentID);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to auto-create inventory item for component {Id}.", created.ComponentID);
        }

        return CreatedAtAction(nameof(GetById), new { id = created.ComponentID },
            ApiResponse<ComponentViewModel>.Ok(Map(created), "Component registered successfully."));
    }

    [HttpPut("{id:int}/deactivate")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<ComponentViewModel>>> Deactivate(int id)
    {
        var c = await repo.GetByIdAsync(id);
        if (c == null)
            return NotFound(ApiResponse<ComponentViewModel>.Fail($"Component {id} not found."));
        c.IsActive = false;
        await repo.UpdateAsync(c);
        return Ok(ApiResponse<ComponentViewModel>.Ok(Map(c), "Component deactivated."));
    }

    [HttpPut("{id:int}/activate")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse<ComponentViewModel>>> Activate(int id)
    {
        var c = await repo.GetByIdAsync(id);
        if (c == null)
            return NotFound(ApiResponse<ComponentViewModel>.Fail($"Component {id} not found."));
        c.IsActive = true;
        await repo.UpdateAsync(c);
        return Ok(ApiResponse<ComponentViewModel>.Ok(Map(c), "Component activated."));
    }

    [HttpDelete("{id:int}")]
    [Authorize(Roles = "Admin")]
    public async Task<ActionResult<ApiResponse>> Delete(int id)
    {
        var c = await repo.GetByIdAsync(id);
        if (c == null)
            return NotFound(ApiResponse.Fail($"Component {id} not found."));

        if (await bomRepo.HasBomsForComponentAsync(id))
            return BadRequest(ApiResponse.Fail(
                $"Cannot delete '{c.Name}' — it is used in one or more BOM entries. Remove those BOM entries first."));

        await repo.DeleteAsync(c);
        return Ok(ApiResponse.Ok("Component deleted."));
    }

    private static ComponentViewModel Map(Component c) => new()
    {
        ComponentID = c.ComponentID,
        Name = c.Name,
        MaterialType = c.MaterialType,
        Unit = c.Unit,
        Description = c.Description,
        IsActive = c.IsActive,
    };
}
