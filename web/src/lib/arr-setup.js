/* Runs inside the user's own Radarr or Sonarr page, from the "Add to Radarr / Sonarr" bookmark a
   result hands out. It is Askarr's one-click setup (the studio's other product, proven against a real
   Radarr 6.4 and Sonarr 4.0), saving this list instead of Askarr's. That page's window.Radarr
   (or window.Sonarr) holds its API root and API key, and the key is only ever sent back to that same
   Radarr or Sonarr, never to Watcharr. bookmarklet.ts wraps this file's text in a function that returns
   watcharrSetup and calls it with the list's config, so everything the setup uses is declared here, and
   no string may span lines and every statement ends in a semicolon. */
const win = globalThis;
const doc = win.document;
const colors = {
  card: '#1f1f1f',
  field: '#2a2a2a',
  border: '#333333',
  text: '#ffffff',
  muted: '#a8a8a8',
  accent: '#f5c518',
  accentText: '#000000',
  good: '#4fcf8e',
  bad: '#ff6f61',
};
const reset = {
  boxSizing: 'border-box',
  margin: '0',
  padding: '0',
  border: '0',
  background: 'none',
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'normal',
  textAlign: 'start',
  textTransform: 'none',
};

function make(tag, style, text) {
  const node = doc.createElement(tag);
  Object.assign(node.style, reset, style);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, role, primary) {
  const style = {
    minHeight: '40px',
    padding: '8px 16px',
    border: `1px solid ${primary ? colors.accent : colors.border}`,
    borderRadius: '10px',
    background: primary ? colors.accent : 'transparent',
    color: primary ? colors.accentText : colors.text,
    fontWeight: '600',
    cursor: 'pointer',
  };
  const node = make('button', style, text);
  node.type = 'button';
  node.dataset.watcharr = role;
  return node;
}

function picker(form, text, role) {
  const select = make('select', {
    width: '100%',
    minHeight: '42px',
    padding: '8px 10px',
    border: `1px solid ${colors.border}`,
    borderRadius: '10px',
    background: colors.field,
    color: colors.text,
    fontSize: '16px',
    cursor: 'pointer',
  });
  select.dataset.watcharr = role;
  const wrap = make('label', { display: 'flex', flexDirection: 'column', gap: '6px' });
  wrap.append(make('span', { fontWeight: '600' }, text), select);
  form.append(wrap);
  return select;
}

function say(s, text, color) {
  const { status } = s.ui;
  status.textContent = text;
  status.style.color = color || colors.muted;
  status.style.display = text ? 'block' : 'none';
}

/* Whoever settles first decides the outcome; later calls change nothing. */
function finish(s, ok, action, message) {
  if (s.settled) return;
  s.settled = true;
  s.settle({ ok, app: s.app, action, message });
}

function show(s, ok, action, message) {
  const { panel, form, actions, closeButton } = s.ui;
  panel.dataset.busy = 'false';
  form.remove();
  say(s, message, ok ? colors.good : colors.bad);
  actions.replaceChildren(closeButton);
  closeButton.focus();
  finish(s, ok, action, message);
}

function closePanel(s) {
  doc.removeEventListener('keydown', s.onKey, true);
  s.ui.panel.remove();
  finish(s, false, 'cancelled', 'Cancelled. Nothing was changed.');
  s.choose(false);
}

/* A second click replaces the panel rather than stacking another, unless it is saving. Returns the
   message to stop with when the earlier panel is still saving. */
function clearPrevious() {
  const previous = doc.getElementById('watcharr-setup');
  if (!previous) return null;
  if (previous.dataset.busy === 'true') {
    previous.focus();
    return 'Watcharr is still saving. Wait for it.';
  }
  if (typeof previous.watcharrClose === 'function') previous.watcharrClose();
  else previous.remove();
  return null;
}

function buildPanel(s) {
  const { cfg, app, label } = s;
  const panel = make('section', {
    position: 'fixed',
    insetBlockStart: '16px',
    insetInlineEnd: '16px',
    zIndex: '2147483647',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '360px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 32px)',
    overflowY: 'auto',
    padding: '20px',
    border: `1px solid ${colors.border}`,
    borderRadius: '14px',
    background: colors.card,
    color: colors.text,
    boxShadow: '0 24px 48px -12px rgb(0 0 0 / 0.6)',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontSize: '14px',
    lineHeight: '1.5',
  });
  panel.id = 'watcharr-setup';
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'watcharr-setup-title');

  const title = make(
    'h2',
    { fontSize: '17px', fontWeight: '600', lineHeight: '1.3' },
    app ? `Add this list to ${label}` : 'Add to Radarr or Sonarr',
  );
  title.id = 'watcharr-setup-title';
  const which = make('p', { color: colors.muted, overflowWrap: 'anywhere' }, cfg.listTitle || '');
  const status = make('p', { color: colors.muted });
  status.setAttribute('role', 'status');
  const form = make('div', { display: 'flex', flexDirection: 'column', gap: '12px' });
  const actions = make('div', { display: 'flex', flexWrap: 'wrap', gap: '8px' });
  const profileSelect = picker(form, 'Quality Profile', 'profile');
  const folderSelect = picker(form, 'Root Folder', 'folder');
  const note = `${label} adds what is on the list, searches for it, and checks the list every ${s.minutes} minutes.`;
  form.append(make('p', { color: colors.muted }, note));

  const save = button(`Add to ${label}`, 'save', true);
  const cancel = button('Cancel', 'cancel', false);
  const closeButton = button('Close', 'close', false);
  const remove = button(`Remove from ${label}`, 'remove', false);
  remove.style.color = colors.bad;
  actions.append(cancel);
  panel.append(title, ...(cfg.listTitle ? [which] : []), status, actions);
  return { panel, status, form, actions, profileSelect, folderSelect, save, cancel, closeButton, remove };
}

function openPanel(s) {
  const done = Promise.withResolvers();
  s.outcome = done.promise;
  s.settle = done.resolve;
  s.settled = false;
  s.choose = () => {};
  s.ui = buildPanel(s);
  s.onKey = (event) => {
    if (event.key !== 'Escape' || s.ui.panel.dataset.busy === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    closePanel(s);
  };
  s.ui.panel.watcharrClose = () => closePanel(s);
  s.ui.cancel.onclick = () => closePanel(s);
  s.ui.closeButton.onclick = () => closePanel(s);
  doc.body.append(s.ui.panel);
  doc.addEventListener('keydown', s.onKey, true);
}

/* Radarr's and Sonarr's own API, with the key their page already holds. */
async function api(s, path, init) {
  let response;
  try {
    response = await win.fetch(s.g.apiRoot + path, {
      ...init,
      headers: { 'X-Api-Key': s.g.apiKey, 'Content-Type': 'application/json' },
    });
  } catch {
    throw new Error(`Could not reach ${s.label}. Reload this page and try again.`);
  }
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      /* Not JSON: the status code says enough. */
    }
  }
  if (response.ok) return body;
  /* A 400 is a list of { propertyName, errorMessage }: the same words the app's own form shows. */
  const problems = Array.isArray(body) ? body.map((item) => item && item.errorMessage) : [];
  const message = problems.filter(Boolean).join(' ') || (body && body.message);
  throw new Error(message || `${s.label} answered ${response.status}.`);
}

const send = (s, path, method, data) => api(s, path, { method, body: JSON.stringify(data) });
const asArray = (body) => (Array.isArray(body) ? body : []);
const clone = (value) => JSON.parse(JSON.stringify(value));

function norm(value) {
  const text = String(value || '').trim();
  return text.toLowerCase().replace(/\/+$/, '');
}

function fieldValue(item, name) {
  const field = asArray(item.fields).find((entry) => entry.name === name);
  return field ? field.value : undefined;
}

function setField(item, name, value) {
  if (!Array.isArray(item.fields)) item.fields = [];
  const field = item.fields.find((entry) => entry.name === name);
  if (field) field.value = value;
  else item.fields.push({ name, value });
}

function freeName(items, base) {
  const taken = items.map((item) => norm(item.name));
  let name = base;
  for (let n = 2; taken.includes(norm(name)); n += 1) name = `${base} ${n}`;
  return name;
}

/* The field that holds an old list's address: Radarr's RSS List calls it link and Sonarr's Custom
   List baseUrl (read off Radarr 6.4 and Sonarr 4.0). */
function urlField(item) {
  const names = asArray(item && item.fields).map((field) => field.name);
  return names.find((name) => ['baseUrl', 'link', 'url'].includes(name)) || 'baseUrl';
}

const ours = (listUrl, implementation) => (list) =>
  list.implementation === implementation && norm(fieldValue(list, urlField(list))) === norm(listUrl);

/* What the app already holds, read once. Null once the panel has said why it cannot go on. */
async function loadSettings(s) {
  say(s, `Loading your ${s.label} settings...`);
  const paths = ['/importlist/schema', '/importlist', '/qualityprofile', '/rootfolder'];
  let loaded;
  try {
    loaded = await Promise.all(paths.map((path) => api(s, path)));
  } catch (error) {
    if (!s.settled) show(s, false, 'added', `Could not read your ${s.label} settings. ${error.message}`);
    return null;
  }
  if (s.settled) return null;
  const [listSchema, lists, profiles, folders] = loaded.map(asArray);
  return { listSchema, lists, profiles, folders };
}

/* The app's own list type (Radarr's "Radarr", Sonarr's "Sonarr": importing from another Radarr or
   Sonarr), which it re-reads every 15 or 5 minutes. The list's link is its Full URL, and Watcharr
   answers there as a Radarr or Sonarr would. The same link set up the older way, as an RSS List (read
   every 12 hours) or a Custom List (every 6), is swapped for it. */
function findLists(s, data) {
  const radarr = s.app === 'radarr';
  const kind = radarr ? 'RadarrImport' : 'SonarrImport';
  const oldKind = radarr ? 'RSSImport' : 'CustomImport';
  const listUrl = radarr ? s.cfg.radarrUrl : s.cfg.sonarrUrl;
  const existing = data.lists.find(ours(listUrl, kind));
  const old = data.lists.find(ours(listUrl, oldKind));
  const action = existing || old ? 'updated' : 'added';
  const template = data.listSchema.find((list) => list.implementation === kind);
  const found = { existing, old, action, template, listUrl, oldName: radarr ? 'an RSS List' : 'a Custom List' };
  if (!existing && !template) {
    show(s, false, action, `This ${s.label} cannot import from another ${s.label}. Update it and try again.`);
    return null;
  }
  if (!data.profiles.length || !data.folders.length) {
    show(s, false, action, `Add a Quality Profile and a Root Folder in ${s.label} first.`);
    return null;
  }
  return found;
}

/* The user's own profiles and folders, the list's current pick first chosen. */
function fill(select, options, current) {
  for (const [value, text] of options) {
    const option = make('option', { background: colors.field, color: colors.text }, text);
    option.value = value;
    select.append(option);
  }
  const values = options.map(([value]) => value);
  select.value = values.includes(String(current)) ? String(current) : values[0];
}

function fillForm(s, data, found) {
  const { existing, old } = found;
  const { profileSelect, folderSelect, panel, form, actions, save, remove, cancel } = s.ui;
  const keep = existing || old || {};
  fill(
    profileSelect,
    data.profiles.map((profile) => [String(profile.id), profile.name]),
    keep.qualityProfileId,
  );
  fill(
    folderSelect,
    data.folders.map((folder) => [folder.path, folder.path]),
    keep.rootFolderPath,
  );
  let line = '';
  if (s.dryRun) line = 'Test run: nothing is saved.';
  else if (existing) line = `This list is already in ${s.label}. This updates it.`;
  else if (old) line = `This list is in ${s.label} as ${found.oldName}. This swaps it for ${s.label}'s own list type, read every ${s.minutes} minutes.`;
  say(s, line);
  panel.insertBefore(form, actions);
  /* Already set up here: the same bookmark can also take the list out again. */
  actions.replaceChildren(save, ...(existing || old ? [remove] : []), cancel);
  profileSelect.focus();
}

async function waitForChoice(s) {
  const picked = Promise.withResolvers();
  s.choose = picked.resolve;
  s.ui.save.onclick = () => picked.resolve('save');
  s.ui.remove.onclick = () => picked.resolve('remove');
  return picked.promise;
}

function lockForm(s) {
  const { panel, profileSelect, folderSelect, save, remove, cancel } = s.ui;
  panel.dataset.busy = 'true';
  for (const control of [profileSelect, folderSelect, save, remove, cancel]) {
    control.disabled = true;
    control.style.opacity = '0.6';
  }
}

async function removeLists(s, found) {
  say(s, s.dryRun ? `Testing in ${s.label}...` : `Removing from ${s.label}...`);
  try {
    for (const list of s.dryRun ? [] : [found.existing, found.old].filter(Boolean)) {
      await api(s, `/importlist/${list.id}`, { method: 'DELETE' });
    }
  } catch (error) {
    show(s, false, 'removed', `${s.label} did not remove it. ${error.message}`);
    return;
  }
  const gone = s.dryRun
    ? `Test passed. The list would be removed from ${s.label}. Nothing was changed.`
    : `Removed. ${s.label} no longer reads this list. What it already added stays.`;
  show(s, true, 'removed', gone);
}

/* Radarr starts a new list with Search on Add off, and Sonarr with Search for Missing off and
   Monitor unset: without these a title would be added and never downloaded. Sonarr's list has no
   Enable switch. */
function applyRadarrDefaults(list, existing) {
  list.enabled = true;
  list.enableAuto = true;
  list.searchOnAdd = true;
  list.monitor = 'movieOnly';
  list.minimumAvailability = (existing && existing.minimumAvailability) || 'released';
}

function applySonarrDefaults(list, existing) {
  list.enableAutomaticAdd = true;
  list.searchForMissingEpisodes = true;
  list.shouldMonitor = 'all';
  list.monitorNewItems = 'all';
  list.seasonFolder = existing ? existing.seasonFolder !== false : true;
  list.seriesType = (existing && existing.seriesType) || 'standard';
}

function buildList(s, data, found) {
  const { existing, old, template, listUrl } = found;
  const list = clone(existing || template);
  delete list.presets;
  const name = `Watcharr: ${String(s.cfg.listTitle || 'IMDb list').slice(0, 60)}`;
  const keep = existing || old;
  list.name = keep && keep.name ? keep.name : freeName(data.lists, name);
  setField(list, 'baseUrl', listUrl);
  /* The list is public: Watcharr takes any key, but the app's form wants one. */
  setField(list, 'apiKey', 'watcharr');
  /* Empty filters mean everything on the list. */
  const filters = ['profileIds', 'tagIds', 'rootFolderPaths'];
  if (s.app === 'sonarr') filters.push('languageProfileIds');
  for (const filter of filters) setField(list, filter, []);
  list.qualityProfileId = Number(s.ui.profileSelect.value);
  list.rootFolderPath = s.ui.folderSelect.value;
  if (!Array.isArray(list.tags)) list.tags = [];
  if (s.app === 'radarr') applyRadarrDefaults(list, existing);
  else applySonarrDefaults(list, existing);
  return list;
}

/* Save the list (or only test it). Returns the saved list's id (null for a test), or the error that stopped it. */
async function persist(s, list, existing) {
  try {
    if (s.dryRun) {
      await send(s, '/importlist/test', 'POST', list);
      return null;
    }
    if (existing) {
      await send(s, `/importlist/${existing.id}`, 'PUT', list);
      return existing.id;
    }
    const saved = await send(s, '/importlist', 'POST', list);
    return saved && saved.id;
  } catch (error) {
    return error;
  }
}

/* The slower copy of the same link goes once the new one is saved, so the list is never missing in
   between. True when it is gone or there was none. */
async function dropOlder(s, found) {
  if (!found.old || s.dryRun) return true;
  try {
    await api(s, `/importlist/${found.old.id}`, { method: 'DELETE' });
    return true;
  } catch (error) {
    const kept = found.oldName.replace(/^an? /, '');
    show(s, false, found.action, `The new list is saved, but ${s.label} kept the old ${kept} too: remove it by hand. ${error.message}`);
    return false;
  }
}

/* Read the list now rather than at the next sync. */
async function syncNow(s, listId) {
  if (s.dryRun) return;
  const command = { name: 'ImportListSync' };
  if (listId) command.definitionId = listId;
  try {
    await send(s, '/command', 'POST', command);
  } catch {
    /* Not fatal: the list is still read on the app's own schedule. */
  }
}

async function saveList(s, data, found) {
  say(s, s.dryRun ? `Testing in ${s.label}...` : `Saving in ${s.label}...`);
  const result = await persist(s, buildList(s, data, found), found.existing);
  if (result instanceof Error) {
    show(s, false, found.action, `${s.label} did not save the list. ${result.message}`);
    return;
  }
  if (!(await dropOlder(s, found))) return;
  await syncNow(s, result);
  const done = s.dryRun
    ? `Test passed. ${s.label} can read this list. Nothing was saved.`
    : `Done. ${s.label} is adding what is on the list now, and checks it every ${s.minutes} minutes.`;
  show(s, true, found.action, done);
}

async function watcharrSetup(cfg) {
  const app = win.Radarr ? 'radarr' : win.Sonarr ? 'sonarr' : null;
  const g = app === 'radarr' ? win.Radarr : win.Sonarr;
  const s = { cfg, app, g, label: app === 'sonarr' ? 'Sonarr' : 'Radarr', dryRun: cfg.dryRun === true, minutes: app === 'sonarr' ? '5' : '15' };
  const earlier = clearPrevious();
  if (earlier) return { ok: false, app, action: 'cancelled', message: earlier };
  openPanel(s);
  if (!app || !g || !g.apiRoot || !g.apiKey) {
    show(s, false, 'not-arr', 'Open your Radarr or Sonarr, then click the bookmark again there.');
    return s.outcome;
  }
  const data = await loadSettings(s);
  const found = data && findLists(s, data);
  if (!found) return s.outcome;
  fillForm(s, data, found);
  const go = await waitForChoice(s);
  if (!go || s.settled) return s.outcome;
  lockForm(s);
  if (go === 'remove') await removeLists(s, found);
  else await saveList(s, data, found);
  return s.outcome;
}
