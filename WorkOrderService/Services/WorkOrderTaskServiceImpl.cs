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

public class WorkOrderTaskServiceImpl(
    IWorkOrderTaskRepository taskRepo,
    IWorkOrderRepository workOrderRepo,
    IHttpClientFactory httpClientFactory,
    IHttpContextAccessor httpContextAccessor,
    ILogger<WorkOrderTaskServiceImpl> logger) : IWorkOrderTaskService
{
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
        catch (Exception ex) { logger.LogWarning(ex, "Audit log failed in WorkOrderTaskService."); }
    }

    // ── CRUD ─────────────────────────────────────────────────────────────────

    public async Task<ApiResponse<IEnumerable<WorkOrderTaskViewModel>>> GetByWorkOrderIdAsync(int workOrderId)
    {
        if (!await workOrderRepo.ExistsAsync(workOrderId))
            return ApiResponse<IEnumerable<WorkOrderTaskViewModel>>.Fail($"WorkOrder {workOrderId} not found.");

        var tasks = await taskRepo.GetByWorkOrderIdAsync(workOrderId);
        return ApiResponse<IEnumerable<WorkOrderTaskViewModel>>.Ok(tasks.Select(Map));
    }

    public async Task<ApiResponse<WorkOrderTaskViewModel>> GetByIdAsync(int id)
    {
        var task = await taskRepo.GetByIdAsync(id);
        if (task == null)
            return ApiResponse<WorkOrderTaskViewModel>.Fail($"Task {id} not found.");
        return ApiResponse<WorkOrderTaskViewModel>.Ok(Map(task));
    }

    public async Task<ApiResponse<WorkOrderTaskViewModel>> CreateAsync(CreateWorkOrderTaskRequest request)
    {
        if (!await workOrderRepo.ExistsAsync(request.WorkOrderID))
            return ApiResponse<WorkOrderTaskViewModel>.Fail($"WorkOrder {request.WorkOrderID} not found.");

        var task = new WorkOrderTask
        {
            WorkOrderID = request.WorkOrderID,
            Description = request.Description,
            AssignedTo = request.AssignedTo,
            
            Status = WorkOrderTaskStatus.Pending,
            
        };

        var created = await taskRepo.CreateAsync(task);

        await LogAuditAsync("Created Task", "WorkOrderTask", created.TaskID.ToString(),
            $"WorkOrderID: {created.WorkOrderID}, AssignedTo: {created.AssignedTo}");

        var token = ServiceHelper.GetBearerToken(httpContextAccessor);
        _ = NotifyTaskAssignedAsync(created.TaskID, created.WorkOrderID, created.AssignedTo, token);

        return ApiResponse<WorkOrderTaskViewModel>.Ok(Map(created), "Task created successfully.");
    }

    public async Task<ApiResponse<WorkOrderTaskViewModel>> UpdateAsync(int id, UpdateWorkOrderTaskRequest request)
    {
        var task = await taskRepo.GetByIdAsync(id);
        if (task == null)
            return ApiResponse<WorkOrderTaskViewModel>.Fail($"Task {id} not found.");

        // UpdateWorkOrderTaskRequest is empty — no fields to update

        var updated = await taskRepo.UpdateAsync(task);

        await LogAuditAsync("Updated Task", "WorkOrderTask", id.ToString(), string.Empty);

        return ApiResponse<WorkOrderTaskViewModel>.Ok(Map(updated), "Task updated successfully.");
    }

    public async Task<ApiResponse<WorkOrderTaskViewModel>> UpdateStatusAsync(int id, UpdateTaskStatusRequest request)
    {
        var task = await taskRepo.GetByIdAsync(id);
        if (task == null)
            return ApiResponse<WorkOrderTaskViewModel>.Fail($"Task {id} not found.");

        task.Status = request.Status;
        var updated = await taskRepo.UpdateAsync(task);

        await LogAuditAsync("Updated Task Status", "WorkOrderTask", id.ToString(),
            $"New Status: {request.Status}");

        // Auto-transition Work Order status based on task progress
        if (request.Status == WorkOrderTaskStatus.InProgress || request.Status == WorkOrderTaskStatus.Completed)
        {
            var allTasks = await taskRepo.GetByWorkOrderIdAsync(task.WorkOrderID);
            var order = await workOrderRepo.GetByIdAsync(task.WorkOrderID);

            if (order != null && order.Status != WorkOrderStatus.Completed
                               && order.Status != WorkOrderStatus.Cancelled)
            {
                if (request.Status == WorkOrderTaskStatus.Completed &&
                    allTasks.Any() && allTasks.All(t => t.Status == WorkOrderTaskStatus.Completed))
                {
                    // All tasks done → auto-complete the WO and deduct BOM stock
                    order.Status = WorkOrderStatus.Completed;
                    await workOrderRepo.UpdateAsync(order);
                    await LogAuditAsync("Auto-Completed WorkOrder", "WorkOrder",
                        task.WorkOrderID.ToString(), "All tasks completed — Work Order auto-marked as Completed.");
                    var token = ServiceHelper.GetBearerToken(httpContextAccessor);
                    _ = NotifyWorkOrderCompletedAsync(task.WorkOrderID, token);
                    _ = DeductBomStockAsync(order.ProductID, order.Quantity, order.WorkOrderID, token);
                }
                else if (order.Status == WorkOrderStatus.Pending)
                {
                    // Any task started → move WO to InProgress (no stock deduction yet)
                    order.Status = WorkOrderStatus.InProgress;
                    await workOrderRepo.UpdateAsync(order);
                    await LogAuditAsync("Auto-Started WorkOrder", "WorkOrder",
                        task.WorkOrderID.ToString(), "Task started — Work Order auto-marked as InProgress.");
                }
            }
        }

        return ApiResponse<WorkOrderTaskViewModel>.Ok(Map(updated), "Task status updated.");
    }

    private async Task DeductBomStockAsync(int productId, decimal woQuantity, int workOrderId, string? token)
    {
        try
        {
            var productClient = httpClientFactory.CreateClient("ProductService");
            if (token != null) productClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);

            var bomResponse = await productClient.GetAsync($"api/v1/bom?productId={productId}");
            if (!bomResponse.IsSuccessStatusCode) return;

            var bomResult = await bomResponse.Content
                .ReadFromJsonAsync<BomListResponseDto>(
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var bomEntries = bomResult?.Data;
            if (bomEntries == null) return;

            var invClient = httpClientFactory.CreateClient("InventoryService");
            if (token != null) invClient.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            var invResponse = await invClient.GetAsync("api/v1/inventory");
            if (!invResponse.IsSuccessStatusCode) return;

            var invResult = await invResponse.Content
                .ReadFromJsonAsync<InventoryListResponseDto>(
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            var inventoryItems = invResult?.Data?.ToList();
            if (inventoryItems == null) return;

            foreach (var bom in bomEntries)
            {
                var invItem = inventoryItems.FirstOrDefault(i => i.ComponentID == bom.ComponentID);
                if (invItem == null) continue;

                var deduction = -(bom.Quantity * woQuantity);
                await invClient.PutAsJsonAsync($"api/v1/inventory/{invItem.InventoryID}/adjust", new
                {
                    Adjustment = deduction,
                    Reason = $"WO-{workOrderId} completed — consumed {Math.Abs(deduction)} {bom.ComponentUnit} of {bom.ComponentName}"
                });
            }

            logger.LogInformation("BOM stock deducted for WO {WorkOrderId}.", workOrderId);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "BOM stock deduction failed for WO {WorkOrderId}.", workOrderId);
        }
    }

    private sealed class BomListResponseDto { public IEnumerable<BomEntryDto>? Data { get; set; } }
    private sealed class BomEntryDto { public int ComponentID { get; set; } public string ComponentName { get; set; } = string.Empty; public string ComponentUnit { get; set; } = string.Empty; public decimal Quantity { get; set; } }
    private sealed class InventoryListResponseDto { public IEnumerable<InventoryItemDto>? Data { get; set; } }
    private sealed class InventoryItemDto { public int InventoryID { get; set; } public int? ComponentID { get; set; } }

    private async Task NotifyTaskAssignedAsync(int taskId, int workOrderId, string assignedTo, string? token)
    {
        try
        {
            var auth = httpClientFactory.CreateClient("AuthService");
            if (token != null) auth.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            var resp = await auth.GetFromJsonAsync<AuthUsersDto>("api/v1/auth/users/by-role/Operator",
                new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            var uid = resp?.Data?.FirstOrDefault(u => string.Equals(u.Name, assignedTo, StringComparison.OrdinalIgnoreCase))?.UserID;
            if (uid is null) return;

            var notif = httpClientFactory.CreateClient("NotificationService");
            if (token != null) notif.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            await notif.PostAsJsonAsync("api/v1/notifications", new
                { UserID = uid, Title = "New Task Assigned", Message = $"You have been assigned Task #{taskId} for Work Order #{workOrderId}.", Category = "WorkOrder", Priority = "Medium" });
        }
        catch (Exception ex) { logger.LogWarning(ex, "Task assigned notification failed for task {TaskId}.", taskId); }
    }

    private sealed class AuthUsersDto { public IEnumerable<AuthUserDto>? Data { get; set; } }
    private sealed class AuthUserDto { public int UserID { get; set; } public string Name { get; set; } = string.Empty; }

    private async Task NotifyWorkOrderCompletedAsync(int workOrderId, string? token)
    {
        try
        {
            var client = httpClientFactory.CreateClient("NotificationService");
            if (token != null) client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            await client.PostAsJsonAsync("api/v1/notifications/notify-role", new
            {
                TargetRole = "Planner",
                Title = "Work Order Completed",
                Message = $"Work Order #{workOrderId} has been completed — all tasks done.",
                Category = "WorkOrder",
                Priority = "Medium"
            });
        }
        catch (Exception ex) { logger.LogWarning(ex, "WO completion notification failed for WO {WorkOrderId}.", workOrderId); }
    }

    public async Task<ApiResponse> DeleteAsync(int id)
    {
        var task = await taskRepo.GetByIdAsync(id);
        if (task == null)
            return ApiResponse.Fail($"Task {id} not found.");

        if (task.Status == WorkOrderTaskStatus.Completed)
            return ApiResponse.Fail("Completed tasks cannot be deleted.");

        await taskRepo.DeleteAsync(task);

        await LogAuditAsync("Deleted Task", "WorkOrderTask", id.ToString(),
            $"WorkOrderID: {task.WorkOrderID}, AssignedTo: {task.AssignedTo}");

        return ApiResponse.Ok("Task deleted successfully.");
    }

    // ── Mapper ───────────────────────────────────────────────────────────────

    private static WorkOrderTaskViewModel Map(WorkOrderTask t) => new()
    {
        TaskID = t.TaskID,
        WorkOrderID = t.WorkOrderID,
        Description = t.Description,
        AssignedTo = t.AssignedTo,
        Status = t.Status,
        
        
        
        
    };
}
