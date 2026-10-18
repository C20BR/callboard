(() => {
  const config = window.CALLBOARD_CONFIG || {};
  const initialAuthType = new URLSearchParams(`${location.search}&${location.hash.slice(1)}`).get('type');
  let authFlow = initialAuthType === 'invite' ? 'invite' : initialAuthType === 'recovery' ? 'recovery' : '';
  const configured = config.supabaseUrl && config.supabaseAnonKey && !config.supabaseUrl.includes('YOUR-') && !config.supabaseAnonKey.includes('YOUR_');
  const client = configured && window.supabase ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey) : null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  function savedThemeKey() {
    try { const key = localStorage.getItem('callboard-theme'); return ['spotlight', 'nine_to_five'].includes(key) ? key : 'nine_to_five'; }
    catch { return 'nine_to_five'; }
  }
  const state = { user: null, profile: null, isRosterAdmin: false, isTeacher: false, teacherEmails: [], calendarEmbedUrl: '', themeKey: savedThemeKey(), themeAvailable: false, activity: [], activityError: null, rosterTagCategories: [], rosterTagGroups: new Map(), openAttendanceTagGroups: new Set(), cast: [], types: [], sessions: [], records: [], statuses: new Map(), notes: new Map(), attendanceMode: 'all', attendanceTags: new Set(), attendancePersonIds: new Set(), attendanceNameSearch: '', rosterSearch: '', overviewSearch: '', bulkTagPersonSearch: '', bulkTagSourceFilter: '', bulkTagSelectedIds: new Set() };
  const attendanceStatusValues = ['Here', 'Late', 'Absent'];
  const historyStatusValues = [...attendanceStatusValues, 'Exempt'];
  let toastTimer;

  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }
  function errorMessage(error) { return error?.message || 'Something went wrong. Please try again.'; }
  function setConnection(online, label) {
    const el = $('#connection'); el.classList.toggle('online', online); el.lastChild.textContent = ` ${label}`;
  }
  function applyTheme(themeKey) {
    state.themeKey = ['spotlight', 'nine_to_five'].includes(themeKey) ? themeKey : 'nine_to_five';
    document.documentElement.dataset.theme = state.themeKey;
    const themeColor = $('meta[name="theme-color"]');
    if (themeColor) themeColor.content = state.themeKey === 'nine_to_five' ? '#fff6ed' : '#090a11';
    try { localStorage.setItem('callboard-theme', state.themeKey); } catch { /* Theme still applies for this visit. */ }
  }
  applyTheme(state.themeKey);
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
      client.from('attendance_records').select('*, cast_members(id,name,characters)'),
      client.from('callboard_settings').select('google_calendar_embed_url').eq('id', 'global').maybeSingle(),
      client.from('roster_tag_groups').select('tag_key,group_name'),
      client.from('roster_tag_categories').select('name')
    ]);
    const failedIndex = results.findIndex(result => result.error);
    if (failedIndex !== -1) {
      const sections = ['cast roster', 'rehearsal types', 'rehearsal history', 'attendance details', 'calendar settings', 'attendance tag assignments', 'attendance tag groups'];
      const message = `Could not load ${sections[failedIndex]}: ${errorMessage(results[failedIndex].error)}`;
      $('#sync-message').textContent = `${message} A saved rehearsal may be in Supabase even if it is not visible here yet.`;
      $('#sync-message').classList.remove('hidden'); toast(message); setConnection(false, 'Sync problem'); return false;
    }
    [state.cast, state.types, state.sessions, state.records] = results.map(result => result.data || []);
    state.calendarEmbedUrl = results[4].data?.google_calendar_embed_url || '';
    state.rosterTagGroups = new Map((results[5].data || []).map(item => [item.tag_key, item.group_name]));
    state.rosterTagCategories = (results[6].data || []).map(item => item.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const [adminResult, teacherResult] = await Promise.all([
      client.rpc('is_callboard_roster_admin'),
      client.rpc('is_callboard_teacher')
    ]);
    state.isRosterAdmin = !adminResult.error && adminResult.data === true;
    state.isTeacher = !teacherResult.error && teacherResult.data === true;
    state.teacherEmails = [];
    if (state.isRosterAdmin) {
      const teacherList = await client.from('callboard_teachers').select('email').order('email');
      if (teacherList.error) toast(errorMessage(teacherList.error));
      else state.teacherEmails = teacherList.data || [];
    }
    if (adminResult.error) toast(errorMessage(adminResult.error));
    if (teacherResult.error) toast(errorMessage(teacherResult.error));
    const [themeResult, activityResult] = await Promise.all([
      client.from('callboard_settings').select('theme_key').eq('id', 'global').maybeSingle(),
      client.from('callboard_activity').select('id,actor_name,event_type,summary,details,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
    ]);
    state.themeAvailable = !themeResult.error && Boolean(themeResult.data);
    applyTheme(state.themeAvailable ? themeResult.data.theme_key : 'nine_to_five');
    state.activity = activityResult.data || [];
    state.activityError = activityResult.error;
    $('#sync-message').classList.add('hidden');
    setConnection(true, 'Connected securely'); renderAll(); return true;
  }
  function renderAll() { renderTypes(); renderLocation(); renderAttendance(); renderRoster(); renderHistory(); renderOverview(); renderActivity(); renderCalendar(); renderAdmin(); }
  function renderTypes() {
    const select = $('#session-type'), current = select.value;
    select.innerHTML = state.types.map(type => `<option value="${escapeHtml(type.name)}">${escapeHtml(type.name)}</option>`).join('');
    if (current && state.types.some(type => type.name === current)) select.value = current;
    $('#custom-type').classList.toggle('hidden', !(state.isRosterAdmin || state.isTeacher));
    $('#session-location').readOnly = !(state.isRosterAdmin || state.isTeacher);
    $('#location-permission-note').classList.toggle('hidden', state.isRosterAdmin || state.isTeacher);
    $('#location-manager-note').classList.toggle('hidden', !canManageRehearsals());
  }
  function renderLocation(reset = false) {
    const field = $('#session-location'), typeName = $('#session-type').value;
    if (!field) return;
    const type = state.types.find(item => item.name === typeName);
    const defaultLocation = type?.default_location || '';
    if (reset || !field.value) field.value = defaultLocation;
    field.readOnly = !(state.isRosterAdmin || state.isTeacher);
    $('#location-permission-note').classList.toggle('hidden', state.isRosterAdmin || state.isTeacher);
    $('#location-manager-note').classList.toggle('hidden', !canManageRehearsals());
    $('#save-location-default').classList.toggle('hidden', !canManageRehearsals());
  }
  function normalizeGoogleCalendarUrl(value) {
    const text = String(value ?? '').trim();
    const source = text.match(/src\s*=\s*(["'])(.*?)\1/i)?.[2] || text;
    const unescaped = source.replace(/&amp;/g, '&');
    try {
      const url = new URL(unescaped);
      return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && url.pathname === '/calendar/embed' ? url.href : '';
    } catch { return ''; }
  }
  function renderCalendar() {
    const frame = $('#google-calendar-frame'), open = $('#open-google-calendar'), notice = $('#calendar-notice');
    const url = normalizeGoogleCalendarUrl(state.calendarEmbedUrl);
    if (url) {
      if (frame.getAttribute('src') !== url) frame.src = url;
      frame.classList.remove('hidden'); open.href = url; open.classList.remove('hidden');
      notice.textContent = 'Use this calendar to check the call before taking attendance. Callboard does not edit or copy Google events. Google controls calendar access: a private calendar requires each viewer to have Google access; a public calendar can be visible to anyone.';
    } else {
      frame.removeAttribute('src'); frame.classList.add('hidden'); open.classList.add('hidden');
      notice.textContent = state.isRosterAdmin ? 'Connect a Google Calendar from the Admin tab. Paste only the calendar embed URL or the full iframe code.' : 'The production manager has not connected a Google Calendar yet.';
    }
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  function normalizeTags(value) {
    const values = Array.isArray(value) ? value : String(value ?? '').split(',');
    const found = new Set();
    return values.map(tag => String(tag).trim().replace(/\s+/g, ' ')).filter(tag => {
      const key = tag.toLocaleLowerCase();
      if (!tag || found.has(key)) return false;
      found.add(key); return true;
    });
  }
  function allRosterTags() {
    const tags = new Map();
    state.cast.flatMap(actor => normalizeTags(actor.tags)).forEach(tag => { if (!tags.has(tag.toLocaleLowerCase())) tags.set(tag.toLocaleLowerCase(), tag); });
    return [...tags.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  function castMatchesSearch(actor, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    return !needle || [actor.name, actor.characters].some(value => String(value || '').toLocaleLowerCase().includes(needle));
  }
  function castForAttendance() {
    if (state.attendanceMode === 'people') return state.cast.filter(actor => state.attendancePersonIds.has(actor.id));
    if (state.attendanceMode === 'tags' && state.attendanceTags.size) return state.cast.filter(actor => normalizeTags(actor.tags).some(tag => state.attendanceTags.has(tag.toLocaleLowerCase())));
    return state.cast;
  }
  function tagBadges(tags) {
    const values = normalizeTags(tags);
    return values.length ? `<span class="tag-badges">${values.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}</span>` : '';
  }
  function renderBulkTagAssignment() {
    const panel = $('#bulk-tag-panel'), sourceFilter = $('#bulk-tag-source-filter'), options = $('#bulk-tag-options'), list = $('#bulk-tag-people');
    panel.classList.toggle('hidden', !state.isRosterAdmin);
    if (!state.isRosterAdmin) return;
    const tags = allRosterTags(), previousFilter = state.bulkTagSourceFilter;
    const validIds = new Set(state.cast.map(actor => actor.id));
    state.bulkTagSelectedIds = new Set([...state.bulkTagSelectedIds].filter(id => validIds.has(id)));
    sourceFilter.innerHTML = `<option value="">Any existing tags</option>${tags.map(tag => `<option value="${escapeHtml(tag.toLocaleLowerCase())}">${escapeHtml(tag)}</option>`).join('')}`;
    sourceFilter.value = tags.some(tag => tag.toLocaleLowerCase() === previousFilter) ? previousFilter : '';
    state.bulkTagSourceFilter = sourceFilter.value;
    options.innerHTML = tags.map(tag => `<option value="${escapeHtml(tag)}"></option>`).join('');
    const matches = state.cast.filter(actor => castMatchesSearch(actor, state.bulkTagPersonSearch) && (!state.bulkTagSourceFilter || normalizeTags(actor.tags).some(tag => tag.toLocaleLowerCase() === state.bulkTagSourceFilter))).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const visibleSelected = matches.filter(actor => state.bulkTagSelectedIds.has(actor.id)).length;
    const hiddenSelected = state.bulkTagSelectedIds.size - visibleSelected;
    $('#bulk-tag-match-count').textContent = `${matches.length} matching · ${visibleSelected} selected here${hiddenSelected ? ` · ${hiddenSelected} selected outside these filters` : ''}`;
    const selectMatches = $('#bulk-tag-select-matches');
    selectMatches.textContent = matches.length ? `Select all ${matches.length} matching` : 'Select matching';
    selectMatches.disabled = matches.length === 0;
    list.innerHTML = matches.length ? matches.map(actor => `<label class="bulk-tag-person ${state.bulkTagSelectedIds.has(actor.id) ? 'selected' : ''}"><input type="checkbox" data-bulk-person="${escapeHtml(actor.id)}" ${state.bulkTagSelectedIds.has(actor.id) ? 'checked' : ''}><span><strong>${escapeHtml(actor.name)}</strong><small>${escapeHtml(actor.characters || 'Character not set')}</small></span>${tagBadges(actor.tags)}</label>`).join('') : '<p class="empty-state">No cast members match these filters.</p>';
    $$('[data-bulk-person]', list).forEach(input => input.addEventListener('change', () => {
      if (input.checked) state.bulkTagSelectedIds.add(input.dataset.bulkPerson); else state.bulkTagSelectedIds.delete(input.dataset.bulkPerson);
      renderBulkTagAssignment();
    }));
  }
  function statusFor(id) { return state.statuses.get(id) || 'Here'; }
  function renderAttendancePeople() {
    const choices = $('#attendance-people-choices');
    if (!choices) return;
    const query = state.attendanceNameSearch.trim().toLocaleLowerCase();
    const people = state.cast.filter(actor => actor.name.toLocaleLowerCase().includes(query));
    choices.innerHTML = people.length ? people.map(actor => `<label class="attendance-person-choice"><input type="checkbox" data-person-id="${escapeHtml(actor.id)}" ${state.attendancePersonIds.has(actor.id) ? 'checked' : ''}><span>${escapeHtml(actor.name)}</span>${actor.characters ? `<small>${escapeHtml(actor.characters)}</small>` : ''}</label>`).join('') : '<p class="attendance-no-matches">No names match that search.</p>';
    $$('[data-person-id]', choices).forEach(input => input.addEventListener('change', () => {
      if (input.checked) state.attendancePersonIds.add(input.dataset.personId); else state.attendancePersonIds.delete(input.dataset.personId);
      renderAttendance();
    }));
  }
  function renderAttendanceTagFilter() {
    const tags = allRosterTags(), filter = $('#attendance-tag-filter');
    const validKeys = new Set(tags.map(tag => tag.toLocaleLowerCase()));
    state.attendanceTags = new Set([...state.attendanceTags].filter(tag => validKeys.has(tag)));
    if (state.attendanceMode === 'tags' && !state.attendanceTags.size) state.attendanceMode = 'all';
    const validIds = new Set(state.cast.map(actor => actor.id));
    state.attendancePersonIds = new Set([...state.attendancePersonIds].filter(id => validIds.has(id)));
    const tagGroups = new Map(state.rosterTagCategories.map(group => [group, []]));
    tags.forEach(tag => {
      const key = tag.toLocaleLowerCase(), savedGroup = state.rosterTagGroups.get(key);
      if (tagGroups.has(savedGroup)) tagGroups.get(savedGroup).push(tag);
    });
    const groupedMenus = [...tagGroups].filter(([, values]) => values.length).map(([group, groupTags]) => {
      const selectedCount = groupTags.filter(tag => state.attendanceMode === 'tags' && state.attendanceTags.has(tag.toLocaleLowerCase())).length;
      return `<details class="tag-group-dropdown" data-tag-group-menu="${escapeHtml(group)}" ${state.openAttendanceTagGroups.has(group) ? 'open' : ''}><summary class="tag-filter-button ${selectedCount ? 'selected' : ''}">${escapeHtml(group)}${selectedCount ? ` <span>${selectedCount}</span>` : ''}<span aria-hidden="true">⌄</span></summary><div class="tag-group-menu" role="group" aria-label="${escapeHtml(group)}">${groupTags.map(tag => {
        const key = tag.toLocaleLowerCase(), selected = state.attendanceMode === 'tags' && state.attendanceTags.has(key);
        return `<label class="tag-group-option"><input type="checkbox" data-tag="${escapeHtml(key)}" ${selected ? 'checked' : ''}><span>${escapeHtml(tag)}</span></label>`;
      }).join('')}</div></details>`;
    }).join('');
    const hasGroupedTags = [...tagGroups.values()].some(groupTags => groupTags.length);
    filter.innerHTML = `<div class="tag-filter-buttons"><button type="button" class="tag-filter-button ${state.attendanceMode === 'all' ? 'selected' : ''}" data-tag-all aria-pressed="${state.attendanceMode === 'all'}">Everyone</button>${groupedMenus}<button type="button" class="tag-filter-button ${state.attendanceMode === 'people' ? 'selected' : ''}" data-tag-people aria-pressed="${state.attendanceMode === 'people'}">Choose by name</button></div><p class="attendance-filter-note">${state.attendanceMode === 'people' ? 'Select any combination of cast members for this attendance sheet. This temporary selection does not change their saved roster tags.' : state.attendanceMode === 'tags' ? 'Choose one or more tags; a person is included if they have any selected tag.' : tags.length && !hasGroupedTags ? 'Create tag groups in Cast roster and assign tags to make them available as attendance filters.' : tags.length ? 'Everyone on the shared roster is included.' : 'Add tags in Cast roster, then create groups to filter attendance by tag.'} People outside the selection will not be saved on this attendance sheet.</p>${state.attendanceMode === 'people' ? '<div class="attendance-people-picker"><label class="attendance-name-search">Find a cast member<input id="attendance-name-search" type="search" autocomplete="off" placeholder="Search names" value="' + escapeHtml(state.attendanceNameSearch) + '"></label><div id="attendance-people-choices" class="attendance-people-choices"></div></div>' : ''}`;
    $$('[data-tag-group-menu]', filter).forEach(menu => menu.addEventListener('toggle', () => {
      const group = menu.dataset.tagGroupMenu;
      if (menu.open) state.openAttendanceTagGroups.add(group); else state.openAttendanceTagGroups.delete(group);
    }));
    $('[data-tag-all]', filter).addEventListener('click', () => { state.attendanceMode = 'all'; state.attendanceTags.clear(); renderAttendance(); });
    $$('[data-tag]', filter).forEach(input => input.addEventListener('change', () => {
      const tag = input.dataset.tag;
      if (state.attendanceMode !== 'tags') { state.attendanceMode = 'tags'; state.attendanceTags.clear(); }
      if (input.checked) state.attendanceTags.add(tag); else state.attendanceTags.delete(tag);
      if (!state.attendanceTags.size) state.attendanceMode = 'all';
      renderAttendance();
    }));
    $('[data-tag-people]', filter).addEventListener('click', () => { state.attendanceMode = 'people'; state.attendanceTags.clear(); renderAttendance(); });
    if (state.attendanceMode === 'people') {
      const search = $('#attendance-name-search');
      search.addEventListener('input', () => { state.attendanceNameSearch = search.value; renderAttendancePeople(); });
      renderAttendancePeople();
    }
    const included = castForAttendance();
    $('#roster-count').textContent = String(included.length);
    $('#attendance-filter-count').textContent = state.attendanceMode === 'all' ? `${included.length} people included` : `${included.length} of ${state.cast.length} people included`;
    $('#save-session').disabled = included.length === 0;
  }
  function renderAttendance() {
    renderAttendanceTagFilter();
    const list = $('#attendance-list');
    if (!state.cast.length) { list.innerHTML = '<div class="empty-state">Your cast roster is empty. Add actors in Cast roster to begin.</div>'; return; }
    const included = castForAttendance();
    if (!included.length) { list.innerHTML = `<div class="empty-state">${state.attendanceMode === 'people' ? 'No people selected yet. Check the names above to add them to this attendance sheet.' : 'No cast members have the selected tags. Choose another tag or select Everyone.'}</div>`; return; }
    list.innerHTML = included.map(actor => {
      const status = statusFor(actor.id), initials = actor.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
      return `<div class="attendance-row" data-actor="${actor.id}"><div class="actor-info"><span class="avatar">${escapeHtml(initials)}</span><span class="actor-details"><strong>${escapeHtml(actor.name)}</strong><small>${escapeHtml(actor.characters || 'Character not set')}</small>${tagBadges(actor.tags)}</span></div><div class="status-options">${attendanceStatusValues.map(value => `<button type="button" class="status-option ${status === value ? 'selected' : ''}" data-status="${value}" aria-pressed="${status === value}">${value}</button>`).join('')}</div>${['Late', 'Absent'].includes(status) ? `<input class="attendance-note" type="text" maxlength="500" aria-label="Note for ${escapeHtml(actor.name)}" placeholder="Add a note (optional)" value="${escapeHtml(state.notes.get(actor.id) || '')}">` : ''}</div>`;
    }).join('');
    $$('.attendance-row').forEach(row => {
      $$('.status-option', row).forEach(button => button.addEventListener('click', () => { state.statuses.set(row.dataset.actor, button.dataset.status); if (!['Late', 'Absent'].includes(button.dataset.status)) state.notes.delete(row.dataset.actor); renderAttendance(); }));
      const note = $('.attendance-note', row); if (note) note.addEventListener('input', () => state.notes.set(row.dataset.actor, note.value));
    });
  }
  function renderRoster() {
    $('#roster-form').classList.toggle('hidden', !state.isRosterAdmin);
    $('#roster-admin-note').classList.toggle('hidden', state.isRosterAdmin);
    renderBulkTagAssignment();
    renderRosterTagGroups();
    const matchingCast = state.cast.filter(actor => castMatchesSearch(actor, state.rosterSearch));
    $('#roster-search-count').textContent = state.rosterSearch.trim()
      ? `Showing ${matchingCast.length} of ${state.cast.length} cast members`
      : `${state.cast.length} cast member${state.cast.length === 1 ? '' : 's'}`;
    $('#cast-list').innerHTML = matchingCast.length ? matchingCast.map(actor => `<div class="cast-row"><div class="cast-main"><span class="avatar">${escapeHtml(actor.name.trim().split(/\s+/).map(p => p[0]).slice(0,2).join('').toUpperCase())}</span><span class="actor-details"><strong>${escapeHtml(actor.name)}</strong><small>${escapeHtml(actor.characters || 'Character not set')}</small>${tagBadges(actor.tags)}</span></div>${state.isRosterAdmin ? `<span><button class="remove-actor edit-actor" data-id="${actor.id}">Edit</button><button class="remove-actor delete-actor" data-id="${actor.id}">Remove</button></span>` : state.isTeacher ? `<span><button class="remove-actor edit-cast-tags" data-id="${actor.id}">Edit tags</button></span>` : ''}</div>`).join('') : state.cast.length
      ? '<div class="empty-state">No cast members match that name or character.</div>'
      : '<div class="empty-state">The cast roster is empty. Ask the production administrator to add cast members.</div>';
    $$('.edit-actor').forEach(button => button.addEventListener('click', async () => {
      const actor = state.cast.find(item => item.id === button.dataset.id); if (!actor) return;
      const name = prompt('Actor name', actor.name); if (name === null) return;
      const characters = prompt('Character(s), separate multiple roles with commas', actor.characters || ''); if (characters === null) return;
      const tags = prompt('Attendance tags, separate multiple tags with commas', normalizeTags(actor.tags).join(', ')); if (tags === null) return;
      const { error } = await client.from('cast_members').update({ name: name.trim(), characters: characters.trim(), tags: normalizeTags(tags) }).eq('id', actor.id);
      if (error) toast(errorMessage(error)); else { toast('Cast member updated.'); await loadData(); }
    }));
    $$('.edit-cast-tags').forEach(button => button.addEventListener('click', async () => {
      if (!state.isTeacher && !state.isRosterAdmin) return;
      const actor = state.cast.find(item => item.id === button.dataset.id); if (!actor) return;
      const tags = prompt(`Attendance tags for ${actor.name}, separated by commas`, normalizeTags(actor.tags).join(', ')); if (tags === null) return;
      const { error } = await client.from('cast_members').update({ tags: normalizeTags(tags) }).eq('id', actor.id);
      if (error) toast(errorMessage(error)); else { toast(`Tags updated for ${actor.name}.`); await loadData(); }
    }));
    $$('.delete-actor').forEach(button => button.addEventListener('click', async () => {
      const actor = state.cast.find(item => item.id === button.dataset.id); if (!actor) return;
      if (!confirm(`Remove ${actor.name} from the shared roster? This actor cannot be removed while attendance records refer to them.`)) return;
      const { error } = await client.from('cast_members').delete().eq('id', actor.id);
      if (error) toast(error.message.includes('foreign key') ? 'This actor has saved attendance and must remain on the roster.' : errorMessage(error)); else { toast('Cast member removed.'); await loadData(); }
    }));
  }
  function renderRosterTagGroups() {
    const panel = $('#roster-tag-organizer'), categoryList = $('#roster-tag-category-list'), assignmentList = $('#roster-tag-assignment-list');
    panel.classList.toggle('hidden', !state.isRosterAdmin);
    if (!state.isRosterAdmin) { categoryList.innerHTML = ''; assignmentList.innerHTML = ''; return; }
    const categories = [...state.rosterTagCategories];
    const createForm = $('#roster-tag-group-form');
    createForm.onsubmit = async event => {
      event.preventDefault();
      if (!state.isRosterAdmin) return;
      const input = $('#roster-tag-group-name'), name = input.value.trim();
      if (!name) { input.focus(); return; }
      const submit = $('button[type="submit"]', createForm); submit.disabled = true;
      const { error } = await client.from('roster_tag_categories').insert({ name });
      submit.disabled = false;
      if (error) { toast(error.code === '23505' ? 'That tag group already exists.' : errorMessage(error)); return; }
      createForm.reset(); toast('Tag group created.'); await loadData();
    };
    categoryList.innerHTML = categories.length ? categories.map(group => {
      const assignedCount = [...state.rosterTagGroups.values()].filter(name => name === group).length;
      return `<form class="tag-category-row" data-edit-tag-category="${escapeHtml(group)}"><label><span class="visually-hidden">Group name</span><input data-category-name maxlength="60" required value="${escapeHtml(group)}"></label><small>${assignedCount} tag${assignedCount === 1 ? '' : 's'}</small><div class="tag-category-actions"><button class="secondary" type="submit">Save name</button><button class="remove-actor delete-tag-category" type="button" data-name="${escapeHtml(group)}">Delete</button></div></form>`;
    }).join('') : '<p class="tag-group-empty">No groups yet. Create a group name that fits this production.</p>';
    $$('[data-edit-tag-category]', categoryList).forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!state.isRosterAdmin) return;
      const oldName = form.dataset.editTagCategory, name = $('[data-category-name]', form).value.trim();
      if (!name || name === oldName) return;
      $('button[type="submit"]', form).disabled = true;
      const { error } = await client.from('roster_tag_categories').update({ name }).eq('name', oldName);
      if (error) { toast(error.code === '23505' ? 'That tag group already exists.' : errorMessage(error)); $('button[type="submit"]', form).disabled = false; return; }
      if (state.openAttendanceTagGroups.delete(oldName)) state.openAttendanceTagGroups.add(name);
      toast('Tag group renamed.'); await loadData();
    }));
    $$('.delete-tag-category', categoryList).forEach(button => button.addEventListener('click', async () => {
      if (!state.isRosterAdmin) return;
      const name = button.dataset.name;
      if (!confirm(`Delete “${name}”? Tags in this group will become unassigned. Their saved tag text and attendance history will remain.`)) return;
      button.disabled = true;
      const { error } = await client.from('roster_tag_categories').delete().eq('name', name);
      if (error) { toast(errorMessage(error)); button.disabled = false; return; }
      state.openAttendanceTagGroups.delete(name); toast('Tag group deleted.'); await loadData();
    }));
    const tags = allRosterTags();
    assignmentList.innerHTML = tags.length ? tags.map(tag => {
      const key = tag.toLocaleLowerCase(), group = state.rosterTagGroups.get(key) || '';
      const categoryOptions = categories.map(category => `<option value="${escapeHtml(category)}" ${group === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
      return `<label class="roster-tag-group-row"><span>${escapeHtml(tag)}</span><select data-roster-tag-group="${escapeHtml(key)}" aria-label="Group for ${escapeHtml(tag)}"><option value="" ${group ? '' : 'selected'}>Unassigned</option>${categoryOptions}</select></label>`;
    }).join('') : '<p class="tag-group-empty">Add attendance tags to the cast roster to assign them to groups.</p>';
    $$('[data-roster-tag-group]', assignmentList).forEach(select => select.addEventListener('change', async () => {
      const key = select.dataset.rosterTagGroup, group = select.value;
      select.disabled = true;
      const result = group
        ? await client.from('roster_tag_groups').upsert({ tag_key: key, group_name: group, updated_at: new Date().toISOString() }, { onConflict: 'tag_key' })
        : await client.from('roster_tag_groups').delete().eq('tag_key', key);
      if (result.error) { toast(errorMessage(result.error)); await loadData(); return; }
      if (group) state.rosterTagGroups.set(key, group); else state.rosterTagGroups.delete(key);
      toast(group ? `Tag placed in “${group}”.` : 'Tag left ungrouped.');
      renderAttendance(); renderRosterTagGroups();
    }));
  }
  function recordsFor(sessionId) { return state.records.filter(record => record.session_id === sessionId); }
  function canManageRehearsals() { return state.isRosterAdmin || state.isTeacher; }
  function renderHistory() {
    const list = $('#history-list');
    if (!state.sessions.length) { list.innerHTML = '<article class="card empty-state">No rehearsals saved yet. Your session history will appear here.</article>'; return; }
    list.innerHTML = state.sessions.map(session => {
      const records = recordsFor(session.id);
      const date = new Date(`${session.rehearsal_date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      const time = formatTime(session.rehearsal_time);
      return `<article class="card history-session"><div class="history-session-head"><div><h3>${escapeHtml(session.rehearsal_type)} <span class="accent">·</span> ${escapeHtml(date)}${time ? ` <span class="session-time-label">· ${escapeHtml(time)}</span>` : ''}</h3><p>Called by ${escapeHtml(session.taker)} · ${records.length} cast members recorded · Location: ${escapeHtml(session.location || 'Not set')}</p></div><span class="session-count">Edit records &nbsp;⌄</span></div><div class="history-details hidden">${records.map(record => { const recordStatuses = record.status === 'Exempt' ? historyStatusValues : attendanceStatusValues; return `<div class="history-row" data-record="${record.id}"><span class="history-actor"><strong>${escapeHtml(record.cast_members?.name || 'Former cast member')}</strong><small>${escapeHtml(record.cast_members?.characters || '')}</small></span><select aria-label="Attendance status">${recordStatuses.map(status => `<option ${record.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><input type="text" maxlength="500" aria-label="Attendance note" placeholder="Note for late arrival or absence" value="${escapeHtml(record.notes || '')}" ${['Late','Absent'].includes(record.status) ? '' : 'disabled'}></div>`; }).join('')}${canManageRehearsals() ? `<div class="history-location-row"><label>Location<input type="text" maxlength="160" data-session-location="${session.id}" value="${escapeHtml(session.location || '')}" placeholder="Add rehearsal location"></label><button type="button" class="secondary save-session-location" data-id="${session.id}">Save location</button></div>` : ''}<div class="save-row">${canManageRehearsals() ? `<button class="remove-actor delete-session" data-id="${session.id}">Delete this rehearsal…</button>` : '<span></span>'}<span class="muted">Changes sync to overview totals as you save each row.</span></div></div></article>`;
    }).join('');
    $$('.history-session-head').forEach(head => head.addEventListener('click', () => $('.history-details', head.parentElement).classList.toggle('hidden')));
    $$('.history-row').forEach(row => {
      const select = $('select', row), input = $('input', row);
      select.addEventListener('change', async () => { input.disabled = !['Late', 'Absent'].includes(select.value); if (input.disabled) input.value = ''; await updateRecord(row, select, input); });
      input.addEventListener('change', async () => updateRecord(row, select, input));
    });
    $$('.save-session-location').forEach(button => button.addEventListener('click', async () => {
      if (!canManageRehearsals()) return;
      const input = $(`[data-session-location="${button.dataset.id}"]`);
      const { error } = await client.from('rehearsal_sessions').update({ location: input.value.trim() }).eq('id', button.dataset.id);
      if (error) toast(errorMessage(error)); else { toast('Rehearsal location saved.'); await loadData(); }
    }));
    $$('.delete-session').forEach(button => button.addEventListener('click', async () => {
      if (!canManageRehearsals()) return;
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
    const matchingCast = state.cast.filter(actor => castMatchesSearch(actor, state.overviewSearch));
    $('#overview-search-count').textContent = state.overviewSearch.trim()
      ? `Showing ${matchingCast.length} of ${state.cast.length} cast members`
      : `${state.cast.length} cast member${state.cast.length === 1 ? '' : 's'}`;
    $('#summary-body').innerHTML = matchingCast.length ? matchingCast.map(actor => `<tr><td>${escapeHtml(actor.name)}</td><td>${escapeHtml(actor.characters || '—')}</td><td>${lates.get(actor.id)}</td><td>${absents.get(actor.id)}</td><td>${calls.get(actor.id)}</td></tr>`).join('') : state.cast.length
      ? '<tr><td colspan="5" class="empty-state">No cast members match that name or character.</td></tr>'
      : '<tr><td colspan="5" class="empty-state">Add your cast to see attendance totals.</td></tr>';
    const callMode = $('#chart-mode').value === 'calls';
    $('#chart-title').textContent = `${callMode ? 'Call-ins by cast member' : 'Late vs. absent'}${state.overviewSearch.trim() ? ' · search results' : ''}`;
    $('#chart-legend').innerHTML = callMode ? '<i class="legend-calls"></i> Called in' : '<i class="legend-late"></i> Late <i class="legend-absent"></i> Absent';
    $('#chart').setAttribute('aria-label', `${callMode ? 'Call-ins by actor' : 'Late and absent totals by actor'}${state.overviewSearch.trim() ? ', filtered by student or character search' : ''}`);
    const max = Math.max(1, ...matchingCast.map(actor => callMode
      ? calls.get(actor.id)
      : lates.get(actor.id) + absents.get(actor.id)));
    $('#chart').innerHTML = matchingCast.length ? matchingCast.map(actor => {
      const late = lates.get(actor.id), absent = absents.get(actor.id), callIns = calls.get(actor.id);
      const label = callMode ? `${callIns} call-ins` : `${late} late, ${absent} absent`;
      const bars = callMode
        ? `<span class="bar calls" style="width:${callIns / max * 100}%"></span>`
        : `<span class="bar late" style="width:${late / max * 100}%"></span><span class="bar absent" style="width:${absent / max * 100}%"></span>`;
      const value = callMode ? `${callIns} ${callIns === 1 ? 'call-in' : 'call-ins'}` : `${late} late · ${absent} absent`;
      return `<div class="bar-group" role="group" aria-label="${escapeHtml(`${actor.name}: ${label}`)}"><span class="bar-name">${escapeHtml(actor.name)}</span><div class="bar-track ${callMode ? 'single' : ''}" aria-hidden="true">${bars}</div><span class="bar-value">${value}</span></div>`;
    }).join('') : state.cast.length
      ? '<div class="empty-state">No cast members match that name or character.</div>'
      : '<div class="empty-state">Your attendance chart will appear once you add cast members.</div>';
    $('#recent-list').innerHTML = state.sessions.length ? state.sessions.slice(0, 4).map(session => `<div class="recent-item"><div><strong>${escapeHtml(session.rehearsal_type)}</strong><small>${escapeHtml(new Date(`${session.rehearsal_date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}${session.rehearsal_time ? ` · ${escapeHtml(formatTime(session.rehearsal_time))}` : ''} · ${escapeHtml(session.taker)}</small></div><span class="recent-tag">${recordsFor(session.id).filter(record => record.status !== 'Exempt').length} called</span></div>`).join('') : '<div class="empty-state">No rehearsals saved yet.</div>';
  }
  function renderActivity() {
    const list = $('#activity-list');
    if (state.activityError) {
      list.innerHTML = '<p class="empty-state">Recent changes are unavailable. Refresh the page or contact the production administrator.</p>';
      return;
    }
    list.innerHTML = state.activity.length ? state.activity.map(item => {
      const date = new Date(item.created_at);
      const timestamp = Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
      return `<article class="activity-entry"><span class="activity-entry-mark" aria-hidden="true"></span><div class="activity-entry-content"><div class="activity-entry-heading"><strong>${escapeHtml(item.actor_name || 'Production team')}</strong><time datetime="${escapeHtml(item.created_at)}">${escapeHtml(timestamp)}</time></div><p>${escapeHtml(item.summary)}</p></div></article>`;
    }).join('') : '<p class="empty-state">No changes have been recorded yet. Tag edits, rehearsal saves, and attendance notes will appear here.</p>';
  }
  function showOverviewView(name) {
    const showActivity = name === 'activity';
    $('#overview-summary-view').classList.toggle('hidden', showActivity);
    $('#overview-activity-view').classList.toggle('hidden', !showActivity);
    $$('[data-overview-view]').forEach(button => {
      const selected = button.dataset.overviewView === name;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
  }
  function renderAdmin() {
    const tab = $('.tab[data-page="admin"]'); tab.classList.toggle('hidden', !state.isRosterAdmin);
    if (!state.isRosterAdmin) return;
    $('#google-calendar-url').value = state.calendarEmbedUrl;
    $('#theme-key').value = state.themeKey;
    $('#theme-form').classList.toggle('hidden', !state.themeAvailable);
    $('#remove-calendar-button').disabled = !state.calendarEmbedUrl;
    $('#teacher-list').innerHTML = state.teacherEmails.length ? state.teacherEmails.map(({ email }) => `<div class="teacher-role-row"><span>${escapeHtml(email)}</span><button type="button" class="remove-actor remove-teacher" data-email="${escapeHtml(email)}">Remove teacher role</button></div>`).join('') : '<p class="muted">No teachers assigned yet. Everyone else remains a stage manager.</p>';
    $$('.remove-teacher').forEach(button => button.addEventListener('click', async () => {
      if (!state.isRosterAdmin) return;
      const email = button.dataset.email;
      if (!confirm(`Remove teacher privileges from ${email}? They will become a stage manager.`)) return;
      const { error } = await client.from('callboard_teachers').delete().eq('email', email);
      if (error) toast(errorMessage(error)); else { toast('Teacher role removed.'); await loadData(); }
    }));
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
  $('#roster-cast-search').addEventListener('input', event => { state.rosterSearch = event.currentTarget.value; renderRoster(); });
  $('#overview-cast-search').addEventListener('input', event => { state.overviewSearch = event.currentTarget.value; renderOverview(); });
  $$('[data-goto]').forEach(button => button.addEventListener('click', () => gotoPage(button.dataset.goto)));
  $$('.bulk-actions button').forEach(button => button.addEventListener('click', () => { castForAttendance().forEach(actor => { state.statuses.set(actor.id, button.dataset.bulk); if (!['Late', 'Absent'].includes(button.dataset.bulk)) state.notes.delete(actor.id); }); renderAttendance(); }));
  $('#chart-mode').addEventListener('change', renderOverview);
  $$('[data-overview-view]').forEach(button => {
    button.addEventListener('click', () => showOverviewView(button.dataset.overviewView));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = $$('[data-overview-view]'), index = tabs.indexOf(button);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      tabs[nextIndex].focus(); showOverviewView(tabs[nextIndex].dataset.overviewView);
    });
  });
  $('#activity-refresh').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    const { data, error } = await client.from('callboard_activity').select('id,actor_name,event_type,summary,details,created_at').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100);
    state.activity = data || []; state.activityError = error; renderActivity(); button.disabled = false;
  });
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
  $('#session-type').addEventListener('change', () => renderLocation(true));
  $('#save-location-default').addEventListener('click', async () => {
    if (!canManageRehearsals()) return;
    const name = $('#session-type').value;
    if (!name) { toast('Choose a rehearsal type first.'); return; }
    const { error } = await client.from('rehearsal_types').update({ default_location: $('#session-location').value.trim() }).eq('name', name);
    if (error) toast(errorMessage(error));
    else { toast(`Default location saved for ${name}.`); await loadData(); }
  });
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
    if (!canManageRehearsals()) return;
    const input = $('#new-type'), name = input.value.trim(); if (!name) { input.focus(); return; }
    const { error } = await client.from('rehearsal_types').insert({ name, is_builtin: false });
    if (error) toast(error.code === '23505' ? 'That rehearsal type already exists.' : errorMessage(error)); else { input.value = ''; toast('Custom rehearsal type added.'); await loadData(); $('#session-type').value = name; renderLocation(true); }
  });
  $('#roster-form').addEventListener('submit', async event => {
    event.preventDefault(); const name = $('#actor-name').value.trim(), characters = $('#actor-characters').value.trim(), tags = normalizeTags($('#actor-tags').value); if (!name) return;
    const { error } = await client.from('cast_members').insert({ name, characters, tags });
    if (error) toast(errorMessage(error)); else { $('#roster-form').reset(); toast('Cast member added to the shared roster.'); await loadData(); }
  });
  $('#bulk-tag-person-search').addEventListener('input', event => { state.bulkTagPersonSearch = event.currentTarget.value; renderBulkTagAssignment(); });
  $('#bulk-tag-source-filter').addEventListener('change', event => { state.bulkTagSourceFilter = event.currentTarget.value; renderBulkTagAssignment(); });
  $('#bulk-tag-select-matches').addEventListener('click', () => {
    if (!state.isRosterAdmin) return;
    const query = state.bulkTagPersonSearch;
    state.cast.filter(actor => castMatchesSearch(actor, query) && (!state.bulkTagSourceFilter || normalizeTags(actor.tags).some(tag => tag.toLocaleLowerCase() === state.bulkTagSourceFilter))).forEach(actor => state.bulkTagSelectedIds.add(actor.id));
    renderBulkTagAssignment();
  });
  $('#bulk-tag-clear-selection').addEventListener('click', () => { state.bulkTagSelectedIds.clear(); renderBulkTagAssignment(); });
  $('#bulk-tag-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.isRosterAdmin) return;
    const tag = normalizeTags($('#bulk-tag-target').value)[0], selected = state.cast.filter(actor => state.bulkTagSelectedIds.has(actor.id));
    if (!tag) { $('#bulk-tag-target').focus(); return; }
    if (!selected.length) { toast('Select at least one person first.'); return; }
    const submit = $('button[type="submit"]', event.currentTarget); submit.disabled = true;
    const results = await Promise.all(selected.map(async actor => {
      const existing = normalizeTags(actor.tags);
      if (existing.some(value => value.toLocaleLowerCase() === tag.toLocaleLowerCase())) return { actor, unchanged: true };
      const { error } = await client.from('cast_members').update({ tags: normalizeTags([...existing, tag]) }).eq('id', actor.id);
      return { actor, error };
    }));
    submit.disabled = false;
    const successful = results.filter(result => !result.error);
    successful.forEach(result => state.bulkTagSelectedIds.delete(result.actor.id));
    const failed = results.filter(result => result.error);
    if (failed.length) toast(`${successful.length} updated; ${failed.length} could not be updated. ${errorMessage(failed[0].error)}`);
    else toast(`${successful.length} ${successful.length === 1 ? 'person' : 'people'} ${successful.length === 1 ? 'has' : 'have'} the “${tag}” tag now.`);
    await loadData();
    if (!failed.length) $('#bulk-tag-form').reset();
  });
  $('#session-form').addEventListener('submit', async event => {
    event.preventDefault(); const attendanceCast = castForAttendance(); if (!attendanceCast.length) { toast(state.attendanceMode === 'people' ? 'Choose at least one person by name before saving.' : state.cast.length ? 'Choose at least one tag with cast members, or select Everyone.' : 'Add cast members before saving a rehearsal.'); return; }
    const date = $('#session-date').value, type = $('#session-type').value, taker = $('#session-taker').value.trim();
    if (!date || !type || !taker) { toast('Enter a date, rehearsal type, and attendance taker.'); return; }
    const time = $('#multiple-practices').checked ? $('#session-time').value : null;
    const location = $('#session-location').value.trim();
    if ($('#multiple-practices').checked && !time) { toast('Enter the start time to distinguish this practice.'); $('#session-time').focus(); return; }
    const duplicate = state.sessions.filter(session => session.rehearsal_date === date && (time && session.rehearsal_time ? session.rehearsal_time.slice(0, 5) === time : session.rehearsal_type === type));
    if (duplicate.length) {
      const titles = duplicate.map(session => `${session.rehearsal_date}${session.rehearsal_time ? ` ${formatTime(session.rehearsal_time)}` : ''} · ${session.rehearsal_type} · ${session.taker}`).join('\n');
      if (!confirm(`A rehearsal may already be saved for this date and time. Review the existing session(s) first:\n\n${titles}\n\nSave another anyway?`)) { gotoPage('history'); return; }
    }
    const nonHere = attendanceCast.filter(actor => statusFor(actor.id) !== 'Here').length;
    const groupLabel = state.attendanceMode === 'tags' && state.attendanceTags.size ? ` matching ${[...state.attendanceTags].join(', ')}` : state.attendanceMode === 'people' ? ' selected by name' : '';
    if (!confirm(`Save ${type} rehearsal on ${date}${time ? ` at ${formatTime(time)}` : ''}${location ? ` at ${location}` : ''} for ${attendanceCast.length} cast members${groupLabel}? ${nonHere} marked ${nonHere === 1 ? 'member is' : 'members are'} not Here. Cast outside this selection will not be included in this attendance record.`)) return;
    const records = attendanceCast.map(actor => ({ cast_member_id: actor.id, status: statusFor(actor.id), notes: state.notes.get(actor.id) || '' }));
    const { data: savedId, error } = await client.rpc('save_rehearsal', { p_date: date, p_type: type, p_taker: taker, p_time: time, p_records: records, p_location: location });
    if (error) { toast(errorMessage(error)); return; }
    let typeLocationError = null;
    if (canManageRehearsals()) {
      const result = await client.from('rehearsal_types').update({ default_location: location }).eq('name', type);
      typeLocationError = result.error;
    }
    state.statuses.clear(); state.notes.clear(); $('#session-date').value = localDate(); $('#multiple-practices').checked = false; $('#multiple-practices').dispatchEvent(new Event('change'));
    const loaded = await loadData(); gotoPage('history');
    if (typeLocationError) toast(`Rehearsal saved, but the default location could not be updated: ${errorMessage(typeLocationError)}`);
    else if (loaded && state.sessions.some(session => session.id === savedId)) toast('Rehearsal saved and confirmed in history.');
    else toast('Supabase accepted the save, but Callboard could not reload it. Check the sync message before saving again.');
  });
  $('#teacher-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.isRosterAdmin) return;
    const email = $('#teacher-email').value.trim().toLowerCase();
    if (!email) return;
    const { error } = await client.from('callboard_teachers').insert({ email });
    if (error) {
      toast(error.code === '23503' ? 'Invite and add this person to the authorized-user list before assigning the teacher role.' : error.code === '23505' ? 'That account is already a teacher.' : errorMessage(error));
    } else {
      $('#teacher-form').reset(); toast('Teacher role assigned.'); await loadData();
    }
  });
  $('#theme-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.isRosterAdmin || !state.themeAvailable) return;
    const key = $('#theme-key').value;
    const submit = $('button[type="submit"]', event.currentTarget); submit.disabled = true;
    const { error } = await client.from('callboard_settings').update({ theme_key: key }).eq('id', 'global');
    submit.disabled = false;
    if (error) { toast(errorMessage(error)); return; }
    applyTheme(key);
    toast('Production colors saved for everyone.'); await loadData();
  });
  $('#calendar-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!state.isRosterAdmin) return;
    const entered = $('#google-calendar-url').value.trim();
    const embedUrl = normalizeGoogleCalendarUrl(entered);
    if (entered && !embedUrl) {
      toast('Paste the Google Calendar embed URL, or its iframe code. It must come from calendar.google.com.'); return;
    }
    const { error } = await client.from('callboard_settings').update({ google_calendar_embed_url: embedUrl }).eq('id', 'global');
    if (error) toast(errorMessage(error));
    else { toast(embedUrl ? 'Google Calendar connected.' : 'Google Calendar removed.'); await loadData(); gotoPage('calendar'); }
  });
  $('#remove-calendar-button').addEventListener('click', async () => {
    if (!state.isRosterAdmin || !state.calendarEmbedUrl) return;
    const { error } = await client.from('callboard_settings').update({ google_calendar_embed_url: '' }).eq('id', 'global');
    if (error) toast(errorMessage(error)); else { toast('Google Calendar removed.'); await loadData(); }
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
