// Student uploads photos/scans of a finished test. Owner A.
// Images are downscaled in the browser before saving. QR / clarity checks are not built yet,
// so submissions are honestly marked "not checked".
import { esc, chip, banner, errorBanner, fmtDateTime, requestGate } from '../../../packages/ui/components/html.js';

const STATUS_TONE = { queued: 'info', marked: 'good', exception: 'bad' };

async function downscale(file, maxEdge) {
  if (!file.type.startsWith('image/')) return { blob: file, name: file.name, type: file.type };
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.82));
  return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg', type: 'image/jpeg' };
}

export function render(el, params, ctx) {
  let tests = [];
  let policy = null;
  let pages = [];   // [{ blob, name, type, url }]
  let testId = '';
  let attempt = '';
  let busy = false;        // saving: whole form locked
  let processing = false;  // resizing photos: submit and new selections locked
  let message = '';

  el.innerHTML = `
    <div class="page-head"><h1>Upload a test</h1><p class="lede">Take a clear photo of every page, in order. Your tutor marks it and the results appear in your mistake bank.</p></div>
    <div class="grid-2">
      <section class="card"><div class="card-body" id="form"><div class="loading">Loading…</div></div></section>
      <section class="card"><div class="card-head"><h2>My uploads</h2></div><div class="card-body" id="mine"></div></section>
    </div>`;
  const form = el.querySelector('#form');
  const mine = el.querySelector('#mine');
  const revokeAll = () => pages.forEach(p => p.url && URL.revokeObjectURL(p.url));

  function paintForm() {
    const lim = policy.upload;
    form.innerHTML = `
      ${message}
      <fieldset ${busy ? 'disabled' : ''} style="border:0;padding:0;margin:0">
      <label class="field">Test<select id="test"><option value="">Choose…</option>${tests.map(t =>
        `<option value="${t.id}"${t.id === testId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <label class="field">Which attempt is this?<input id="attempt" type="number" min="1" step="1" value="${esc(attempt)}">
        <span class="muted" style="font-weight:400">Your tutor confirms the attempt number when marking.</span></label>
      <div class="drop"><i class="ti ti-camera" aria-hidden="true"></i>
        <label class="btn">${processing ? 'Preparing photos…' : 'Add pages'}<input id="files" type="file" accept="image/*" capture="environment" multiple class="sr-only" ${processing || pages.length >= lim.maxPages ? 'disabled' : ''}></label>
        <p class="muted">Up to ${lim.maxPages} pages · photos are resized before saving</p></div>
      <div class="pages-grid">${pages.map((p, i) => `<figure><img src="${p.url}" alt="Page ${i + 1}">
        <figcaption>Page ${i + 1}<button type="button" data-remove="${i}">Remove</button></figcaption></figure>`).join('')}</div>
      <p>${chip('QR / clarity check: not built yet - your tutor will check the pages', 'warn')}</p>
      </fieldset>
      <div class="actions"><button class="btn btn-primary" id="submit" ${busy || processing ? 'disabled' : ''}>${busy ? 'Saving…' : 'Submit for marking'}</button></div>`;

    form.querySelector('#test').addEventListener('change', e => {
      if (busy) return;
      testId = e.target.value;
      const t = tests.find(x => x.id === testId);
      attempt = t ? String(t.nextAttempt) : '';
      paintForm();
    });
    form.querySelector('#attempt').addEventListener('input', e => { attempt = e.target.value; });
    form.querySelector('#files').addEventListener('change', async e => {
      if (busy || processing) return;
      const files = [...e.target.files];
      processing = true; message = ''; paintForm();
      for (const f of files) {
        if (pages.length >= lim.maxPages) { message = banner(`Only ${lim.maxPages} pages allowed - extra files were skipped.`, 'warn'); break; }
        try {
          const out = await downscale(f, lim.maxLongEdge);
          if (ctx.signal.aborted) return; // page left: do not create URLs that cleanup will never revoke
          if (out.blob.size > lim.maxPageBytes) { message = banner(`${esc(f.name)} is still too large. Try a smaller photo.`, 'warn'); continue; }
          pages.push({ ...out, url: URL.createObjectURL(out.blob) });
        } catch { if (ctx.signal.aborted) return; message = banner(`${esc(f.name)} could not be read as an image.`, 'bad'); }
      }
      processing = false;
      if (ctx.signal.aborted) return;
      paintForm();
    });
    form.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
      if (busy || processing) return;
      const [p] = pages.splice(+b.dataset.remove, 1);
      URL.revokeObjectURL(p.url);
      paintForm();
    }));
    form.querySelector('#submit').addEventListener('click', submit);
  }

  async function submit() {
    if (busy || processing) return;
    if (!testId) { message = banner('Choose which test this is.', 'bad'); paintForm(); return; }
    if (!pages.length) { message = banner('Add at least one page.', 'bad'); paintForm(); return; }
    const a = String(attempt).trim();
    if (a && !/^[1-9]\d*$/.test(a)) { message = banner('Attempt must be a whole number like 1 or 2.', 'bad'); paintForm(); return; }
    const sent = pages.slice(); // exactly the pages being saved
    busy = true; message = ''; paintForm();
    try {
      await ctx.api.submitTest({ testId, suggestedAttempt: a ? Number(a) : null, files: sent.map(({ blob, name, type }) => ({ blob, name, type })) });
      if (ctx.signal.aborted) return;
      sent.forEach(p => URL.revokeObjectURL(p.url));
      pages = pages.filter(p => !sent.includes(p)); testId = ''; attempt = '';
      message = banner('Submitted. Your tutor will mark it soon.', 'good');
    } catch (e) {
      // Keep the selected pages so the student can retry.
      message = errorBanner(e);
    }
    busy = false;
    if (!ctx.signal.aborted) paintForm();
  }

  const gate = requestGate(ctx.signal);
  async function loadMine() {
    const current = gate();
    try {
      const rows = await ctx.api.listMySubmissions();
      if (!current()) return;
      mine.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Test</th><th>Sent</th><th>Status</th></tr></thead><tbody>
        ${rows.map(s => `<tr><td>${esc(s.testName)}${s.attempt ? ` <span class="muted">· attempt ${s.attempt}</span>` : ''}</td><td>${esc(fmtDateTime(s.submittedAt))}</td>
          <td>${chip(s.status === 'queued' ? 'Waiting for marking' : s.status === 'marked' ? 'Marked' : 'Problem - please re-upload', STATUS_TONE[s.status])}
          ${s.exception ? `<div class="muted">${esc(s.exception)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="empty">Nothing uploaded yet.</p>';
    } catch (e) { if (current()) mine.innerHTML = errorBanner(e); }
  }

  (async () => {
    try {
      const [t, r] = await Promise.all([ctx.api.listMyTests(), ctx.api.reference()]);
      if (ctx.signal.aborted) return;
      tests = t; policy = r.policy; paintForm();
    } catch (e) { if (!ctx.signal.aborted) form.innerHTML = errorBanner(e); }
  })();
  loadMine();
  ctx.subscribe(loadMine);
  return revokeAll;
}
