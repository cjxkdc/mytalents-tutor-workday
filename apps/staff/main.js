import { createMockApi, demoUsers, storage } from '../../packages/contract/mock-api.js';
import { createRouter } from '../../packages/ui/router.js';
import { mountChrome } from '../../packages/ui/layout.js';
import { toast } from '../../packages/ui/components/html.js';
import { routes } from './routes.js';

const KEY = 'staff.identity';
const readId = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const saveId = id => { try { localStorage.setItem(KEY, id); } catch { /* demo convenience only */ } };

let user = demoUsers.staff.find(u => u.id === readId()) || demoUsers.staff[0];
let api = createMockApi(user);

const chrome = mountChrome(document.getElementById('chrome'), {
  brandHref: '#/home', brandMark: 'TW', brandName: 'Tutor Workday', brandSub: 'Staff portal',
  identity: {
    options: demoUsers.staff.map(u => ({ id: u.id, label: `${u.name} (${u.role})` })),
    onChange(id) { user = demoUsers.staff.find(u => u.id === id); api = createMockApi(user); saveId(id); router.refresh(); },
  },
  demoNote: storage.kind === 'sheets' ? 'Demo mode - synthetic data stored in the shared Google Sheet.' : 'Demo mode - mock data stored in this browser only.',
  async onReset() {
    const msg = storage.kind === 'sheets' ? 'Reset ALL data in the shared Google Sheet? Every tab is overwritten with demo data.' : 'Reset all demo data in this browser?';
    if (!confirm(msg)) return;
    await api.resetDemo(); toast('Demo data reset');
  },
});
chrome.setIdentity(user.id);

const router = createRouter({
  mount: document.getElementById('main'),
  routes,
  defaultRoute: 'home',
  getContext: () => ({ api, user, toast, routes }),
  onRoute(route, u) {
    chrome.setNav(routes.filter(r => r.nav && (!r.roles || r.roles.includes(u.role))), route.id);
    document.title = `${route.label} · Tutor Workday Staff`;
  },
});
router.show();
