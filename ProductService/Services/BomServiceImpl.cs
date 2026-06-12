using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using ProductService.Enums;
using ManuTrack.SharedKernel.Helpers;
using ManuTrack.SharedKernel.Responses;
using ProductService.DTOs;
using ProductService.Models;
using ProductService.Repositories;
using ProductService.Repositories.Interfaces;
using ProductService.Services.Interfaces;

namespace ProductService.Services;

public class BomServiceImpl(
    IBomRepository bomRepo,
    IProductRepository productRepo,
    IComponentRepository componentRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<BomServiceImpl> logger) : IBomService
{
    // ── Change 4: Audit logging (fire-and-forget) ────────────────────────────
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
                ServiceName = "ProductService",
                Details = details
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Audit log failed in BomService."); }
    }

    // ── Change 5: Low stock alert (fire-and-forget) ───────────────────────────
    private async Task CheckLowStockAndNotifyAsync(int componentId, decimal requiredQuantity)
    {
        try
        {
            // Query InventoryService for all items and filter by componentId
            var invClient = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "InventoryService");
            var invResponse = await invClient.GetAsync("api/v1/inventory");
            if (!invResponse.IsSuccessStatusCode) return;

            var invResult = await invResponse.Content
                .ReadFromJsonAsync<ApiResponse<IEnumerable<InventoryItemDto>>>(
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var totalStock = invResult?.Data?
                .Where(i => i.ProductID == componentId)
                .Sum(i => i.QuantityOnHand) ?? 0;

            if (totalStock < requiredQuantity)
            {
                var notifyClient = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "NotificationService");
                await notifyClient.PostAsJsonAsync("api/v1/notifications/notify-role", new
                {
                    TargetRole = "InventoryManager",
                    Title = "Low Stock Alert",
                    Message = $"Component (ID: {componentId}) has only {totalStock} units in stock, " +
                              $"but the BOM requires {requiredQuantity} units.",
                    Category = "Inventory",
                    Priority = "Medium"
                });
            }
        }
        catch (Exception ex) { logger.LogWarning(ex, "Low stock notification failed for component {ComponentId}.", componentId); }
    }

    // ── CRUD ────────────────────────────────────────────────────────────────

    public async Task<ApiResponse<IEnumerable<BomViewModel>>> GetAllBomsAsync(int? productId, string? status)
    {
        var boms = await bomRepo.GetAllAsync(productId, status);
        return ApiResponse<IEnumerable<BomViewModel>>.Ok(boms.Select(Map));
    }

    public async Task<ApiResponse<BomViewModel>> GetBomByIdAsync(int id)
    {
        var bom = await bomRepo.GetByIdAsync(id);
        if (bom == null)
            return ApiResponse<BomViewModel>.Fail($"BOM {id} not found.");
        return ApiResponse<BomViewModel>.Ok(Map(bom));
    }

    public async Task<ApiResponse<IEnumerable<BomViewModel>>> GetBomsByProductIdAsync(int productId)
    {
        if (!await productRepo.ExistsAsync(productId))
            return ApiResponse<IEnumerable<BomViewModel>>.Fail($"Product {productId} not found.");

        var boms = await bomRepo.GetByProductIdAsync(productId);
        return ApiResponse<IEnumerable<BomViewModel>>.Ok(boms.Select(Map));
    }

    public async Task<ApiResponse<BomViewModel>> CreateBomAsync(CreateBomRequest request)
    {
        // Change 2: product must exist AND be Active before allowing BOM creation
        var product = await productRepo.GetByIdAsync(request.ProductID);
        if (product == null)
            return ApiResponse<BomViewModel>.Fail($"Product {request.ProductID} not found.");

        if (product.Status != ProductStatus.Active)
            return ApiResponse<BomViewModel>.Fail(
                $"Product '{product.Name}' is not Active (current status: {product.Status}). " +
                "A BOM can only be created for Active products.");

        var component = await componentRepo.GetByIdAsync(request.ComponentID);
        if (component == null)
            return ApiResponse<BomViewModel>.Fail($"Component {request.ComponentID} not found. Please register the raw material/component first.");

        if (!component.IsActive)
            return ApiResponse<BomViewModel>.Fail($"Component '{component.Name}' is inactive and cannot be used in a BOM.");

        var bom = new Bom
        {
            ProductID = request.ProductID,
            ComponentID = request.ComponentID,
            Quantity = request.Quantity,
            Version = request.Version,
            Notes = request.Notes,
            Status = ProductStatus.Draft,   // Change 1: default to Draft
            
        };

        var created = await bomRepo.CreateAsync(bom);
        var full = await bomRepo.GetByIdAsync(created.BOMID);

        // Fire-and-forget — do NOT await so response returns immediately
        _ = LogAuditAsync("Created BOM", "BOM", created.BOMID.ToString(),
            $"ProductID: {created.ProductID}, ComponentID: {created.ComponentID}, Quantity: {created.Quantity}");
        _ = CheckLowStockAndNotifyAsync(created.ComponentID, created.Quantity);

        return ApiResponse<BomViewModel>.Ok(Map(full!), "BOM entry created successfully.");
    }

    public async Task<ApiResponse<BomViewModel>> UpdateBomAsync(int id, UpdateBomRequest request)
    {
        var bom = await bomRepo.GetByIdAsync(id);
        if (bom == null)
            return ApiResponse<BomViewModel>.Fail($"BOM {id} not found.");

        if (request.Quantity.HasValue) bom.Quantity = request.Quantity.Value;
        if (request.Version != null) bom.Version = request.Version;
        if (request.Notes != null) bom.Notes = request.Notes;

        var updated = await bomRepo.UpdateAsync(bom);

        // Change 4: audit log
        _ = LogAuditAsync("Updated BOM", "BOM", id.ToString(),
            $"Version: {updated.Version}, Quantity: {updated.Quantity}");

        // Change 5: re-check low stock when quantity is updated
        if (request.Quantity.HasValue)
            _ = CheckLowStockAndNotifyAsync(updated.ComponentID, updated.Quantity);

        return ApiResponse<BomViewModel>.Ok(Map(updated), "BOM updated successfully.");
    }

    public async Task<ApiResponse<BomViewModel>> UpdateBomStatusAsync(int id, UpdateBomStatusRequest request)
    {
        var bom = await bomRepo.GetByIdAsync(id);
        if (bom == null)
            return ApiResponse<BomViewModel>.Fail($"BOM {id} not found.");

        bom.Status = request.Status;
        var updated = await bomRepo.UpdateAsync(bom);

        // Change 4: audit log
        _ = LogAuditAsync("Updated BOM Status", "BOM", id.ToString(),
            $"New Status: {request.Status}");

        return ApiResponse<BomViewModel>.Ok(Map(updated), "BOM status updated.");
    }

    public async Task<ApiResponse> DeleteBomAsync(int id)
    {
        var bom = await bomRepo.GetByIdAsync(id);
        if (bom == null)
            return ApiResponse.Fail($"BOM {id} not found.");

        await bomRepo.DeleteAsync(bom);

        // Change 4: audit log
        _ = LogAuditAsync("Deleted BOM", "BOM", id.ToString(),
            $"ProductID: {bom.ProductID}, ComponentID: {bom.ComponentID}");

        return ApiResponse.Ok("BOM deleted successfully.");
    }

    // ── Mapper ──────────────────────────────────────────────────────────────

    private static BomViewModel Map(Bom b) => new()
    {
        BOMID = b.BOMID,
        ProductID = b.ProductID,
        ProductName = b.Product?.Name ?? string.Empty,
        ComponentID = b.ComponentID,
        ComponentName = b.Component?.Name ?? string.Empty,
        ComponentUnit = b.Component?.Unit ?? string.Empty,
        ComponentMaterialType = b.Component?.MaterialType ?? string.Empty,
        Quantity = b.Quantity,
        Version = b.Version,
        Status = b.Status,
        Notes = b.Notes,
    };

    // ── Local DTO for InventoryService response deserialization ──────────────
    private sealed class InventoryItemDto
    {
        public int ProductID { get; set; }
        public decimal QuantityOnHand { get; set; }
    }
}
