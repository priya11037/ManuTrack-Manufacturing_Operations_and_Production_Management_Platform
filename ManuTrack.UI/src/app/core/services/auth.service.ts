import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { timeout } from 'rxjs/operators';

export const ROLE_ROUTES: Record<string, string> = {
  'Admin':             '/admin',
  'Planner':           '/planner',
  'Operator':          '/operator',
  'InventoryManager':  '/inventory-manager',
  'Inspector':         '/quality-inspector',
  'ComplianceOfficer': '/compliance-officer'
};

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  message: string;
  data: {
    token: string;
    role: string;
    name: string;
    userId: number;
    email: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly apiUrl = 'http://localhost:5000/api/v1/auth';

  constructor(private http: HttpClient) {}

  login(credentials: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, credentials).pipe(
      timeout(8000),
      tap((res: LoginResponse) => {
        if (res?.success && res?.data) {
          localStorage.setItem('token',  res.data.token);
          localStorage.setItem('role',   res.data.role);
          localStorage.setItem('name',   res.data.name);
          localStorage.setItem('userId', String(res.data.userId));
          localStorage.setItem('email',  res.data.email);
        }
      })
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<any> {
    return this.http.put(`${this.apiUrl}/change-password`, { currentPassword, newPassword });
  }

  logout(): void {
    localStorage.clear();
  }

  isTokenExpired(): boolean {
    const token = localStorage.getItem('token');
    if (!token) return true;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      // exp is in seconds; Date.now() is in milliseconds
      return payload.exp * 1000 < Date.now();
    } catch {
      return true;
    }
  }

  isLoggedIn(): boolean {
    if (!localStorage.getItem('token')) return false;
    if (this.isTokenExpired()) {
      this.logout();
      return false;
    }
    return true;
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getRole(): string | null {
    return localStorage.getItem('role');
  }

  getName(): string | null {
    return localStorage.getItem('name');
  }

  getDashboardRoute(): string {
    return ROLE_ROUTES[this.getRole() ?? ''] ?? '/login';
  }
}
