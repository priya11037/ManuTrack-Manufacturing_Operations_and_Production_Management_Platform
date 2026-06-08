using Microsoft.EntityFrameworkCore;
using ProductService.Models;

namespace ProductService.Data;

public class ProductDbContext(DbContextOptions<ProductDbContext> options) : DbContext(options)
{
    public DbSet<Product> Products => Set<Product>();
    public DbSet<Bom> Boms => Set<Bom>();
    public DbSet<Component> Components => Set<Component>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Component>(e =>
        {
            e.HasKey(c => c.ComponentID);
            e.Property(c => c.ComponentID).ValueGeneratedOnAdd();
            e.Property(c => c.Name).IsRequired().HasMaxLength(200);
            e.Property(c => c.MaterialType).IsRequired().HasMaxLength(100);
            e.Property(c => c.Unit).IsRequired().HasMaxLength(50);
            e.Property(c => c.Description).HasMaxLength(500);
            e.HasIndex(c => c.Name).IsUnique();
        });

        modelBuilder.Entity<Product>(e =>
        {
            e.HasKey(p => p.ProductID);
            e.Property(p => p.ProductID).ValueGeneratedOnAdd();
            e.Property(p => p.Name).IsRequired().HasMaxLength(200);
            e.Property(p => p.Category).IsRequired().HasMaxLength(100);
            e.Property(p => p.Version).IsRequired().HasMaxLength(20).HasDefaultValue("1.0");
            e.Property(p => p.Status).IsRequired().HasMaxLength(50).HasDefaultValue("Draft");
            e.Property(p => p.Description).HasMaxLength(1000);
            e.HasIndex(p => p.Name);
            e.HasIndex(p => p.Category);
        });

        modelBuilder.Entity<Bom>(e =>
        {
            e.HasKey(b => b.BOMID);
            e.Property(b => b.BOMID).ValueGeneratedOnAdd();
            e.Property(b => b.Quantity).IsRequired().HasColumnType("decimal(18,4)");
            e.Property(b => b.Version).IsRequired().HasMaxLength(20).HasDefaultValue("1.0");
            e.Property(b => b.Status).IsRequired().HasMaxLength(50).HasDefaultValue("Active");
            e.Property(b => b.Notes).HasMaxLength(500);

            e.HasOne(b => b.Product)
             .WithMany(p => p.Boms)
             .HasForeignKey(b => b.ProductID)
             .OnDelete(DeleteBehavior.Restrict);

            e.HasOne(b => b.Component)
             .WithMany()
             .HasForeignKey(b => b.ComponentID)
             .OnDelete(DeleteBehavior.Restrict);

            e.HasIndex(b => b.ProductID);
            e.HasIndex(b => b.ComponentID);
        });
    }
}
