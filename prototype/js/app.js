import * as store from './lib/store.js';
import * as today from './views/today.js';
import * as students from './views/students.js';
import * as marking from './views/marking.js';
import * as messages from './views/messages.js';
import * as exhibits from './views/exhibits.js';
import * as report from './views/report.js';
import * as policy from './views/policy.js';

// [route, label, brief step, view]
export const ROUTES = [
  ['today', 'Today', '1-3', today],
  ['students', 'Briefings', '4-5', students],
  ['messages', 'Messages', '6-7', messages],
  ['marking', 'Marking', '8', marking],
  ['exhibits', 'Records', 'Ex 1-3', exhibits],
  ['report', 'Daily report', 'Phase 5', report],
  ['policy', 'Policy', '', policy],
];

const main = document.getElementById('main');
const nav = document.getElementById('nav');

function parse() {
  const [route, ...params] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { route: route || 'today', params };
}

function renderNav(active) {
  nav.innerHTML = ROUTES.map(([id, label, step]) =>
    `<a href="#/${id}" class="${id === active ? 'active' : ''}"><span>${label}</span>${step ? `<small>${step}</small>` : ''}</a>`).join('');
}

function render() {
  const { route, params } = parse();
  const entry = ROUTES.find(r => r[0] === route) || ROUTES[0];
  renderNav(entry[0]);
  entry[3].render(main, params);
}

window.addEventListener('hashchange', () => { render(); main.focus(); });
store.subscribe(render);
render();
