using System.ComponentModel.DataAnnotations;

namespace NotificationService.DTOs;

public class SendNotificationRequest
{
    [Required(ErrorMessage = "UserID is required.")]
    [Range(1, int.MaxValue, ErrorMessage = "UserID must be a positive number.")]
    public int UserID { get; set; }

    [Required(ErrorMessage = "Title is required.")]
    [MinLength(2, ErrorMessage = "Title must be at least 2 characters.")]
    [MaxLength(200, ErrorMessage = "Title cannot exceed 200 characters.")]
    public string Title { get; set; } = string.Empty;

    [Required(ErrorMessage = "Message is required.")]
    [MinLength(5, ErrorMessage = "Message must be at least 5 characters.")]
    [MaxLength(2000, ErrorMessage = "Message cannot exceed 2000 characters.")]
    public string Message { get; set; } = string.Empty;

    // Change 1: category validation
    [Required(ErrorMessage = "Category is required.")]
    [RegularExpression("^(WorkOrder|Inventory|Quality|Compliance|General)$",
        ErrorMessage = "Category must be one of: WorkOrder, Inventory, Quality, Compliance, General.")]
    public string Category { get; set; } = string.Empty;

    // Change 5: optional priority, defaults to Medium
    [RegularExpression("^(Low|Medium|High|Critical)$",
        ErrorMessage = "Priority must be one of: Low, Medium, High, Critical.")]
    public string Priority { get; set; } = "Medium";
}

public class BroadcastNotificationRequest
{
    [Required(ErrorMessage = "Title is required.")]
    [MinLength(2, ErrorMessage = "Title must be at least 2 characters.")]
    [MaxLength(200, ErrorMessage = "Title cannot exceed 200 characters.")]
    public string Title { get; set; } = string.Empty;

    [Required(ErrorMessage = "Message is required.")]
    [MinLength(5, ErrorMessage = "Message must be at least 5 characters.")]
    [MaxLength(2000, ErrorMessage = "Message cannot exceed 2000 characters.")]
    public string Message { get; set; } = string.Empty;

    public string Category { get; set; } = "General";

    [RegularExpression("^(Low|Medium|High|Critical)$",
        ErrorMessage = "Priority must be one of: Low, Medium, High, Critical.")]
    public string Priority { get; set; } = "Medium";
}

public class NotifyRoleRequest
{
    [Required(ErrorMessage = "TargetRole is required.")]
    public string TargetRole { get; set; } = string.Empty;

    [Required(ErrorMessage = "Title is required.")]
    [MinLength(2), MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [Required(ErrorMessage = "Message is required.")]
    [MinLength(5), MaxLength(2000)]
    public string Message { get; set; } = string.Empty;

    [Required(ErrorMessage = "Category is required.")]
    [RegularExpression("^(WorkOrder|Inventory|Quality|Compliance|General)$",
        ErrorMessage = "Category must be one of: WorkOrder, Inventory, Quality, Compliance, General.")]
    public string Category { get; set; } = string.Empty;

    [RegularExpression("^(Low|Medium|High|Critical)$",
        ErrorMessage = "Priority must be one of: Low, Medium, High, Critical.")]
    public string Priority { get; set; } = "Medium";
}

// Change 2 + 5 + 6: full details in response
public class NotificationViewModel
{
    public int NotificationID { get; set; }
    public int UserID { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Status { get; set; } = string.Empty;
    public string Priority { get; set; } = string.Empty;
    public DateTime? ExpiryDate { get; set; }
    public DateTime? ReadDate { get; set; }
}

// Minimal projection for deserializing AuthService user responses
public class UserIdDto
{
    public int UserID { get; set; }
}

// Change 4: unread count broken down by category
public class UnreadCountViewModel
{
    public int Total { get; set; }
    public Dictionary<string, int> ByCategory { get; set; } = [];
}
