using ProductService.Models;

namespace ProductService.Repositories;

public interface IComponentRepository
{
    Task<IEnumerable<Component>> GetAllAsync(string? materialType = null);
    Task<Component?> GetByIdAsync(int id);
    Task<Component> CreateAsync(Component component);
    Task<Component> UpdateAsync(Component component);
    Task DeleteAsync(Component component);
    Task<bool> ExistsAsync(int id);
    Task<bool> ExistsByNameAsync(string name, int? excludeId = null);
}
