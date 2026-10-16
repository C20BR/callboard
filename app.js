(() => {
  const config = window.CALLBOARD_CONFIG || {};
  const initialAuthType = new URLSearchParams(`${location.search}&${location.hash.slice(1)}`).get('type');
  let authFlow = initialAuthType === 'invite' ? 'invite' : initialAuthType === 'recovery' ? 'recovery' : '';
  const configured = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('YOUR-') && !config.supabaseAnonKey.includes('YOUR_');
  const client = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, profile: null, isRosterAdmin: false, cast: [], types: [], sessions: [], records: [], statuses: new Map(), notes: new Map() };
  const statusValues = ['Here', 'Late', 'Absent', 'Exempt'];
  let toastTimer;

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }
  function errorMessage(error) { return error?.message || 'Something went wrong. Please try again.'; }
  function setConnection(online, label) {
    const el = $('#connection'); el.classList.toggle('online', online); el.lastChild.textContent = ` ${label}`;
  }
  function showAuth(message = '') {
    $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); $('#signout').classList.add('hidden');
    $('#login-form').classList.remove('hidden'); $('#setup-form').classList.add('hidden'); $('#recovery-form').classList.add('hidden');
    $('#auth-message').textContent = message; setConnection(false, 'Sign in to connect');
  }
  function showSetup(message = '') {
    $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); $('#signout').classList.remove('hidden');
    $('#login-form').classList.add('hidden'); $('#setup-form').classList.remove('hidden'); $('#recovery-form').classList.add('hidden');
    $('#setup-message').textContent = message; setConnection(true, 'Invitation ready');
  }
  function showRecovery(message = '') {
    $('#auth-view').classList.remove('hidden'); $('#app-view').classList.add('hidden'); $('#signout').classList.remove('hidden');
    $('#login-form').classList.add('hidden'); $('#setup-form').classList.add('hidden'); $('#recovery-form').classList.remove('hidden');
    $('#recovery-message').textContent = message; setConnection(true, 'Password reset');
  }
  async function showApp() {
    $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden'); $('#signout').classList.remove('hidden');
    $('#session-taker').value = state.profile?.username || ''; $('#session-taker').readOnly = true;
    $('#today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase();
    setConnection(true, 'Connected securely'); await loadData();
  }
  async function loadData() {
    setConnection(false, 'Syncing');
    const results = await Promise.all([
      client.from('cast_members').select('*').order('name'),
      client.from('rehearsal_types').select('*').order('is_builtin', { ascending: false }).order('name'),
      client.from('rehearsal_sessions').select('*').order('rehearsal_date', { ascending: false }).order('created_at', { ascending: false }),
      client.from('attendance_records').select('*, cast_members(id,name,characters)')
    ]);
    const failedIndex = results.findIndex(result => result.error);
    if (failedIndex !== -1) {
      const sections = ['cast roster', 'rehearsal types', 'rehearsal history', 'attendance details'];
      const message = `Could not load ${sections[failedIndex]}: ${errorMessage(results[failedIndex].error)}`;
      $('#sync-message').textContent = `${message} A saved rehearsal may be in Supabase even if it is not visible here yet.`;
      $('#sync-message').classList.remove('hidden'); toast(message); setConnection(false, 'Sync problem'); return false;
    }
    [state.cast, state.types, state.sessions, state.records] = results.map(result => result.data || []);
    const adminResult = await client.rpc('is_callboard_roster_admin');
    state.isRosterAdmin = !adminResult.error && adminResult.data === true;
    if (adminResult.error) toast(errorMessage(adminResult.error));
    $('#sync-message').classList.add('hidden');
    setConnection(true, 'Connected securely'); renderAll(); return true;
  }
  function renderAll() { renderTypes(); renderAttendance(); renderRoster(); renderHistory(); renderOverview(); renderAdmin(); }
  function renderTypes() {
    const select = $('#session-type'), current = select.value;
    select.innerHTML = state.types.map(type => `<option value="${escapeHtml(type.name)}">${escapeHtml(type.name)}</option>`).join('');
    if (current && state.types.some(type => type.name === current)) select.value = current;
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function statusFor(id) { return state.statuses.get(id) || 'Here'; }
  function renderAttendance() {
    $('#roster-count').textContent = String(state.cast.length);
    const list = $('#attendance-list');
    if (!state.cast.length) { list.innerHTML = '<div class="empty-state">Your cast roster is empty. Add actors in Cast roster to begin.</div>'; return; }
    list.innerHTML = state.cast.map(actor => {
      const status = statusFor(actor.id), initials = actor.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
      return `<div class="attendance-row" data-actor="${actor.id}"><div class="actor-info"><span class="avatar">${escapeHtml(initials)}</span><span><strong>${escapeHtml(actor.name)}</strong><small>${escapeHtml(actor.characters || 'Character not set')}</small></span></div><div class="status-options">${statusValues.map(value => `<button type="button" class="status-option ${status === value ? 'selected' : ''}" data-status="${value}" aria-pressed="${status === value}">${value}</button>`).join('')}</div>${['Late', 'Absent'].includes(status) ? `<input class="attendance-note" type="text" maxlength="500" aria-label="Note for ${escapeHtml(actor.name)}" placeholder="Add a note (optional)" value="${escapeHtml(state.notes.get(actor.id) || '')}">` : ''}</div>`;
    }).join('');
    $$('.attendance-row').forEach(row => {
      $$('.status-option', row).forEach(button => button.addEventListener('click', () => { state.statuses.set(row.dataset.actor, button.dataset.status); if (!['Late', 'Absent'].includes(button.dataset.status)) state.notes.delete(row.dataset.actor); renderAttendance(); }));
      const note = $('.attendance-note', row); if (note) note.addEventListener('input', () => state.notes.set(row.dataset.actor, note.value));
    });
  }
  function renderRoster() {
    $('#roster-form').classList.toggle('hidden', !state.isRosterAdmin);
    $('#roster-admin-note').classList.toggle('hidden', state.isRosterAdmin);
    $('#cast-list').innerHTML = state.cast.length ? state.cast.map(actor => `<div class="cast-row"><div class="cast-main"><span class="avatar">${escapeHtml(actor.name.trim().split(/\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase())}</span><span><strong>${escapeHtml(actor.name)}</strong><small>${escapeHtml(actor.characters || 'Character not set')}</small></span></div>${state.isRosterAdmin ? `<span><button class="remove-actor edit-actor" data-id="${actor.id}">Edit</button><button class="remove-actor delete-actor" data-id="${actor.id}">Remove</button></span>` : ''}</div>`).join('') : '<div class="empty-state">The cast roster is empty. Ask the production administrator to add cast members.</div>';
    $$('.edit-actor').forEach(button => button.addEventListener('click', async () => {
      const actor = state.cast.find(item => item.id === button.dataset.id); if (!actor) return;
      const name = prompt('Actor name', actor.name); if (name === null) return;
      const characters = prompt('Character(s), separate multiple roles with commas', actor.characters || ''); if (characters === null) return;
      const { error } = await client.from('cast_members').update({ name: name.trim(), characters: characters.trim() }).eq('id', actor.id);
      if (error) toast(errorMessage(error)); else { toast('Cast member updated.'); await loadData(); }
    }));
    $$('.delete-actor').forEach(button => button.addEventListener('click', async () => {
      const actor = state.cast.find(item => item.id === button.dataset.id); if (!actor) return;
      if (!confirm(`Remove ${actor.name} from the shared roster? This actor cannot be removed while attendance records refer to them.`)) return;
      const { error } = await client.from('cast_members').delete().eq('id', actor.id);
      if (error) toast(error.message.includes('foreign key') ? 'This actor has saved attendance and must remain on the roster.' : errorMessage(error)); else { toast('Cast member removed.'); await loadData(); }
    }));
  }
  function recordsFor(sessionId) { return state.records.filter(record => record.session_id === sessionId); }
  function renderHistory() {
    const list = $('#history-list');
    if (!state.sessions.length) { list.innerHTML = '<article class="card empty-state">No rehearsals saved yet. Your session history will appear here.</article>'; return; }
    list.innerHTML = state.sessions.map(session => {
      const records = recordsFor(session.id);
      const date = new Date(`${session.rehearsal_date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      const time = formatTime(session.rehearsal_time);
      return `<article class="card history-session"><div class="history-session-head"><div><h3>${escapeHtml(session.rehearsal_type)} <span class="accent">·</span> ${escapeHtml(date)}${time ? ` <span class="session-time-label">· ${escapeHtml(time)}</span>` : ''}</h3><p>Called by ${escapeHtml(session.taker)} · ${records.length} cast members recorded</p></div><span class="session-count">Edit records &nbsp;⌄</span></div><div class="history-details hidden">${records.map(record => `<div class="history-row" data-record="${record.id}"><span class="history-actor"><strong>${escapeHtml(record.cast_members?.name || 'Former cast member')}</strong><small>${escapeHtml(record.cast_members?.characters || '')}</small></span><select aria-label="Attendance status">${statusValues.map(status => `<option ${record.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><input type="text" maxlength="500" aria-label="Attendance note" placeholder="Note for late arrival or absence" value="${escapeHtml(record.notes || '')}" ${['Late','Absent'].includes(record.status) ? '' : 'disabled'}></div>`).join('')}<div class="save-row">${state.isRosterAdmin ? `<button class="remove-actor delete-session" data-id="${session.id}">Delete this rehearsal…</button>` : '<span></span>'}<span class="muted">Changes sync to overview totals as you save each row.</span></div></div></article>`;
    }).join('');
    $$('.history-session-head').forEach(head => head.addEventListener('click', () => $('.history-details', head.parentElement).classList.toggle('hidden')));
    $$('.history-row').forEach(row => {
      const select = $('select', row), input = $('input', row);
      select.addEventListener('change', async () => { input.disabled = !['Late', 'Absent'].includes(select.value); if (input.disabled) input.value = ''; await updateRecord(row, select, input); });
      input.addEventListener('change', async () => updateRecord(row, select, input));
    });
    $$('.delete-session').forEach(button => button.addEventListener('click', async () => {
      const session = state.sessions.find(item => item.id === button.dataset.id); if (!session) return;
      if (!confirm(`Permanently delete the ${session.rehearsal_type} rehearsal on ${session.rehearsal_date} and all its attendance records? This cannot be undone.`)) return;
      const { error } = await client.from('rehearsal_sessions').delete().eq('id', session.id);
      if (error) toast(errorMessage(error)); else { toast('Rehearsal deleted.'); await loadData(); }
    }));
  }
  async function updateRecord(row, select, input) {
    const { error } = await client.from('attendance_records').update({ status: select.value, notes: input.value.trim(), updated_at: new Date().toISOString() }).eq('id', row.dataset.record);
    if (error) toast(errorMessage(error)); else { toast('Attendance correction saved. Totals are up to date.'); await loadData(); }
  }
  function renderOverview() {
    const lates = new Map(), absents = new Map(), calls = new Map();
    state.cast.forEach(actor => { lates.set(actor.id, 0); absents.set(actor.id, 0); calls.set(actor.id, 0); });
    state.records.forEach(record => {
      if (!calls.has(record.cast_member_id)) return;
      if (record.status === 'Late') { lates.set(record.cast_member_id, lates.get(record.cast_member_id) + 1); calls.set(record.cast_member_id, calls.get(record.cast_member_id) + 1); }
      else if (record.status === 'Absent') { absents.set(record.cast_member_id, absents.get(record.cast_member_id) + 1); calls.set(record.cast_member_id, calls.get(record.cast_member_id) + 1); }
      else if (record.status === 'Here') calls.set(record.cast_member_id, calls.get(record.cast_member_id) + 1);
    });
    const lateTotal = [...lates.values()].reduce((a,b) => a+b, 0), absentTotal = [...absents.values()].reduce((a,b) => a+b, 0);
    $('#total-lates').textContent = lateTotal; $('#total-absences').textContent = absentTotal; $('#total-sessions').textContent = state.sessions.length; $('#total-cast').textContent = state.cast.length;
    $('#summary-body').innerHTML = state.cast.length ? state.cast.map(actor => `<tr><td>${escapeHtml(actor.name)}</td><td>${escapeHtml(actor.characters || '—')}</td><td>${lates.get(actor.id)}</td><td>${absents.get(actor.id)}</td><td>${calls.get(actor.id)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">Add your cast to see attendance totals.</td></tr>';
    const max = Math.max(1, ...[...lates.values(), ...absents.values()]);
    $('#chart').innerHTML = state.cast.length ? state.cast.map(actor => `<div class="bar-group" title="${escapeHtml(actor.name)} — ${lates.get(actor.id)} late, ${absents.get(actor.id)} absent"><div class="bar-pair"><span class="bar late" style="height:${Math.max(lates.get(actor.id) ? 4 : 0, lates.get(actor.id) / max * 100)}%"></span><span class="bar absent" style="height:${Math.max(absents.get(actor.id) ? 4 : 0, absents.get(actor.id) / max * 100)}%"></span></div><span class="bar-name">${escapeHtml(actor.name.split(' ')[0])}</span></div>`).join('') : '<div class="empty-state">Your late and absence chart will appear once you add cast members.</div>';
    $('#recent-list').innerHTML = state.sessions.length ? state.sessions.slice(0, 4).map(session => `<div class="recent-item"><div><strong>${escapeHtml(session.rehearsal_type)}</strong><small>${escapeHtml(new Date(`${session.rehearsal_date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}${session.rehearsal_time ? ` · ${escapeHtml(formatTime(session.rehearsal_time))}` : ''} · ${escapeHtml(session.taker)}</small></div><span class="recent-tag">${recordsFor(session.id).filter(record => record.status !== 'Exempt').length} called</span></div>`).join('') : '<div class="empty-state">No rehearsals saved yet.</div>';
  }
  function renderAdmin() {
    const tab = $('.tab[data-page="admin"]'); tab.classList.toggle('hidden', !state.isRosterAdmin);
    if (!state.isRosterAdmin) return;
    $('#admin-history-count').textContent = String(state.sessions.length);
    $('#admin-cast-count').textContent = String(state.cast.length);
    $('#clear-history-button').disabled = state.sessions.length === 0;
    const blocked = state.sessions.length > 0;
    $('#clear-roster-button').disabled = blocked || state.cast.length === 0;
    $('#clear-roster-hint').textContent = blocked ? 'Clear rehearsal history first so old attendance records remain consistent.' : '';
  }
  function gotoPage(name) {
    $$('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.page === name));
    $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function localDate() { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
  function formatTime(value) {
    if (!value) return '';
    const [hours, minutes] = value.slice(0, 5).split(':').map(Number);
    const date = new Date(); date.setHours(hours, minutes, 0, 0);
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
  }

  $$('.tab').forEach(tab => tab.addEventListener('click', () => gotoPage(tab.dataset.page)));
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => gotoPage(button.dataset.goto)));
  $$('.bulk-actions button').forEach(button => button.addEventListener('click', () => { state.cast.forEach(actor => { state.statuses.set(actor.id, button.dataset.bulk); if (!['Late', 'Absent'].includes(button.dataset.bulk)) state.notes.delete(actor.id); }); renderAttendance(); }));
  $('#today-button').addEventListener('click', () => { $('#session-date').value = localDate(); });
  $('#session-date').value = localDate();
  function refreshDuplicateHint() {
    const date = $('#session-date').value, type = $('#session-type').value;
    const time = $('#multiple-practices').checked ? $('#session-time').value : '';
    const existing = state.sessions.filter(session => {
      if (session.rehearsal_date !== date) return false;
      if (time && session.rehearsal_time) return session.rehearsal_time.slice(0, 5) === time;
      return session.rehearsal_type === type;
    });
    $('#duplicate-hint').textContent = existing.length ? `${existing.length} rehearsal${existing.length > 1 ? 's' : ''} may match this date and time. Review history before saving another.` : '';
  }
  $('#session-type').addEventListener('change', refreshDuplicateHint);
  $('#session-date').addEventListener('change', refreshDuplicateHint);
  $('#multiple-practices').addEventListener('change', () => {
    const enabled = $('#multiple-practices').checked;
    $('#session-time-field').classList.toggle('hidden', !enabled);
    $('#session-time').required = enabled;
    if (!enabled) $('#session-time').value = '';
    refreshDuplicateHint();
  });
  $('#session-time').addEventListener('input', refreshDuplicateHint);
  $('#add-type').addEventListener('click', async () => {
    const input = $('#new-type'), name = input.value.trim(); if (!name) { input.focus(); return; }
    const { error } = await client.from('rehearsal_types').insert({ name, is_builtin: false });
    if (error) toast(error.code === '23505' ? 'That rehearsal type already exists.' : errorMessage(error)); else { input.value = ''; toast('Custom rehearsal type added.'); await loadData(); $('#session-type').value = name; }
  });
  $('#roster-form').addEventListener('submit', async event => {
    event.preventDefault(); const name = $('#actor-name').value.trim(), characters = $('#actor-characters').value.trim(); if (!name) return;
    const { error } = await client.from('cast_members').insert({ name, characters });
    if (error) toast(errorMessage(error)); else { $('#roster-form').reset(); toast('Cast member added to the shared roster.'); await loadData(); }
  });
  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.cast.length) { toast('Add cast members before saving a rehearsal.'); return; }
    const date = $('#session-date').value, type = $('#session-type').value, taker = $('#session-taker').value.trim();
    if (!date || !type || !taker) { toast('Enter a date, rehearsal type, and attendance taker.'); return; }
    const time = $('#multiple-practices').checked ? $('#session-time').value : null;
    if ($('#multiple-practices').checked && !time) { toast('Enter the start time to distinguish this practice.'); $('#session-time').focus(); return; }
    const duplicate = state.sessions.filter(session => session.rehearsal_date === date && (time && session.rehearsal_time ? session.rehearsal_time.slice(0, 5) === time : session.rehearsal_type === type));
    if (duplicate.length) {
      const titles = duplicate.map(session => `${session.rehearsal_date}${session.rehearsal_time ? ` ${formatTime(session.rehearsal_time)}` : ''} · ${session.rehearsal_type} · ${session.taker}`).join('\n');
      if (!confirm(`A rehearsal may already be saved for this date and time. Review the existing session(s) first:\n\n${titles}\n\nSave another anyway?`)) { gotoPage('history'); return; }
    }
    const nonHere = state.cast.filter(actor => statusFor(actor.id) !== 'Here').length;
    if (!confirm(`Save ${type} rehearsal on ${date}${time ? ` at ${formatTime(time)}` : ''} for ${state.cast.length} cast members? ${nonHere} marked ${nonHere === 1 ? 'member is' : 'members are'} not Here. Exempt records will be excluded from call-in totals.`)) return;
    const records = state.cast.map(actor => ({ cast_member_id: actor.id, status: statusFor(actor.id), notes: state.notes.get(actor.id) || '' }));
    const { data: savedId, error } = await client.rpc('save_rehearsal', { p_date: date, p_type: type, p_taker: taker, p_time: time, p_records: records });
    if (error) { toast(errorMessage(error)); return; }
    state.statuses.clear(); state.notes.clear(); $('#session-date').value = localDate(); $('#multiple-practices').checked = false; $('#multiple-practices').dispatchEvent(new Event('change'));
    const loaded = await loadData(); gotoPage('history');
    if (loaded && state.sessions.some(session => session.id === savedId)) toast('Rehearsal saved and confirmed in history.');
    else toast('Supabase accepted the save, but Callboard could not reload it. Check the sync message before saving again.');
  });
  $('#clear-history-button').addEventListener('click', async () => {
    if (!state.isRosterAdmin || !state.sessions.length) return;
    const sessionCount = state.sessions.length, recordCount = state.records.length;
    if (!confirm(`Permanently clear all ${sessionCount} rehearsals and ${recordCount} attendance records? The cast roster stays. This cannot be undone.`)) return;
    const { data, error } = await client.rpc('clear_callboard_history');
    if (error) { toast(errorMessage(error)); return; }
    await loadData(); toast(`Cleared ${data} rehearsal${data === 1 ? '' : 's'} and their attendance records.`);
  });
  $('#clear-roster-button').addEventListener('click', async () => {
    if (!state.isRosterAdmin || !state.cast.length) return;
    if (state.sessions.length) { toast('Clear rehearsal history first to keep records consistent.'); return; }
    const castCount = state.cast.length;
    if (!confirm(`Permanently remove all ${castCount} cast members from the shared roster? This cannot be undone.`)) return;
    const { data, error } = await client.rpc('clear_callboard_roster');
    if (error) { toast(errorMessage(error)); return; }
    await loadData(); toast(`Removed ${data} cast member${data === 1 ? '' : 's'}.`);
  });
  $('#export-button').addEventListener('click', () => {
    const bundle = { exportedAt: new Date().toISOString(), cast: state.cast, rehearsalTypes: state.types, sessions: state.sessions, attendanceRecords: state.records.map(({ cast_members, ...record }) => record) };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `callboard-backup-${localDate()}.json`; link.click(); URL.revokeObjectURL(url); toast('Backup downloaded to this device.');
  });
  async function continueAuth() {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) { showAuth(userError ? errorMessage(userError) : 'Please sign in again.'); return; }
    state.user = userData.user;
    const { data: allowed, error: accessError } = await client.from('authorized_users').select('email').maybeSingle();
    if (accessError || !allowed) {
      await client.auth.signOut(); state.user = null;
      showAuth('This account is not on the authorized production list. Ask the production manager for an invitation.'); return;
    }
    const { data: profile, error: profileError } = await client.from('callboard_profiles').select('user_id,username').maybeSingle();
    if (profileError) { showAuth(`Account setup needs a database update: ${errorMessage(profileError)}`); return; }
    state.profile = profile;
    if (!profile) { showSetup(); return; }
    if (authFlow === 'recovery') { showRecovery(); return; }
    authFlow = ''; await showApp();
  }
  $('#login-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!client) { showAuth('Setup is incomplete. Add your Supabase URL and publishable key to config.js, then redeploy.'); return; }
    const form = new FormData(event.currentTarget); $('#auth-message').textContent = 'Signing in…';
    const { error } = await client.auth.signInWithPassword({ email: form.get('email').trim(), password: form.get('password') });
    if (error) { $('#auth-message').textContent = error.message; return; }
    await continueAuth();
  });
  $('#setup-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), username = String(form.get('username')).trim();
    const password = String(form.get('password')), confirmation = String(form.get('password-confirm'));
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) { $('#setup-message').textContent = 'Use 3–24 letters, numbers, or underscores for your username.'; return; }
    if (password.length < 8) { $('#setup-message').textContent = 'Choose a password with at least 8 characters.'; return; }
    if (password !== confirmation) { $('#setup-message').textContent = 'The passwords do not match.'; return; }
    $('#setup-message').textContent = 'Saving your account…';
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData.user) { showAuth('Your invitation session expired. Ask the production manager to send a new invitation.'); return; }
    const { error: passwordError } = await client.auth.updateUser({ password });
    if (passwordError) { $('#setup-message').textContent = errorMessage(passwordError); return; }
    const { error: profileError } = await client.from('callboard_profiles').upsert({ user_id: userData.user.id, username }, { onConflict: 'user_id' });
    if (profileError) {
      $('#setup-message').textContent = profileError.code === '23505' ? 'That username is already in use. Please choose another.' : errorMessage(profileError); return;
    }
    state.user = userData.user; state.profile = { user_id: userData.user.id, username }; authFlow = '';
    await showApp();
  });
  $('#recovery-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), password = String(form.get('password'));
    if (password !== String(form.get('password-confirm'))) { $('#recovery-message').textContent = 'The passwords do not match.'; return; }
    $('#recovery-message').textContent = 'Updating password…';
    const { error } = await client.auth.updateUser({ password });
    if (error) { $('#recovery-message').textContent = errorMessage(error); return; }
    authFlow = ''; await continueAuth();
  });
  $('#forgot-password').addEventListener('click', async () => {
    if (!client) return showAuth('Setup is incomplete. Configure the Supabase project first.');
    const email = $('#login-form [name="email"]').value.trim(); if (!email) { $('#auth-message').textContent = 'Enter your email address first.'; return; }
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    $('#auth-message').textContent = error ? errorMessage(error) : 'If password reset is enabled for this account, you’ll receive an email shortly.';
  });
  $('#signout').addEventListener('click', async () => { await client.auth.signOut(); showAuth(); });
  window.addEventListener('online', () => { if (state.user) loadData(); });
  if (!client) showAuth('Add your Supabase project settings to config.js to connect your private production workspace.');
  else client.auth.getSession().then(async ({ data }) => { if (data.session) await continueAuth(); else showAuth(authFlow === 'invite' ? 'Open the invitation link from your email on this device, then choose your username and password.' : ''); });
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
