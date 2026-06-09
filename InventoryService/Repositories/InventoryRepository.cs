using InventoryService.Data;
using InventoryService.Models;
using InventoryService.Repositories.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace InventoryService.Repositories;

public class InventoryRepository(InventoryDbContext db) : IInventoryRepository
{
    public async Task<IEnumerable<InventoryItem>> GetAllAsync(
        string? status = null, int? locationId = null)
    {
        var query = db.InventoryItems
            .Include(i => i.Location)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status))
            query = query.Where(i => i.Status == status);
        if (locationId.HasValue)
            query = query.Where(i => i.LocationID == locationId.Value);

        return await query.OrderBy(i => i.ProductName).ToListAsync();
    }

    public async Task<InventoryItem?> GetByIdAsync(int id) =>
        await db.InventoryItems
            .Include(i => i.Location)
            .FirstOrDefaultAsync(i => i.InventoryID == id);

    public async Task<InventoryItem?> GetByProductIdAsync(int productId) =>
        await db.InventoryItems
            .Include(i => i.Location)
            .FirstOrDefaultAsync(i => i.ProductID == productId);

    public async Task<IEnumerable<InventoryItem>> GetLowStockAsync() =>
        await db.InventoryItems
            .Include(i => i.Location)
            .Where(i => i.QuantityOnHand <= i.MinimumQuantity)
            .ToListAsync();

    public async Task<InventoryItem> CreateAsync(InventoryItem item)
    {
        db.InventoryItems.Add(item);
        await db.SaveChangesAsync();
        return item;
    }

    public async Task<InventoryItem> UpdateAsync(InventoryItem item)
    {
        db.InventoryItems.Update(item);
        await db.SaveChangesAsync();
        return item;
    }

    public async Task DeleteAsync(InventoryItem item)
    {
        db.InventoryItems.Remove(item);
        await db.SaveChangesAsync();
    }

    public async Task<bool> ExistsAsync(int id) =>
        await db.InventoryItems.AnyAsync(i => i.InventoryID == id);
}
