import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/setup/setup-page').then((m) => m.SetupPage),
    title: 'Arcade Basketball',
  },
  {
    path: 'game',
    loadComponent: () =>
      import('./features/game/game-page').then((m) => m.GamePage),
    title: 'Game On',
  },
  {
    path: 'results',
    loadComponent: () =>
      import('./features/results/results-page').then((m) => m.ResultsPage),
    title: 'Results',
  },
  { path: '**', redirectTo: '' },
];
