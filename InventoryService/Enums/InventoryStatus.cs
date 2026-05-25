namespace InventoryService.Enums;

public static class InventoryStatus
{
    public const string InStock = "InStock";
    public const string LowStock = "LowStock";
    public const string OutOfStock = "OutOfStock";
}

public static class PurchaseOrderStatus
{
    public const string Pending = "Pending";
    public const string Approved = "Approved";
    public const string Ordered = "Ordered";
    public const string Received = "Received";
    public const string Cancelled = "Cancelled";
}

public static class StockMovementType
{
    public const string StockIn = "StockIn";
    public const string StockOut = "StockOut";
    public const string Adjustment = "Adjustment";
    public const string Reserved = "Reserved";
    public const string Consumed = "Consumed";
}
