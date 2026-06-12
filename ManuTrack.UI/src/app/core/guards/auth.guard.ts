import { Injectable } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private router: Router) {}

  canActivate(route: ActivatedRouteSnapshot): boolean {
    if (!this.auth.isLoggedIn()) {
      this.router.navigate(['/login'], { replaceUrl: true });
      return false;
    }

    const dashboard = this.auth.getDashboardRoute();
    const requestedPath = '/' + route.routeConfig?.path;

    if (requestedPath !== dashboard) {
      this.router.navigate([dashboard], { replaceUrl: true });
      return false;
    }

    return true;
  }
}
