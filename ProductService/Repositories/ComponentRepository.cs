using Microsoft.EntityFrameworkCore;
using ProductService.Data;
using ProductService.Models;

namespace ProductService.Repositories;

public class ComponentRepository(ProductDbContext db) : IComponentRepository
{
    public async Task<IEnumerable<Component>> GetAllAsync(string? materialType = null)
    {
        var query = db.Components.AsQueryable();
        if (!string.IsNullOrEmpty(materialType))
            query = query.Where(c => c.MaterialType == materialType);
        return await query.OrderBy(c => c.Name).ToListAsync();
    }

    public async Task<Component?> GetByIdAsync(int id) =>
        await db.Components.FindAsync(id);

    public async Task<Component> CreateAsync(Component component)
    {
        db.Components.Add(component);
        await db.SaveChangesAsync();
        return component;
    }

    public async Task<Component> UpdateAsync(Component component)
    {
        db.Components.Update(component);
        await db.SaveChangesAsync();
        return component;
    }

    public async Task DeleteAsync(Component component)
    {
        db.Components.Remove(component);
        await db.SaveChangesAsync();
    }

    public async Task<bool> ExistsAsync(int id) =>
        await db.Components.AnyAsync(c => c.ComponentID == id);

    public async Task<bool> ExistsByNameAsync(string name, int? excludeId = null) =>
        await db.Components.AnyAsync(c =>
            c.Name.ToLower() == name.ToLower() &&
            (excludeId == null || c.ComponentID != excludeId));
}
