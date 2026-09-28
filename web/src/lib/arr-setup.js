/* eslint-disable-next-line @typescript-eslint/no-unused-expressions -- see bookmarklet.ts */
(async function watcharrSetup(cfg) {
  /* Runs inside the user's own Radarr or Sonarr page, from the "Add to Radarr / Sonarr" bookmark a
     result hands out. It is Askarr's one-click setup (the studio's other product, proven against a real
     Radarr 6.4 and Sonarr 4.0), saving this list's feed instead of Askarr's. That page's window.Radarr
     (or window.Sonarr) holds its API root and API key, and the key is only ever sent back to that same
     Radarr or Sonarr, never to Watcharr. Nothing outside this function is used: bookmarklet.ts turns this
     file's text into the bookmark, so no string may span lines and every statement ends in a semicolon. */
  const win = globalThis;
  const doc = win.document;
  const app = win.Radarr ? 'radarr' : win.Sonarr ? 'sonarr' : null;
  const g = app === 'radarr' ? win.Radarr : win.Sonarr;
  const label = app === 'sonarr' ? 'Sonarr' : 'Radarr';
  const dryRun = cfg.dryRun === true;
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

  /* A second click replaces the panel rather than stacking another, unless it is saving. */
  const previous = doc.getElementById('watcharr-setup');
  if (previous) {
    if (previous.dataset.busy === 'true') {
      previous.focus();
      return { ok: false, app, action: 'cancelled', message: 'Watcharr is still saving. Wait for it.' };
    }
    if (typeof previous.watcharrClose === 'function') previous.watcharrClose();
    else previous.remove();
  }

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

  function picker(text, role) {
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

  const profileSelect = picker('Quality Profile', 'profile');
  const folderSelect = picker('Root Folder', 'folder');
  const note = `${label} adds what is on the list, searches for it, and keeps checking the list for new titles.`;
  form.append(make('p', { color: colors.muted }, note));

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

  const save = button(`Add to ${label}`, 'save', true);
  const cancel = button('Cancel', 'cancel', false);
  const closeButton = button('Close', 'close', false);
  const remove = button(`Remove from ${label}`, 'remove', false);
  remove.style.color = colors.bad;

  let settle;
  let settled = false;
  let choose = () => {};
  const outcome = new Promise((resolve) => {
    settle = resolve;
  });

  function finish(ok, action, message) {
    if (settled) return;
    settled = true;
    settle({ ok, app, action, message });
  }

  function close() {
    doc.removeEventListener('keydown', onKey, true);
    panel.remove();
    finish(false, 'cancelled', 'Cancelled. Nothing was changed.');
    choose(false);
  }

  function onKey(event) {
    if (event.key !== 'Escape' || panel.dataset.busy === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  function say(text, color) {
    status.textContent = text;
    status.style.color = color || colors.muted;
    status.style.display = text ? 'block' : 'none';
  }

  function show(ok, action, message) {
    panel.dataset.busy = 'false';
    form.remove();
    say(message, ok ? colors.good : colors.bad);
    actions.replaceChildren(closeButton);
    closeButton.focus();
    finish(ok, action, message);
  }

  panel.watcharrClose = close;
  cancel.onclick = close;
  closeButton.onclick = close;
  actions.append(cancel);
  panel.append(title, ...(cfg.listTitle ? [which] : []), status, actions);
  doc.body.append(panel);
  doc.addEventListener('keydown', onKey, true);

  if (!app || !g || !g.apiRoot || !g.apiKey) {
    show(false, 'not-arr', 'Open your Radarr or Sonarr, then click the bookmark again there.');
    return outcome;
  }

  /* Radarr's and Sonarr's own API, with the key their page already holds. */
  async function api(path, init) {
    let response;
    try {
      response = await win.fetch(g.apiRoot + path, {
        ...init,
        headers: { 'X-Api-Key': g.apiKey, 'Content-Type': 'application/json' },
      });
    } catch {
      throw new Error(`Could not reach ${label}. Reload this page and try again.`);
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
    throw new Error(message || `${label} answered ${response.status}.`);
  }

  const send = (path, method, data) => api(path, { method, body: JSON.stringify(data) });
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

  say(`Loading your ${label} settings...`);
  const paths = ['/importlist/schema', '/importlist', '/qualityprofile', '/rootfolder'];
  let loaded;
  try {
    loaded = await Promise.all(paths.map((path) => api(path)));
  } catch (error) {
    if (!settled) show(false, 'added', `Could not read your ${label} settings. ${error.message}`);
    return outcome;
  }
  if (settled) return outcome;
  const [listSchema, lists, profiles, folders] = loaded.map(asArray);

  /* Radarr reads the movies as an RSS List, Sonarr the shows as a Custom List: the two lists the
     result page tells people to add by hand. */
  const kind = app === 'radarr' ? 'RSSImport' : 'CustomImport';
  const listUrl = app === 'radarr' ? cfg.radarrUrl : cfg.sonarrUrl;

  /* The field that holds the list's address: Radarr's RSS List calls it link and Sonarr's Custom List
     baseUrl (read off Radarr 6.4 and Sonarr 4.0). Read from the list itself, so a renamed field in a
     later version is still found. */
  function urlField(item) {
    const names = asArray(item && item.fields).map((field) => field.name);
    const known = names.find((name) => ['link', 'baseUrl', 'url'].includes(name));
    return known || names.find((name) => /url|link/i.test(name)) || (app === 'radarr' ? 'link' : 'baseUrl');
  }

  function isOurList(list) {
    return list.implementation === kind && norm(fieldValue(list, urlField(list))) === norm(listUrl);
  }

  const existing = lists.find(isOurList);
  const action = existing ? 'updated' : 'added';
  const listTemplate = listSchema.find((list) => list.implementation === kind);
  if (!existing && !listTemplate) {
    show(false, action, `This ${label} has no ${app === 'radarr' ? 'RSS List' : 'Custom List'}. Update it and try again.`);
    return outcome;
  }
  if (!profiles.length || !folders.length) {
    show(false, action, `Add a Quality Profile and a Root Folder in ${label} first.`);
    return outcome;
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

  fill(
    profileSelect,
    profiles.map((profile) => [String(profile.id), profile.name]),
    existing && existing.qualityProfileId,
  );
  fill(
    folderSelect,
    folders.map((folder) => [folder.path, folder.path]),
    existing && existing.rootFolderPath,
  );
  if (dryRun) say('Test run: nothing is saved.');
  else if (existing) say(`This list is already in ${label}. This updates it.`);
  else say('');
  panel.insertBefore(form, actions);
  /* Already set up here: the same bookmark can also take the list out again. */
  actions.replaceChildren(save, ...(existing ? [remove] : []), cancel);
  profileSelect.focus();

  const go = await new Promise((resolve) => {
    choose = resolve;
    save.onclick = () => resolve('save');
    remove.onclick = () => resolve('remove');
  });
  if (!go || settled) return outcome;

  panel.dataset.busy = 'true';
  for (const control of [profileSelect, folderSelect, save, remove, cancel]) {
    control.disabled = true;
    control.style.opacity = '0.6';
  }

  if (go === 'remove') {
    say(dryRun ? `Testing in ${label}...` : `Removing from ${label}...`);
    try {
      if (!dryRun) await api(`/importlist/${existing.id}`, { method: 'DELETE' });
    } catch (error) {
      show(false, 'removed', `${label} did not remove it. ${error.message}`);
      return outcome;
    }
    const gone = dryRun
      ? `Test passed. The list would be removed from ${label}. Nothing was changed.`
      : `Removed. ${label} no longer reads this list. What it already added stays.`;
    show(true, 'removed', gone);
    return outcome;
  }
  say(dryRun ? `Testing in ${label}...` : `Saving in ${label}...`);

  /* Radarr starts a new list with Search on Add off, and Sonarr with Search for Missing off and
     Monitor unset: without these a title would be added and never downloaded. Sonarr's list has no
     Enable switch. */
  const list = clone(existing || listTemplate);
  delete list.presets;
  const name = `Watcharr: ${String(cfg.listTitle || 'IMDb list').slice(0, 60)}`;
  list.name = existing && existing.name ? existing.name : freeName(lists, name);
  setField(list, urlField(list), listUrl);
  list.qualityProfileId = Number(profileSelect.value);
  list.rootFolderPath = folderSelect.value;
  if (!Array.isArray(list.tags)) list.tags = [];
  if (app === 'radarr') {
    list.enabled = true;
    list.enableAuto = true;
    list.searchOnAdd = true;
    list.monitor = 'movieOnly';
    list.minimumAvailability = (existing && existing.minimumAvailability) || 'released';
  } else {
    list.enableAutomaticAdd = true;
    list.searchForMissingEpisodes = true;
    list.shouldMonitor = 'all';
    list.monitorNewItems = 'all';
    list.seasonFolder = existing ? existing.seasonFolder !== false : true;
    list.seriesType = (existing && existing.seriesType) || 'standard';
  }

  let listId = existing ? existing.id : null;
  try {
    if (dryRun) await send('/importlist/test', 'POST', list);
    else if (existing) await send(`/importlist/${existing.id}`, 'PUT', list);
    else {
      const saved = await send('/importlist', 'POST', list);
      listId = saved && saved.id;
    }
  } catch (error) {
    show(false, action, `${label} did not save the list. ${error.message}`);
    return outcome;
  }

  /* Read the list now rather than at the next sync, which can be hours away. */
  if (!dryRun) {
    const command = { name: 'ImportListSync' };
    if (listId) command.definitionId = listId;
    try {
      await send('/command', 'POST', command);
    } catch {
      /* Not fatal: the list is still read on the app's own schedule. */
    }
  }

  const done = dryRun
    ? `Test passed. ${label} can read this list. Nothing was saved.`
    : `Done. ${label} is adding what is on the list now, and checks it for new titles from here on.`;
  show(true, action, done);
  return outcome;
});
