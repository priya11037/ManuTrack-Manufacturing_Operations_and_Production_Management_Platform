using System.Net.Http.Json;
using Microsoft.AspNetCore.Http;
using WorkOrderService.Enums;
using ManuTrack.SharedKernel.Helpers;
using ManuTrack.SharedKernel.Responses;
using WorkOrderService.DTOs;
using WorkOrderService.Models;
using WorkOrderService.Repositories.Interfaces;
using WorkOrderService.Services.Interfaces;

namespace WorkOrderService.Services;

public class WorkOrderServiceImpl(
    IWorkOrderRepository repo,
    IWorkOrderTaskRepository taskRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<WorkOrderServiceImpl> logger) : IWorkOrderService
{
    // ── Change 3: Completion notification (fire-and-forget) ──────────────────
    private async Task NotifyWorkOrderCompletedAsync(int workOrderId)
    {
        try
        {
            var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "NotificationService");
            await client.PostAsJsonAsync("api/v1/notifications/notify-role", new
            {
                TargetRole = "Planner",
                Title = "Work Order Completed",
                Message = $"Work Order #{workOrderId} has been completed successfully.",
                Category = "WorkOrder",
                Priority = "Medium"
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Work order completion notification failed for WO {WorkOrderId}.", workOrderId); }
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
                ServiceName = "WorkOrderService",
                Details = details
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Audit log failed in WorkOrderService."); }
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    public async Task<ApiResponse<IEnumerable<WorkOrderViewModel>>> GetAllAsync(string? status, int? productId)
    {
        var orders = await repo.GetAllAsync(status, productId);
        return ApiResponse<IEnumerable<WorkOrderViewModel>>.Ok(orders.Select(Map));
    }

    public async Task<ApiResponse<WorkOrderViewModel>> GetByIdAsync(int id)
    {
        var order = await repo.GetByIdWithTasksAsync(id);
        if (order == null)
            return ApiResponse<WorkOrderViewModel>.Fail($"WorkOrder {id} not found.");
        return ApiResponse<WorkOrderViewModel>.Ok(Map(order));
    }

    public async Task<ApiResponse<WorkOrderViewModel>> CreateAsync(CreateWorkOrderRequest request)
    {
        if (request.EndDate <= request.StartDate)
            return ApiResponse<WorkOrderViewModel>.Fail("EndDate must be after StartDate.");

        var workOrder = new WorkOrder
        {
            ProductID = request.ProductID,
            ProductName = request.ProductName,
            Quantity = request.Quantity,
            StartDate = request.StartDate,
            EndDate = request.EndDate,
            Status = WorkOrderStatus.Pending
        };

        var created = await repo.CreateAsync(workOrder);

        await LogAuditAsync("Created WorkOrder", "WorkOrder", created.WorkOrderID.ToString(),
            $"ProductID: {created.ProductID}, ProductName: {created.ProductName}, Quantity: {created.Quantity}");

        return ApiResponse<WorkOrderViewModel>.Ok(Map(created), "Work order created successfully.");
    }

    public async Task<ApiResponse<WorkOrderViewModel>> UpdateAsync(int id, UpdateWorkOrderRequest request)
    {
        var order = await repo.GetByIdAsync(id);
        if (order == null)
            return ApiResponse<WorkOrderViewModel>.Fail($"WorkOrder {id} not found.");

        // UpdateWorkOrderRequest is now empty — no fields to update directly
        // Use UpdateStatus to change status

        var updated = await repo.UpdateAsync(order);

        await LogAuditAsync("Updated WorkOrder", "WorkOrder", id.ToString(),
            $"Quantity: {updated.Quantity}, Status: {updated.Status}");

        return ApiResponse<WorkOrderViewModel>.Ok(Map(updated), "Work order updated successfully.");
    }

    public async Task<ApiResponse<WorkOrderViewModel>> UpdateStatusAsync(int id, UpdateWorkOrderStatusRequest request)
    {
        var order = await repo.GetByIdAsync(id);
        if (order == null)
            return ApiResponse<WorkOrderViewModel>.Fail($"WorkOrder {id} not found.");

        // Block Completed if any tasks are still Pending or InProgress
        if (request.Status == WorkOrderStatus.Completed)
        {
            var tasks = await taskRepo.GetByWorkOrderIdAsync(id);
            var incompleteTasks = tasks.Count(t =>
                t.Status == WorkOrderTaskStatus.Pending ||
                t.Status == WorkOrderTaskStatus.InProgress);

            if (incompleteTasks > 0)
                return ApiResponse<WorkOrderViewModel>.Fail(
                    $"Cannot complete work order — {incompleteTasks} task(s) are still incomplete.");
            // Note: Quality inspection is handled separately by the QualityInspector role.
        }

        order.Status = request.Status;

        var updated = await repo.UpdateAsync(order);

        await LogAuditAsync("Updated WorkOrder Status", "WorkOrder", id.ToString(),
            $"New Status: {request.Status}");

        // Change 3: notify on Completed (fire-and-forget)
        if (request.Status == WorkOrderStatus.Completed)
            await NotifyWorkOrderCompletedAsync(id);

        // reload with tasks for accurate ProgressPercentage
        var withTasks = await repo.GetByIdWithTasksAsync(id);
        return ApiResponse<WorkOrderViewModel>.Ok(Map(withTasks!), "Work order status updated.");
    }

    public async Task<ApiResponse> DeleteAsync(int id)
    {
        var order = await repo.GetByIdAsync(id);
        if (order == null)
            return ApiResponse.Fail($"WorkOrder {id} not found.");

        await repo.DeleteAsync(order);

        await LogAuditAsync("Deleted WorkOrder", "WorkOrder", id.ToString(),
            $"ProductName: {order.ProductName}, Quantity: {order.Quantity}");

        return ApiResponse.Ok("Work order deleted successfully.");
    }

    // ── Change 7: Validate passed inspection before Completed ────────────────
    // Returns null if OK, error message string if validation fails
    private async Task<string?> GetInspectionValidationErrorAsync(int workOrderId)
    {
        try
        {
            var client = ServiceHelper.CreateAuthorizedClient(httpClientFactory, httpContextAccessor, "QualityService");
            var response = await client.GetAsync($"api/v1/inspections?workOrderId={workOrderId}");
            if (!response.IsSuccessStatusCode) return null; // QualityService unavailable — allow through

            var result = await response.Content
                .ReadFromJsonAsync<InspectionListResponseDto>(
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var inspections = result?.Data;
            if (inspections == null) return null;

            var hasPassedInspection = inspections.Any(i =>
                i.Result?.Equals("Pass", StringComparison.OrdinalIgnoreCase) == true &&
                i.Status?.Equals("Completed", StringComparison.OrdinalIgnoreCase) == true);

            if (!hasPassedInspection)
                return "Work order cannot be completed without a passed inspection. Please complete quality inspection first.";

            return null;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "QualityService unavailable during inspection validation for WO {WorkOrderId}. Allowing through.", workOrderId);
            return null; // Allow through if quality service is down
        }
    }

    // ── Local DTOs for QualityService response ────────────────────────────────
    private sealed class InspectionListResponseDto
    {
        public IEnumerable<InspectionSummaryDto>? Data { get; set; }
    }

    private sealed class InspectionSummaryDto
    {
        public string? Result { get; set; }
        public string? Status { get; set; }
    }


    // ── Mapper ───────────────────────────────────────────────────────────────

    private static WorkOrderViewModel Map(WorkOrder w)
    {
        return new WorkOrderViewModel
        {
            WorkOrderID = w.WorkOrderID,
            ProductID = w.ProductID,
            ProductName = w.ProductName,
            Quantity = w.Quantity,
            StartDate = w.StartDate,
            EndDate = w.EndDate,
            Status = w.Status,
            TaskCount = w.Tasks.Count
        };
    }
}
