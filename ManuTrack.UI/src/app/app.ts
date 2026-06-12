import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('ManuTrack.UI');

  constructor() {
    // sessionStorage survives refresh but clears when the tab/browser is closed.
    // On a fresh run there is no flag, so we clear the stored auth and force login.
    if (!sessionStorage.getItem('appSession')) {
      localStorage.clear();
      sessionStorage.setItem('appSession', '1');
    }
  }
}
