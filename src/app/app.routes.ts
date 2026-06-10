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
  {
    path: 'back-to-back',
    loadComponent: () =>
      import('./features/back-to-back/back-to-back-page').then((m) => m.BackToBackPage),
    title: 'Back to Back',
  },
  {
    path: 'back-to-back/results',
    loadComponent: () =>
      import('./features/back-to-back/back-to-back-results-page').then(
        (m) => m.BackToBackResultsPage,
      ),
    title: 'Back to Back · Results',
  },
  { path: '**', redirectTo: '' },
];
