import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ApiResponse } from './product.service';

export interface NotificationViewModel {
  notificationID: number;
  userID: number;
  title: string;
  message: string;
  category: string;
  status: string;
  priority: string;
  createdDate: string;
  readDate?: string;
}


@Injectable({ providedIn: 'root' })
export class NotificationAdminService {
  private readonly base = 'http://localhost:5000/api/v1/notifications';

  constructor(private http: HttpClient) {}

  getAll(): Observable<ApiResponse<NotificationViewModel[]>> {
    return this.http.get<ApiResponse<NotificationViewModel[]>>(this.base);
  }

  cleanup(): Observable<ApiResponse<any>> {
    return this.http.delete<ApiResponse<any>>(`${this.base}/cleanup`);
  }

  broadcast(req: { title: string; message: string; priority: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.base}/broadcast`, req);
  }

  notifyRole(req: { targetRole: string; title: string; message: string; category: string; priority: string }): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.base}/notify-role`, req);
  }
}
