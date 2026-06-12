using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using InventoryService.DTOs;
using InventoryService.Enums;
using InventoryService.Models;
using InventoryService.Repositories.Interfaces;
using InventoryService.Services.Interfaces;
using ManuTrack.SharedKernel.Helpers;
using ManuTrack.SharedKernel.Responses;

namespace InventoryService.Services;

public class InventoryServiceImpl(
    IInventoryRepository repo,
    IStockMovementRepository movementRepo,
    ILocationRepository locationRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<InventoryServiceImpl> logger) : IInventoryService
{
    // ── Change 2: Audit logging (fire-and-forget) ─────────────────────────────
    private async Task LogAuditAsync(string action, string entityType, string entityId, string? details = null)
    {
        try
        {
            var (userId, userName) = ServiceHelper.GetCurrentUser(httpContextAccessor);
            if (userId == 0) return;

            var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "ComplianceService");
            await client.PostAsJsonAsync("api/v1/audit", new
            {
                UserID = userId,
                UserName = userName,
                Action = action,
                EntityType = entityType,
                EntityID = entityId,
                ServiceName = "InventoryService",
                Details = details
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Audit log failed in InventoryService."); }
    }

    // ── RecalculateStatus + low-stock notification ────────────────────────────
    private static string DetermineStatus(decimal qty, decimal minQty)
    {
        if (qty <= 0) return InventoryStatus.OutOfStock;
        if (qty <= minQty) return InventoryStatus.LowStock;
        return InventoryStatus.InStock;
    }

    private async Task RecalculateStatusAsync(InventoryItem item)
    {
        var newStatus = DetermineStatus(item.QuantityOnHand, item.MinimumQuantity);
        var statusChanged = item.Status != newStatus;
        item.Status = newStatus;

        if (statusChanged && (newStatus == InventoryStatus.LowStock || newStatus == InventoryStatus.OutOfStock))
        {
            try
            {
                var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "NotificationService");
                var message = newStatus == InventoryStatus.OutOfStock
                    ? $"ALERT: '{item.ProductName}' (ID: {item.InventoryID}) is OUT OF STOCK."
                    : $"WARNING: '{item.ProductName}' (ID: {item.InventoryID}) is LOW on stock. Current: {item.QuantityOnHand}, Minimum: {item.MinimumQuantity}.";

                await client.PostAsJsonAsync("api/v1/notifications/notify-role", new
                {
                    TargetRole = "InventoryManager",
                    Title = newStatus == InventoryStatus.OutOfStock ? "Out of Stock Alert" : "Low Stock Warning",
                    Message = message,
                    Category = "Inventory",
                    Priority = newStatus == InventoryStatus.OutOfStock ? "High" : "Medium"
                });
            }
            catch (Exception ex) { logger.LogWarning(ex, "Low stock notification failed for item {ItemId}.", item.InventoryID); }
        }
    }

    // ── Change 4: Create stock movement record ─────────────────────────────────
    private async Task RecordMovementAsync(int inventoryId, string movementType, decimal quantity, string reason, string? referenceId = null)
    {
        try
        {
            var (userId, _) = ServiceHelper.GetCurrentUser(httpContextAccessor);
            await movementRepo.CreateAsync(new StockMovement
            {
                InventoryID = inventoryId,
                MovementType = movementType,
                Quantity = quantity,
                Reason = reason,
                ReferenceID = referenceId,
                PerformedBy = userId,
    
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Stock movement record failed for inventory item {InventoryId}.", inventoryId); }
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    public async Task<ApiResponse<IEnumerable<InventoryItemViewModel>>> GetAllAsync(string? status, int? locationId)
    {
        var items = await repo.GetAllAsync(status, locationId);
        return ApiResponse<IEnumerable<InventoryItemViewModel>>.Ok(items.Select(Map));
    }

    public async Task<ApiResponse<InventoryItemViewModel>> GetByIdAsync(int id)
    {
        var item = await repo.GetByIdAsync(id);
        if (item == null)
            return ApiResponse<InventoryItemViewModel>.Fail($"Inventory item {id} not found.");
        return ApiResponse<InventoryItemViewModel>.Ok(Map(item));
    }

    public async Task<ApiResponse<IEnumerable<InventoryItemViewModel>>> GetLowStockAsync()
    {
        var items = await repo.GetLowStockAsync();
        return ApiResponse<IEnumerable<InventoryItemViewModel>>.Ok(items.Select(Map));
    }

    public async Task<ApiResponse<IEnumerable<StockMovementViewModel>>> GetMovementsAsync(int inventoryId)
    {
        if (!await repo.ExistsAsync(inventoryId))
            return ApiResponse<IEnumerable<StockMovementViewModel>>.Fail($"Inventory item {inventoryId} not found.");

        var movements = await movementRepo.GetByInventoryIdAsync(inventoryId);
        return ApiResponse<IEnumerable<StockMovementViewModel>>.Ok(movements.Select(MapMovement));
    }

public async Task<ApiResponse<InventoryItemViewModel>> CreateAsync(CreateInventoryItemRequest request)
    {
        // Validate LocationID if provided
        if (request.LocationID.HasValue)
        {
            var location = await locationRepo.GetByIdAsync(request.LocationID.Value);
            if (location == null)
                return ApiResponse<InventoryItemViewModel>.Fail($"Location {request.LocationID.Value} not found.");
            if (!location.IsActive)
                return ApiResponse<InventoryItemViewModel>.Fail($"Location '{location.Name}' is inactive and cannot be assigned to an inventory item.");
        }

        var item = new InventoryItem
        {
            ItemType = request.ItemType,
            ProductID = request.ItemType == "Product" ? request.ProductID : null,
            ComponentID = request.ItemType == "RawMaterial" ? request.ComponentID : null,
            ProductName = request.ProductName,
            LocationID = request.LocationID,
            QuantityOnHand = request.QuantityOnHand,
            MinimumQuantity = request.MinimumQuantity,
            Notes = request.Notes,

        };

        await RecalculateStatusAsync(item);
        var created = await repo.CreateAsync(item);

        await RecordMovementAsync(created.InventoryID, StockMovementType.StockIn,
            request.QuantityOnHand, "Initial stock entry");
        await LogAuditAsync("Created Inventory Item", "InventoryItem", created.InventoryID.ToString(),
            $"ProductName: {created.ProductName}, Qty: {created.QuantityOnHand}, LocationID: {created.LocationID}");

        return ApiResponse<InventoryItemViewModel>.Ok(Map(created), "Inventory item created.");
    }

    public async Task<ApiResponse<InventoryItemViewModel>> UpdateAsync(int id, UpdateInventoryItemRequest request)
    {
        var item = await repo.GetByIdAsync(id);
        if (item == null)
            return ApiResponse<InventoryItemViewModel>.Fail($"Inventory item {id} not found.");

        if (request.LocationID.HasValue)
        {
            var location = await locationRepo.GetByIdAsync(request.LocationID.Value);
            if (location == null)
                return ApiResponse<InventoryItemViewModel>.Fail($"Location {request.LocationID.Value} not found.");
            if (!location.IsActive)
                return ApiResponse<InventoryItemViewModel>.Fail($"Location '{location.Name}' is inactive and cannot be assigned to an inventory item.");
            item.LocationID = request.LocationID.Value;
        }
        if (request.QuantityOnHand.HasValue) item.QuantityOnHand = request.QuantityOnHand.Value;
        if (request.MinimumQuantity.HasValue) item.MinimumQuantity = request.MinimumQuantity.Value;
        if (request.Notes != null) item.Notes = request.Notes;

        await RecalculateStatusAsync(item);
        var updated = await repo.UpdateAsync(item);

        await LogAuditAsync("Updated Inventory Item", "InventoryItem", id.ToString(),
            $"Qty: {updated.QuantityOnHand}, Status: {updated.Status}");

        return ApiResponse<InventoryItemViewModel>.Ok(Map(updated), "Inventory item updated.");
    }

    public async Task<ApiResponse<InventoryItemViewModel>> AdjustQuantityAsync(int id, AdjustQuantityRequest request)
    {
        var item = await repo.GetByIdAsync(id);
        if (item == null)
            return ApiResponse<InventoryItemViewModel>.Fail($"Inventory item {id} not found.");

        item.QuantityOnHand += request.Adjustment;
        if (item.QuantityOnHand < 0)
            return ApiResponse<InventoryItemViewModel>.Fail("Adjustment would result in negative stock.");

        await RecalculateStatusAsync(item);
        var updated = await repo.UpdateAsync(item);

        var movementType = request.Adjustment >= 0 ? StockMovementType.StockIn : StockMovementType.StockOut;
        await RecordMovementAsync(id, movementType, Math.Abs(request.Adjustment), request.Reason);
        await LogAuditAsync("Adjusted Inventory Quantity", "InventoryItem", id.ToString(),
            $"Adjustment: {request.Adjustment}, NewQty: {updated.QuantityOnHand}, Reason: {request.Reason}");

        return ApiResponse<InventoryItemViewModel>.Ok(Map(updated), "Quantity adjusted.");
    }

    public async Task<ApiResponse> DeleteAsync(int id)
    {
        var item = await repo.GetByIdAsync(id);
        if (item == null)
            return ApiResponse.Fail($"Inventory item {id} not found.");

        if (await movementRepo.HasMovementsAsync(id))
            return ApiResponse.Fail($"Cannot delete '{item.ProductName}' because it has stock movement history. Deactivate it instead.");

        await repo.DeleteAsync(item);
        await LogAuditAsync("Deleted Inventory Item", "InventoryItem", id.ToString(),
            $"ProductName: {item.ProductName}");

        return ApiResponse.Ok("Inventory item deleted.");
    }

    // ── Mappers ───────────────────────────────────────────────────────────────

    private static InventoryItemViewModel Map(InventoryItem i) => new()
    {
        InventoryID     = i.InventoryID,
        ItemType        = i.ItemType,
        ProductID       = i.ProductID,
        ComponentID     = i.ComponentID,
        ProductName     = i.ProductName,
        LocationID      = i.LocationID,
        LocationName    = i.Location?.Name,
        QuantityOnHand  = i.QuantityOnHand,
        MinimumQuantity = i.MinimumQuantity,
        Status          = i.Status,
        Notes           = i.Notes,
    };

    private static StockMovementViewModel MapMovement(StockMovement m) => new()
    {
        MovementID = m.MovementID,
        InventoryID = m.InventoryID,
        MovementType = m.MovementType,
        Quantity = m.Quantity,
        Reason = m.Reason,
        ReferenceID = m.ReferenceID,
        PerformedBy = m.PerformedBy,
        CreatedDate = m.CreatedDate
    };
}
