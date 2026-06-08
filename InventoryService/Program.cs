using InventoryService.Data;
using InventoryService.Models;
using InventoryService.Repositories;
using InventoryService.Repositories.Interfaces;
using InventoryService.Services;
using InventoryService.Services.Interfaces;
using ManuTrack.SharedKernel.Filters;
using ManuTrack.SharedKernel.Middleware;
using Microsoft.AspNetCore.Mvc;
using ManuTrack.SharedKernel.Responses;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers(options =>
{
    options.Filters.Add<GlobalExceptionFilter>();
    options.Filters.Add<ModelValidationFilter>();
});
builder.Services.Configure<ApiBehaviorOptions>(o => o.SuppressModelStateInvalidFilter = true);

builder.Services.AddDbContext<InventoryDbContext>(options =>
    options.UseSqlServer(builder.Configuration.GetConnectionString("OperationsDb")));

var jwtKey = builder.Configuration["Jwt:Key"]!;
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true, ValidateAudience = true, ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtKey))
        };
        options.Events = new JwtBearerEvents
        {
            OnChallenge = async context =>
            {
                context.HandleResponse();
                context.Response.StatusCode = 401;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsJsonAsync(
                    ApiResponse.Fail("Authorization token is required."));
            },
            OnForbidden = async context =>
            {
                context.Response.StatusCode = 403;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsJsonAsync(
                    ApiResponse.Fail("Access denied. You do not have permission to perform this action."));
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddCors(o => o.AddPolicy("AllowAll",
    p => p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddHttpContextAccessor();
builder.Services.AddHttpClient("ComplianceService", client =>
    client.BaseAddress = new Uri(builder.Configuration["ServiceUrls:ComplianceService"]!));
builder.Services.AddHttpClient("NotificationService", client =>
    client.BaseAddress = new Uri(builder.Configuration["ServiceUrls:NotificationService"]!));

builder.Services.AddScoped<IInventoryRepository, InventoryRepository>();
builder.Services.AddScoped<IPurchaseOrderRepository, PurchaseOrderRepository>();
builder.Services.AddScoped<IStockMovementRepository, StockMovementRepository>();
builder.Services.AddScoped<ISupplierRepository, SupplierRepository>();
builder.Services.AddScoped<ILocationRepository, LocationRepository>();
builder.Services.AddScoped<IInventoryService, InventoryServiceImpl>();
builder.Services.AddScoped<IPurchaseOrderService, PurchaseOrderServiceImpl>();
builder.Services.AddScoped<ISupplierService, SupplierServiceImpl>();
builder.Services.AddScoped<ILocationService, LocationServiceImpl>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo { Title = "Inventory Service", Version = "v1" });
    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = ParameterLocation.Header,
        Description = "Enter your JWT token"
    });
    options.AddSecurityRequirement(new OpenApiSecurityRequirement
    {
        {
            new OpenApiSecurityScheme
            {
                Reference = new OpenApiReference
                {
                    Type = ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

var app = builder.Build();

app.UseMiddleware<ManuTrack.SharedKernel.Middleware.ExceptionHandlingMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.UseSwagger();
app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "Inventory Service v1"));

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    db.Database.Migrate();

    // ── One-time sync: create InventoryItems for Components that don't have one yet ──
    try
    {
        // Read all ComponentIDs that already have an inventory item
        var existingComponentIds = db.InventoryItems
            .Where(i => i.ComponentID != null)
            .Select(i => i.ComponentID!.Value)
            .ToHashSet();

        // Query Components table directly (same OperationsDb)
        var components = db.Database
            .SqlQueryRaw<ComponentSyncRow>(
                "SELECT ComponentID, Name, MaterialType, Unit FROM Components WHERE IsActive = 1")
            .ToList();

        var missing = components.Where(c => !existingComponentIds.Contains(c.ComponentID)).ToList();

        if (missing.Count > 0)
        {
            var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
            logger.LogInformation("Syncing {Count} existing component(s) to InventoryItems...", missing.Count);

            foreach (var c in missing)
            {
                var item = new InventoryItem
                {
                    ItemType        = "RawMaterial",
                    ComponentID     = c.ComponentID,
                    ProductName     = c.Name,
                    QuantityOnHand  = 0,
                    MinimumQuantity = 0,
                    Status          = "OutOfStock",
                    Notes           = $"Auto-synced on startup · {c.MaterialType} · {c.Unit}"
                };
                db.InventoryItems.Add(item);
            }

            await db.SaveChangesAsync();
            logger.LogInformation("Sync complete — {Count} inventory item(s) created.", missing.Count);
        }
    }
    catch (Exception ex)
    {
        var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
        logger.LogWarning(ex, "Component → Inventory sync failed at startup (non-fatal).");
    }
}

app.Run();

// ── Helper class for raw-SQL component sync ───────────────────────────────────
public class ComponentSyncRow
{
    public int ComponentID { get; set; }
    public string Name { get; set; } = string.Empty;
    public string MaterialType { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;
}
