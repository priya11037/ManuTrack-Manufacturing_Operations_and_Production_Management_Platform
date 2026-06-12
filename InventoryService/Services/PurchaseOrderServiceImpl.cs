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

public class PurchaseOrderServiceImpl(
    IPurchaseOrderRepository repo,
    IInventoryRepository inventoryRepo,
    IStockMovementRepository movementRepo,
    ISupplierRepository supplierRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<PurchaseOrderServiceImpl> logger) : IPurchaseOrderService
{
    private static string DetermineStatus(decimal qty, decimal minQty)
    {
        if (qty <= 0) return InventoryStatus.OutOfStock;
        if (qty <= minQty) return InventoryStatus.LowStock;
        return InventoryStatus.InStock;
    }

    private async Task NotifyPOCreatedAsync(int poId, string supplierName)
    {
        try
        {
            var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "NotificationService");
            await client.PostAsJsonAsync("api/v1/notifications/notify-role", new
            {
                TargetRole = "Admin",
                Title = "New Purchase Order Created",
                Message = $"Purchase Order #PO-{poId} has been created for supplier '{supplierName}' and requires approval.",
                Category = "Inventory",
                Priority = "Medium"
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "PO created notification failed for PO {PoId}.", poId); }
    }

    private async Task NotifyPOStatusChangedAsync(int poId, string newStatus)
    {
        try
        {
            var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "NotificationService");
            await client.PostAsJsonAsync("api/v1/notifications/notify-role", new
            {
                TargetRole = "InventoryManager",
                Title = $"Purchase Order {newStatus}",
                Message = $"Purchase Order #PO-{poId} has been {newStatus.ToLower()}.",
                Category = "Inventory",
                Priority = "Medium"
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "PO status notification failed for PO {PoId}.", poId); }
    }

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
        catch (Exception ex) { logger.LogWarning(ex, "Audit log failed in PurchaseOrderService."); }
    }

    // ── CRUD ──────────────────────────────────────────────────────────────────

    public async Task<ApiResponse<IEnumerable<PurchaseOrderViewModel>>> GetAllAsync(string? status)
    {
        var orders = await repo.GetAllAsync(status);
        return ApiResponse<IEnumerable<PurchaseOrderViewModel>>.Ok(orders.Select(Map));
    }

    public async Task<ApiResponse<PurchaseOrderViewModel>> GetByIdAsync(int id)
    {
        var po = await repo.GetByIdAsync(id);
        if (po == null)
            return ApiResponse<PurchaseOrderViewModel>.Fail($"Purchase order {id} not found.");
        return ApiResponse<PurchaseOrderViewModel>.Ok(Map(po));
    }

    public async Task<ApiResponse<PurchaseOrderViewModel>> CreateAsync(CreatePurchaseOrderRequest request)
    {
        string supplierName = request.SupplierName ?? string.Empty;
        string supplierId = request.SupplierID ?? string.Empty;

        // Validate SupplierRefID if provided
        if (request.SupplierRefID.HasValue)
        {
            var supplier = await supplierRepo.GetByIdAsync(request.SupplierRefID.Value);
            if (supplier == null)
                return ApiResponse<PurchaseOrderViewModel>.Fail($"Supplier {request.SupplierRefID.Value} not found.");
            if (!supplier.IsActive)
                return ApiResponse<PurchaseOrderViewModel>.Fail($"Supplier '{supplier.Name}' is not active.");
            supplierName = supplier.Name;
            supplierId = supplier.SupplierID.ToString();
        }

        // Validate all inventory items exist
        foreach (var item in request.Items)
        {
            if (!await inventoryRepo.ExistsAsync(item.InventoryID))
                return ApiResponse<PurchaseOrderViewModel>.Fail($"Inventory item {item.InventoryID} not found.");
        }

        var items = request.Items.Select(i => new PurchaseOrderItem
        {
            InventoryID = i.InventoryID,
            ProductID = i.ProductID,
            ProductName = i.ProductName,
            Quantity = i.Quantity,
            UnitPrice = i.UnitPrice,
            TotalPrice = i.Quantity * i.UnitPrice,
            ReceivedQty = 0
        }).ToList();

        var po = new PurchaseOrder
        {
            SupplierRefID = request.SupplierRefID,
            SupplierID = supplierId,
            SupplierName = supplierName,
            OrderDate = DateTime.UtcNow,
            ExpectedDeliveryDate = request.ExpectedDeliveryDate,
            Notes = request.Notes,
            TotalAmount = items.Sum(i => i.TotalPrice),
            Status = PurchaseOrderStatus.Pending,
            Items = items
        };

        var created = await repo.CreateAsync(po);

        await LogAuditAsync("Created Purchase Order", "PurchaseOrder", created.POID.ToString(),
            $"Supplier: {supplierName}, Items: {items.Count}, Total: {po.TotalAmount}");

        _ = NotifyPOCreatedAsync(created.POID, supplierName);

        return ApiResponse<PurchaseOrderViewModel>.Ok(Map(created), "Purchase order created.");
    }

    public async Task<ApiResponse<PurchaseOrderViewModel>> UpdateStatusAsync(int id, UpdatePurchaseOrderStatusRequest request)
    {
        var po = await repo.GetByIdAsync(id);
        if (po == null)
            return ApiResponse<PurchaseOrderViewModel>.Fail($"Purchase order {id} not found.");

        // Guard: only adjust stock once — skip if already Received
        if (po.Status == PurchaseOrderStatus.Received && request.Status == PurchaseOrderStatus.Received)
            return ApiResponse<PurchaseOrderViewModel>.Fail("Purchase order is already marked as Received.");

        // Auto-update inventory when PO is first marked as Received
        if (request.Status == PurchaseOrderStatus.Received)
        {
            var (userId, _) = ServiceHelper.GetCurrentUser(httpContextAccessor);

            foreach (var item in po.Items)
            {
                var invItem = await inventoryRepo.GetByIdAsync(item.InventoryID);
                if (invItem == null) continue;

                invItem.QuantityOnHand += item.Quantity;
                invItem.Status = DetermineStatus(invItem.QuantityOnHand, invItem.MinimumQuantity);
                item.ReceivedQty = item.Quantity;

                await inventoryRepo.UpdateAsync(invItem);

                // Create StockMovement record for each received item
                await movementRepo.CreateAsync(new StockMovement
                {
                    InventoryID = item.InventoryID,
                    MovementType = StockMovementType.StockIn,
                    Quantity = item.Quantity,
                    Reason = $"Received from Purchase Order PO-{po.POID}",
                    ReferenceID = $"PO-{po.POID}",
                    PerformedBy = userId,
                    CreatedDate = DateTime.UtcNow
                });
            }
        }

        po.Status = request.Status;
        var updated = await repo.UpdateAsync(po);

        await LogAuditAsync("Updated PO Status", "PurchaseOrder", id.ToString(),
            $"New Status: {request.Status}");

        if (request.Status == PurchaseOrderStatus.Approved || request.Status == PurchaseOrderStatus.Rejected)
            _ = NotifyPOStatusChangedAsync(id, request.Status);

        return ApiResponse<PurchaseOrderViewModel>.Ok(Map(updated), "Purchase order status updated.");
    }

    private static PurchaseOrderViewModel Map(PurchaseOrder p) => new()
    {
        POID = p.POID,
        SupplierRefID = p.SupplierRefID,
        SupplierID = p.SupplierID,
        SupplierName = p.SupplierName,
        OrderDate = p.OrderDate,
        ExpectedDeliveryDate = p.ExpectedDeliveryDate,
        Status = p.Status,
        TotalAmount = p.TotalAmount,
        Notes = p.Notes,
        CreatedDate = p.CreatedDate,
        ModifiedDate = p.ModifiedDate,
        Items = p.Items.Select(i => new PurchaseOrderItemViewModel
        {
            POItemID = i.POItemID,
            InventoryID = i.InventoryID,
            ProductID = i.ProductID,
            ProductName = i.ProductName,
            Quantity = i.Quantity,
            UnitPrice = i.UnitPrice,
            TotalPrice = i.TotalPrice,
            ReceivedQty = i.ReceivedQty,
            CreatedDate = i.CreatedDate
        }).ToList()
    };
}
