using System.ComponentModel.DataAnnotations;

namespace InventoryService.DTOs;

public class CreateInventoryItemRequest : IValidatableObject
{
    [RegularExpression("^(Product|RawMaterial)$", ErrorMessage = "ItemType must be 'Product' or 'RawMaterial'.")]
    public string ItemType { get; set; } = "Product";

    [Range(1, int.MaxValue, ErrorMessage = "ProductID must be a positive integer.")]
    public int? ProductID { get; set; }

    [Range(1, int.MaxValue, ErrorMessage = "ComponentID must be a positive integer.")]
    public int? ComponentID { get; set; }

    [Required(ErrorMessage = "Name is required.")]
    [MinLength(2, ErrorMessage = "Name must be at least 2 characters.")]
    [MaxLength(200, ErrorMessage = "Name cannot exceed 200 characters.")]
    public string ProductName { get; set; } = string.Empty;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (ItemType == "Product" && (ProductID == null || ProductID <= 0))
            yield return new ValidationResult("ProductID is required when ItemType is 'Product'.", [nameof(ProductID)]);
        if (ItemType == "RawMaterial" && (ComponentID == null || ComponentID <= 0))
            yield return new ValidationResult("ComponentID is required when ItemType is 'RawMaterial'.", [nameof(ComponentID)]);
    }


    [Range(1, int.MaxValue, ErrorMessage = "LocationID must be a positive integer.")]
    public int? LocationID { get; set; }

    [Required(ErrorMessage = "Quantity on hand is required.")]
    [Range(0, 9999999.9999, ErrorMessage = "Quantity on hand must be between 0 and 9,999,999.")]
    public decimal QuantityOnHand { get; set; }

    [Range(0, 9999999.9999, ErrorMessage = "Minimum quantity must be between 0 and 9,999,999.")]
    public decimal MinimumQuantity { get; set; }

    [MaxLength(500, ErrorMessage = "Notes cannot exceed 500 characters.")]
    public string? Notes { get; set; }
}

public class UpdateInventoryItemRequest
{
    
    [Range(1, int.MaxValue, ErrorMessage = "LocationID must be a positive integer.")]
    public int? LocationID { get; set; }

    [Range(0, 9999999.9999, ErrorMessage = "Quantity on hand must be between 0 and 9,999,999.")]
    public decimal? QuantityOnHand { get; set; }

    [Range(0, 9999999.9999, ErrorMessage = "Minimum quantity must be between 0 and 9,999,999.")]
    public decimal? MinimumQuantity { get; set; }

    [MaxLength(500, ErrorMessage = "Notes cannot exceed 500 characters.")]
    public string? Notes { get; set; }
}

public class AdjustQuantityRequest
{
    [Required(ErrorMessage = "Adjustment value is required.")]
    [Range(-9999999.9999, 9999999.9999, ErrorMessage = "Adjustment must be between -9,999,999 and 9,999,999.")]
    public decimal Adjustment { get; set; }

    [Required(ErrorMessage = "Reason for adjustment is required.")]
    [MinLength(5, ErrorMessage = "Reason must be at least 5 characters.")]
    [MaxLength(500, ErrorMessage = "Reason cannot exceed 500 characters.")]
    public string Reason { get; set; } = string.Empty;
}

public class InventoryItemViewModel
{
    public int InventoryID { get; set; }
    public string ItemType { get; set; } = "Product";
    public int? ProductID { get; set; }
    public int? ComponentID { get; set; }
    public string ProductName { get; set; } = string.Empty;
 
    public int? LocationID { get; set; }
    public string? LocationName { get; set; }
    public decimal QuantityOnHand { get; set; }
    public decimal MinimumQuantity { get; set; }
    public string Status { get; set; } = string.Empty;
    public string? Notes { get; set; }
}
