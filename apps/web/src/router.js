import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router';
import { session } from './session.js';

const routes = [
  { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
  { path: '/login', name: 'login', component: () => import('./views/AuthView.vue'), props: { mode: 'login' } },
  { path: '/register', name: 'register', component: () => import('./views/AuthView.vue'), props: { mode: 'register' } },
  { path: '/account', name: 'account', component: () => import('./views/AccountView.vue'), meta: { auth: true } },
  { path: '/new', name: 'new-catalogue', component: () => import('./views/NewCatalogueView.vue'), meta: { auth: true } },
  {
    path: '/c/:slug',
    component: () => import('./views/CatalogueView.vue'),
    props: true,
    children: [
      { path: '', name: 'dex', component: () => import('./views/DexView.vue') },
      { path: 'families', name: 'families', component: () => import('./views/FamiliesView.vue') },
      { path: 'map', name: 'map', component: () => import('./views/MapView.vue') },
      { path: 'recent', name: 'recent', component: () => import('./views/RecentView.vue') },
      { path: 'log', name: 'log', component: () => import('./views/LogSightingView.vue'), meta: { auth: true } },
      { path: 'settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { auth: true } },
      {
        path: 'species/:speciesId(\\d+)',
        name: 'species',
        component: () => import('./views/SpeciesView.vue'),
        props: (route) => ({ speciesId: Number(route.params.speciesId) }),
      },
    ],
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('./views/NotFoundView.vue') },
];

export const router = createRouter({
  // The demo is hosted on GitHub Pages, which can't route deep links, so it uses #/ URLs.
  history: import.meta.env.VITE_DEMO === 'true' ? createWebHashHistory() : createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, saved) {
    if (saved) return saved;
    if (to.hash) return { el: to.hash, top: 16 };
    return { top: 0 };
  },
});

router.beforeEach((to) => {
  if (to.matched.some((r) => r.meta.auth) && !session.user) {
    return { name: 'login', query: { next: to.fullPath } };
  }
  return true;
});
