// ══════════════════════════════════════════════════════════════════
// APP-CORE.JS — load this BEFORE pos-booking.js
// Covers: init/theme, navigation, API helper, login/session, PIN
// step-up confirmation, Dashboard, Customers, Create/Close/Reopen/
// Delete Event, Staff & Permissions, Bulk Change PINs.
// pos-booking.js (ticket grid, booking modal, ledger, batch import,
// WhatsApp export) depends on globals declared here (appState,
// showSpinner/hideSpinner, showPage, getSessionPin, etc).
// ══════════════════════════════════════════════════════════════════

// ─── INITIALIZATION ───
lucide.createIcons();

// PWA: register the service worker (required for "Install App" on Android/Chrome).
// Silently no-ops over plain HTTP or unsupported browsers — never blocks the app.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}

const appState = { staffName: null, activeEvent: null, tickets: [], selectedTickets: [], currentFilter: 'all', eventClosed: false, rights: {}, isSuperAdmin: false, pin: null };
let currentEventsView = 'active'; // 'active' | 'closed' — which dashboard tab is showing

// ─── THEME ───
const savedTheme = localStorage.getItem('housie_theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
const themeSelector = document.getElementById('themeSelector');
if (themeSelector) themeSelector.value = savedTheme;

themeSelector.addEventListener('change', (e) => {
    const newTheme = e.target.value;
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('housie_theme', newTheme);
});

// ─── PAGE NAVIGATION ───
function openMobileSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarBackdrop').classList.add('visible');
}
function closeMobileSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('visible');
}

function showPage(pageId) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
    
    if(pageId === 'dashboardPage') { document.getElementById('navDashboardBtn').classList.add('active'); document.getElementById('bottomNavDashboardBtn').classList.add('active'); }
    if(pageId === 'customersPage') { document.getElementById('navCustomersBtn').classList.add('active'); document.getElementById('bottomNavCustomersBtn').classList.add('active'); }
    if(pageId === 'usersPage') { document.getElementById('navUsersBtn').classList.add('active'); document.getElementById('bottomNavUsersBtn').classList.add('active'); }
    if(pageId === 'settingsPage') { document.getElementById('navSettingsBtn').classList.add('active'); document.getElementById('bottomNavSettingsBtn').classList.add('active'); }

    // Remember the current page so a refresh returns here instead of always the Dashboard
    localStorage.setItem('housie_last_page', pageId);
    if (pageId !== 'posPage') localStorage.removeItem('housie_last_event');

    // Auto-close the mobile sidebar after navigating anywhere
    closeMobileSidebar();
}
function showSpinner() { document.getElementById('loadingSpinner').style.display = 'block'; }
function hideSpinner() { document.getElementById('loadingSpinner').style.display = 'none'; }

// ─── 📄 CSV EXPORT HELPER (shared with pos-booking.js) ───
function downloadCSV(filename, headers, rows) {
    const escapeCell = (v) => {
        const s = (v === null || v === undefined) ? '' : String(v);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const csv = [headers.map(escapeCell).join(','), ...rows.map(r => r.map(escapeCell).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── 🔐 SECURE LOGIN LOGIC ───
function canViewRevenue() {
    return appState.isSuperAdmin || !!appState.rights.canViewRevenue;
}
function canBookRight() {
    return appState.isSuperAdmin || !!appState.rights.canBook;
}

function applyLoggedInProfile(profile) {
    appState.staffName = profile.name;
    appState.rights = profile.rights || {};
    appState.isSuperAdmin = !!profile.isSuperAdmin;
    document.getElementById('loggedInStaffDisplay').innerText = `👋 ${profile.name}${appState.isSuperAdmin ? ' (Super Admin)' : ''}`;
    document.getElementById('navUsersBtn').style.display = appState.isSuperAdmin ? 'flex' : 'none';
    document.getElementById('bottomNavUsersBtn').style.display = appState.isSuperAdmin ? 'flex' : 'none';
    const canCreate = appState.isSuperAdmin || appState.rights.canCreateEvent;
    const createBtn = document.getElementById('topbarCreateEventBtn');
    if (createBtn) createBtn.style.display = canCreate ? 'inline-flex' : 'none';
    localStorage.setItem('housie_profile', JSON.stringify(profile));
    // 🔓 PIN is now persisted too (not just the profile) so PIN entry is only ever
    // needed at Login and at Delete Event, per your request — this is a deliberate
    // security trade-off vs. the earlier memory-only design: anyone with access to
    // this browser's storage on this device can now extract it. Fine for a trusted
    // internal device; worth revisiting if this ever runs on a shared/public terminal.
    if (appState.pin) localStorage.setItem('housie_pin', appState.pin);
}

document.getElementById('loginBtn').addEventListener('click', async () => {
    const pinInput = document.getElementById('staffLoginPin');
    const err = document.getElementById('loginError');
    if (!pinInput || !err) {
        alert("Login form didn't load correctly — please make sure index.html and script.js are the same matching version (both freshly re-uploaded), then hard-refresh the page.");
        return;
    }
    const pin = pinInput.value;
    
    if(!pin) {
        err.innerText = "Please enter your PIN.";
        err.style.display = 'block';
        return;
    }

    showSpinner();
    try {
        // 🔁 Now calling Supabase's authenticate_staff RPC instead of the old Apps Script route.
        // The RPC always resolves (never throws on a bad PIN) — it returns { success, ... } —
        // so a wrong PIN is a business-logic failure, not a network error.
        const { data, error } = await sb.rpc('authenticate_staff', { input_pin: pin });
        if (error) throw error;
        if (!data.success) throw new Error(data.error || "Invalid PIN.");

        appState.pin = pin; // set BEFORE applyLoggedInProfile so it gets persisted below
        applyLoggedInProfile(data.profile);
        err.style.display = 'none';
        
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('appShell').style.display = 'flex';
        
        showPage('dashboardPage');
        loadEventsFromBackend();
    } catch (error) {
        err.innerText = error.message || "Invalid PIN. Access Denied.";
        err.style.display = 'block';
    }
    hideSpinner();
});
document.getElementById('staffLoginPin').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

document.getElementById('logoutBtn').addEventListener('click', () => {
    appState.staffName = null; 
    appState.rights = {};
    appState.isSuperAdmin = false;
    appState.pin = null;
    localStorage.removeItem('housie_profile');
    localStorage.removeItem('housie_pin');
    localStorage.removeItem('housie_last_page');
    localStorage.removeItem('housie_last_event');
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('staffLoginPin').value = '';
});

// ─── 🔁 RESTORE SAVED SESSION ON LOAD ───
// PIN entry is now only ever needed at Login and at Delete Event — everything else
// silently reuses the PIN restored here. Deferred to DOMContentLoaded because
// selectEvent() (needed to restore the POS page) lives in pos-booking.js, which
// hasn't loaded yet at the point app-core.js itself first runs.
document.addEventListener('DOMContentLoaded', async () => {
    const savedProfile = localStorage.getItem('housie_profile');
    if (!savedProfile) return;
    try {
        appState.pin = localStorage.getItem('housie_pin') || null;
        applyLoggedInProfile(JSON.parse(savedProfile));
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('appShell').style.display = 'flex';

        const lastPage = localStorage.getItem('housie_last_page') || 'dashboardPage';
        const lastEventRaw = localStorage.getItem('housie_last_event');

        if (lastPage === 'posPage' && lastEventRaw) {
            const lastEvent = JSON.parse(lastEventRaw);
            const { data: stillExists } = await sb.from('events').select('id').eq('id', lastEvent.id).maybeSingle();
            if (stillExists) {
                selectEvent(lastEvent.id, lastEvent.name, lastEvent.closed);
            } else {
                showPage('dashboardPage'); loadEventsFromBackend();
            }
        } else if (lastPage === 'customersPage') {
            showPage('customersPage'); loadCustomers();
        } else if (lastPage === 'usersPage') {
            showPage('usersPage'); openUserManagement();
        } else if (lastPage === 'settingsPage') {
            showPage('settingsPage');
        } else {
            showPage('dashboardPage'); loadEventsFromBackend();
        }
    } catch (e) { /* ignore corrupt saved session, fall back silently */ }
});

// ─── 🔐 STEP-UP PIN CONFIRMATION (used directly only by Delete Event now;
// also the underlying prompt getSessionPin falls back to when no PIN is cached yet) ───
// Resolves with the entered PIN string, or null if cancelled. The server verifies
// the PIN and permission fresh on every call — nothing here is trusted client-side.
function getConfirmedPin(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('pinConfirmModal');
        const input = document.getElementById('pinConfirmInput');
        const msgEl = document.getElementById('pinConfirmMessage');
        const errEl = document.getElementById('pinConfirmError');
        const submitBtn = document.getElementById('pinConfirmSubmitBtn');
        const cancelBtn = document.getElementById('pinConfirmCancelBtn');

        msgEl.innerText = message || "This action needs your PIN to continue.";
        errEl.style.display = 'none';
        input.value = '';
        modal.classList.add('open');
        setTimeout(() => input.focus(), 50);

        const cleanup = () => {
            modal.classList.remove('open');
            submitBtn.removeEventListener('click', onSubmit);
            cancelBtn.removeEventListener('click', onCancel);
            input.removeEventListener('keydown', onKey);
        };
        const onSubmit = () => {
            const val = input.value.trim();
            if (!val) { errEl.innerText = "Enter your PIN."; errEl.style.display = 'block'; return; }
            cleanup();
            resolve(val);
        };
        const onCancel = () => { cleanup(); resolve(null); };
        const onKey = (e) => { if (e.key === 'Enter') onSubmit(); if (e.key === 'Escape') onCancel(); };

        submitBtn.addEventListener('click', onSubmit);
        cancelBtn.addEventListener('click', onCancel);
        input.addEventListener('keydown', onKey);
    });
}

// Used for everyday actions (booking) that shouldn't nag on every click, but still
// need a real, server-verified PIN behind them. Reuses the PIN cached at login for
// this tab; if that's not available (e.g. after a page refresh restored the session
// without a PIN), asks once and caches the result in memory for the rest of the tab's session.
async function getSessionPin(message) {
    if (appState.pin) return appState.pin;
    while (true) {
        const entered = await getConfirmedPin(message);
        if (!entered) return null; // user cancelled
        try {
            const { data, error } = await sb.rpc('authenticate_staff', { input_pin: entered });
            if (error) throw error;
            if (data.success) {
                appState.pin = entered;
                return entered;
            }
            alert("Invalid PIN. Please try again.");
        } catch (e) {
            alert("Couldn't verify PIN — check your connection and try again.");
            return null;
        }
    }
}

// ─── NAVIGATION HANDLERS ───
document.getElementById('navDashboardBtn').addEventListener('click', () => { showPage('dashboardPage'); loadEventsFromBackend(); });
document.getElementById('navCustomersBtn').addEventListener('click', () => { showPage('customersPage'); loadCustomers(); });
document.getElementById('navUsersBtn').addEventListener('click', () => { showPage('usersPage'); openUserManagement(); });
document.getElementById('navSettingsBtn').addEventListener('click', () => { showPage('settingsPage'); });

document.getElementById('bottomNavDashboardBtn').addEventListener('click', () => { showPage('dashboardPage'); loadEventsFromBackend(); });
document.getElementById('bottomNavCustomersBtn').addEventListener('click', () => { showPage('customersPage'); loadCustomers(); });
document.getElementById('bottomNavUsersBtn').addEventListener('click', () => { showPage('usersPage'); openUserManagement(); });
document.getElementById('bottomNavSettingsBtn').addEventListener('click', () => { showPage('settingsPage'); });

// ─── 📅 DASHBOARD: EVENT HUB & STATS ───

document.getElementById('viewActiveEventsBtn').addEventListener('click', () => {
    currentEventsView = 'active';
    document.getElementById('viewActiveEventsBtn').classList.add('active');
    document.getElementById('viewClosedEventsBtn').classList.remove('active');
    loadEventsFromBackend();
});
document.getElementById('viewClosedEventsBtn').addEventListener('click', () => {
    currentEventsView = 'closed';
    document.getElementById('viewClosedEventsBtn').classList.add('active');
    document.getElementById('viewActiveEventsBtn').classList.remove('active');
    loadEventsFromBackend();
});

async function loadEventsFromBackend() {
    showSpinner();
    const statusFilter = currentEventsView === 'closed' ? 'Closed' : 'Active';
    const { data: summaryResult, error } = await sb.rpc('get_event_summary', { p_status: statusFilter });
    const events = summaryResult && summaryResult.success ? summaryResult.events : [];
    hideSpinner();
    if (error) { alert('Failed to load events: ' + error.message); return; }
    
    const grid = document.getElementById('eventCardsGrid');
    grid.innerHTML = ''; 

    let totalEvents = events.length;
    let totalSold = 0;
    let realRevenue = 0; 
    
    if (totalEvents === 0) {
        grid.innerHTML = `<p style="grid-column: 1/-1; color: var(--text3); text-align: center; padding: 40px;">${currentEventsView === 'closed' ? 'No closed events yet.' : 'No active events found. Click Create Event to begin.'}</p>`;
        if (currentEventsView === 'active') {
            document.getElementById('dashTotalEvents').innerText = "0";
            document.getElementById('dashTotalSold').innerText = "0";
            document.getElementById('dashTotalRevenue').innerText = canViewRevenue() ? "₹0" : "🔒 Hidden";
        }
        return;
    }

    events.forEach(event => {
        const ticketsSold = 600 - event.open_count;
        totalSold += ticketsSold;
        realRevenue += (event.revenue || 0);

        const card = document.createElement('div');
        card.className = 'event-card';
        card.innerHTML = `
          <div class="event-card-header">
            <div class="event-icon"><i data-lucide="${currentEventsView === 'closed' ? 'lock' : 'ticket'}"></i></div>
            <span style="font-size: 11px; font-weight: 700; background: var(--blueBg); color: var(--blue); padding: 4px 10px; border-radius: 999px;">${currentEventsView === 'closed' ? 'Closed' : event.open_count + ' Open'}</span>
          </div>
          <div class="event-name">${event.name}</div>
          <div class="event-date"><i data-lucide="calendar"></i> 600 Capacity | ${ticketsSold} Sold</div>
        `;
        card.onclick = () => selectEvent(event.id, event.name, currentEventsView === 'closed');
        grid.appendChild(card);
    });
    
    if (currentEventsView === 'active') {
        document.getElementById('dashTotalEvents').innerText = totalEvents;
        document.getElementById('dashTotalSold').innerText = totalSold.toLocaleString();
        document.getElementById('dashTotalRevenue').innerText = canViewRevenue()
            ? `₹${realRevenue.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
            : "🔒 Hidden";
    }
    lucide.createIcons();
}

// ─── 👥 CUSTOMERS DIRECTORY ───
// ─── 👥 CUSTOMERS DIRECTORY ───
let allCustomersCache = [];
let customerViewType = 'table';

async function populateCustomerEventSelect() {
    const sel = document.getElementById('customerFilterEventSelect');
    const { data: events, error } = await sb.from('events').select('id, name').order('name');
    if (error) return;
    sel.innerHTML = '<option value="">Choose an event...</option>' +
        events.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
}

document.getElementById('customerFilterMode').addEventListener('change', (e) => {
    const isEventMode = e.target.value === 'event';
    document.getElementById('customerFilterEventSelect').style.display = isEventMode ? 'inline-block' : 'none';
    if (isEventMode) {
        populateCustomerEventSelect();
        return; // wait for an actual event pick before reloading
    }
    loadCustomers();
});
document.getElementById('customerFilterEventSelect').addEventListener('change', () => loadCustomers());
document.getElementById('customerSearchInput').addEventListener('input', () => renderCustomersList());

document.getElementById('customerViewTableBtn').addEventListener('click', () => setCustomerView('table'));
document.getElementById('customerViewCardBtn').addEventListener('click', () => setCustomerView('card'));
function setCustomerView(type) {
    customerViewType = type;
    document.getElementById('customerViewTableBtn').classList.toggle('active', type === 'table');
    document.getElementById('customerViewCardBtn').classList.toggle('active', type === 'card');
    document.getElementById('customersTableWrap').style.display = type === 'table' ? 'block' : 'none';
    document.getElementById('customersCardGrid').style.display = type === 'card' ? 'grid' : 'none';
    renderCustomersList();
}

async function loadCustomers() {
    showSpinner();
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text3);">Loading customers...</td></tr>';

    const mode = document.getElementById('customerFilterMode').value;
    let eventId = null, activeOnly = false;
    if (mode === 'event') {
        eventId = document.getElementById('customerFilterEventSelect').value;
        if (!eventId) { hideSpinner(); allCustomersCache = []; renderCustomersList(); return; }
    } else if (mode === 'active') {
        activeOnly = true;
    }

    const { data, error } = await sb.rpc('get_customers', { p_event_id: eventId || null, p_active_only: activeOnly });
    hideSpinner();
    if (error || !data.success) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--red);">Failed to load customers.</td></tr>';
        return;
    }
    allCustomersCache = data.customers.sort((a, b) => b.spent - a.spent);
    renderCustomersList();
}

function getFilteredCustomers() {
    const term = document.getElementById('customerSearchInput').value.trim().toLowerCase();
    return term
        ? allCustomersCache.filter(c =>
            c.name.toLowerCase().includes(term) ||
            (c.phone || '').toLowerCase().includes(term) ||
            (c.address || '').toLowerCase().includes(term))
        : allCustomersCache;
}

function renderCustomersList() {
    const filtered = getFilteredCustomers();
    if (customerViewType === 'table') renderCustomersTable(filtered);
    else renderCustomersCards(filtered);
}

function renderCustomersTable(list) {
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '';
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text3);">No customers found.</td></tr>';
        return;
    }
    list.forEach(cust => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Customer Name"><strong>${cust.name}</strong></td>
            <td data-label="Address" style="color: var(--text3);">${cust.address || '-'}</td>
            <td data-label="Mobile Number" style="font-family: var(--mono); color: var(--text3);">${cust.phone || '-'}</td>
            <td data-label="Total Tickets"><span style="background: var(--blueBg); color: var(--blue); padding: 2px 8px; border-radius: 4px; font-weight: 600;">${cust.tickets}</span></td>
            <td data-label="Total Amount" style="color: var(--green); font-weight: 700;">₹${cust.spent.toFixed(2)}</td>
            <td data-label="Action" style="text-align:center; white-space:nowrap;">
                <button class="btn btn-ghost cust-edit-btn" style="padding: 5px 10px; font-size: 11.5px;"><i data-lucide="edit-2"></i></button>
                <button class="btn btn-ghost cust-delete-btn" style="padding: 5px 10px; font-size: 11.5px; color: var(--red, #e74c3c);"><i data-lucide="trash-2"></i></button>
            </td>
        `;
        tr.querySelector('.cust-edit-btn').addEventListener('click', () => openCustomerForm(cust));
        tr.querySelector('.cust-delete-btn').addEventListener('click', () => deleteCustomer(cust));
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

function renderCustomersCards(list) {
    const grid = document.getElementById('customersCardGrid');
    grid.innerHTML = '';
    if (list.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; color: var(--text3); text-align:center; padding:40px;">No customers found.</p>';
        return;
    }
    list.forEach(cust => {
        const card = document.createElement('div');
        card.className = 'event-card';
        card.innerHTML = `
          <div class="event-card-header">
            <div class="event-icon"><i data-lucide="user"></i></div>
            <span style="font-size: 11px; font-weight: 700; background: var(--blueBg); color: var(--blue); padding: 4px 10px; border-radius: 999px;">${cust.tickets} tickets</span>
          </div>
          <div class="event-name">${cust.name}</div>
          <div class="event-date" style="font-family: var(--mono);">${cust.phone || 'No phone'}</div>
          <div class="event-date">${cust.address || 'No address'}</div>
          <div style="margin-top:8px; font-weight:700; color: var(--green);">₹${cust.spent.toFixed(2)}</div>
          <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-ghost cust-edit-btn" style="flex:1; font-size:11.5px;"><i data-lucide="edit-2"></i> Edit</button>
            <button class="btn btn-ghost cust-delete-btn" style="flex:1; font-size:11.5px; color: var(--red, #e74c3c);"><i data-lucide="trash-2"></i> Delete</button>
          </div>
        `;
        card.querySelector('.cust-edit-btn').addEventListener('click', () => openCustomerForm(cust));
        card.querySelector('.cust-delete-btn').addEventListener('click', () => deleteCustomer(cust));
        grid.appendChild(card);
    });
    lucide.createIcons();
}

// ─── Add / Edit Customer ───
const customerFormModal = document.getElementById('customerFormModal');
function openCustomerForm(cust) {
    document.getElementById('customerFormTitle').innerHTML = cust ? '<i data-lucide="edit-2"></i> Edit Customer' : '<i data-lucide="user-plus"></i> Add Customer';
    document.getElementById('customerFormId').value = cust ? cust.id : '';
    document.getElementById('customerFormName').value = cust ? cust.name : '';
    document.getElementById('customerFormPhone').value = cust ? (cust.phone || '') : '';
    document.getElementById('customerFormAddress').value = cust ? (cust.address || '') : '';
    document.getElementById('customerFormNotes').value = cust ? (cust.notes || '') : '';
    document.getElementById('customerFormError').style.display = 'none';
    customerFormModal.classList.add('open');
    lucide.createIcons();
}
document.getElementById('openAddCustomerBtn').addEventListener('click', () => openCustomerForm(null));
document.getElementById('customerFormCancelBtn').addEventListener('click', () => customerFormModal.classList.remove('open'));

document.getElementById('customerFormSaveBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('customerFormError');
    errEl.style.display = 'none';

    const id = document.getElementById('customerFormId').value;
    const name = document.getElementById('customerFormName').value.trim();
    const phone = document.getElementById('customerFormPhone').value.trim();
    const address = document.getElementById('customerFormAddress').value.trim();
    const notes = document.getElementById('customerFormNotes').value.trim();

    if (!name) { errEl.innerText = "Name is required."; errEl.style.display = 'block'; return; }

    const pin = await getSessionPin(id ? "Confirm your PIN to save this customer." : "Confirm your PIN to add this customer.");
    if (!pin) return;

    showSpinner();
    const result = id
        ? await sb.rpc('update_customer', { requestor_pin: pin, p_id: id, p_name: name, p_phone: phone, p_address: address, p_notes: notes })
        : await sb.rpc('add_customer', { requestor_pin: pin, p_name: name, p_phone: phone, p_address: address, p_notes: notes });

    hideSpinner();
    const { data, error } = result;
    if (error || !data.success) {
        errEl.innerText = (data && data.error) || (error && error.message) || "Failed to save customer.";
        errEl.style.display = 'block';
        return;
    }
    customerFormModal.classList.remove('open');
    loadCustomers();
});

async function deleteCustomer(cust) {
    const confirmDelete = confirm(`⚠️ Delete ${cust.name}?\n\nThis removes their record and purchase history, and releases any tickets currently booked to them back to Open.`);
    if (!confirmDelete) return;

    const pin = await getSessionPin(`Confirm your PIN to permanently delete ${cust.name}.`);
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('delete_customer', { requestor_pin: pin, p_id: cust.id });
    hideSpinner();
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to delete customer.");
        return;
    }
    loadCustomers();
}

// ─── 📤 EXPORT CUSTOMERS ───
document.getElementById('exportCustomersBtn').addEventListener('click', () => {
    const list = getFilteredCustomers();
    if (list.length === 0) return alert("No customers to export.");
    downloadCSV(
        `customers_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Name', 'Address', 'Mobile Number', 'Total Tickets', 'Total Amount'],
        list.map(c => [c.name, c.address || '', c.phone || '', c.tickets, c.spent.toFixed(2)])
    );
});

// ─── 📥 IMPORT CUSTOMERS ───
document.getElementById('importCustomersBtn').addEventListener('click', () => {
    document.getElementById('customerImportFile').click();
});

document.getElementById('customerImportFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            e.target.value = ''; // reset so re-selecting the same file fires change again
            const rows = results.data;
            if (rows.length === 0) return alert("The CSV file appears to be empty.");

            // Case-insensitive header matching: accepts Name/name, Phone/Mobile Number, Address, Notes
            const getCol = (row, ...names) => {
                for (const key of Object.keys(row)) {
                    if (names.some(n => key.trim().toLowerCase() === n.toLowerCase())) return row[key];
                }
                return '';
            };

            const parsed = rows.map(r => ({
                name: (getCol(r, 'Name', 'Customer Name') || '').trim(),
                phone: (getCol(r, 'Phone', 'Mobile Number', 'Mobile') || '').trim(),
                address: (getCol(r, 'Address') || '').trim(),
                notes: (getCol(r, 'Notes') || '').trim()
            })).filter(r => r.name.length > 0);

            if (parsed.length === 0) return alert("No valid rows found — make sure the CSV has a 'Name' column.");

            const confirmImport = confirm(`Import ${parsed.length} customer(s) from this file?\n\nExisting customers with a matching name+phone will have their address/notes updated.`);
            if (!confirmImport) return;

            const pin = await getSessionPin("Confirm your PIN to import customers.");
            if (!pin) return;

            showSpinner();
            let success = 0, failed = 0;
            for (const row of parsed) {
                const { data, error } = await sb.rpc('add_customer', {
                    requestor_pin: pin, p_name: row.name, p_phone: row.phone, p_address: row.address, p_notes: row.notes
                });
                if (error || !data.success) failed++; else success++;
            }
            hideSpinner();
            alert(`Import complete — ${success} saved${failed > 0 ? `, ${failed} failed` : ''}.`);
            loadCustomers();
        },
        error: () => alert("Couldn't read that CSV file.")
    });
});

// ─── 📝 MODAL: CREATE EVENT ───
const createModal = document.getElementById('createSheetModal');
document.getElementById('topbarCreateEventBtn').addEventListener('click', () => {
    document.getElementById('newSheetNameInput').value = '';
    createModal.classList.add('open');
});
document.getElementById('cancelCreateSheetBtn').addEventListener('click', () => createModal.classList.remove('open'));
document.getElementById('closeCreateSheetModal').addEventListener('click', () => createModal.classList.remove('open'));

document.getElementById('confirmCreateSheetBtn').addEventListener('click', async () => {
    let newName = document.getElementById('newSheetNameInput').value.trim();
    if(!newName) return alert('Enter a valid name');

    const pin = await getSessionPin("Confirm your PIN to create this event.");
    if (!pin) return;

    createModal.classList.remove('open');
    showSpinner();

    const { data, error } = await sb.rpc('create_event', { requestor_pin: pin, p_name: newName });
    hideSpinner();
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || 'Failed to create event.');
        return;
    }

    if(document.getElementById('dashboardPage').classList.contains('active')) {
        loadEventsFromBackend(); 
    }
});

// ─── 🔒 CLOSE / REOPEN EVENT ───
document.getElementById('closeEventBtn').addEventListener('click', async () => {
    const confirmClose = confirm(`Close ${appState.activeEventName}?\n\nIt will move to the Closed tab and become read-only. You can reopen it later.`);
    if (!confirmClose) return;

    const pin = await getSessionPin("Confirm your PIN to close this event.");
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('close_event', { requestor_pin: pin, p_event_id: appState.activeEvent });
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to close event.");
        hideSpinner();
        return;
    }
    showPage('dashboardPage');
    loadEventsFromBackend();
});

document.getElementById('reopenEventBtn').addEventListener('click', async () => {
    const pin = await getSessionPin("Confirm your PIN to reopen this event.");
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('reopen_event', { requestor_pin: pin, p_event_id: appState.activeEvent });
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to reopen event.");
        hideSpinner();
        return;
    }
    selectEvent(appState.activeEvent, appState.activeEventName, false);
});

// ─── 🗑️ DELETE EVENT ───
document.getElementById('deleteEventBtn').addEventListener('click', async () => {
    const confirmDelete = confirm(`⚠️ WARNING: Delete ${appState.activeEventName}?\n\nThis permanently deletes all 600 tickets.`);
    if (!confirmDelete) return;

    const pin = await getConfirmedPin("Confirm your PIN to permanently delete this event.");
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('delete_event', { requestor_pin: pin, p_event_id: appState.activeEvent });
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to delete event.");
        hideSpinner();
        return;
    }
    showPage('dashboardPage');
    loadEventsFromBackend(); 
});


// ─── 👤 STAFF & PERMISSIONS (Super Admin only) ───
async function openUserManagement() {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text3);">Loading staff...</td></tr>';

    const pin = await getSessionPin("Confirm your PIN to view staff & permissions.");
    if (!pin) { showPage('dashboardPage'); loadEventsFromBackend(); return; }

    showSpinner();
    const { data, error } = await sb.rpc('get_users', { requestor_pin: pin });
    hideSpinner();
    if (error || !data.success) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text3);">Could not load staff list.</td></tr>';
        return;
    }
    renderUsersTable(data.users, pin);
}

function renderUsersTable(users, confirmedPin) {
    const tbody = document.getElementById('usersTableBody');
    tbody.innerHTML = '';
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text3);">No staff found.</td></tr>';
        return;
    }

    const check = (val) => val ? '<i data-lucide="check" style="color: var(--green, #2ecc71); width:16px;"></i>' : '<span style="color: var(--text3);">—</span>';

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Name"><strong>${u.name}</strong>${u.isSuperAdmin ? ' <span style="font-size:11px; color: var(--blue);">(Super Admin)</span>' : ''}</td>
            <td data-label="PIN" title="PINs are hashed and can't be displayed — edit to set a new one">••••</td>
            <td data-label="Book" style="text-align:center;">${check(u.rights.canBook)}</td>
            <td data-label="Create Event" style="text-align:center;">${check(u.rights.canCreateEvent)}</td>
            <td data-label="Close Event" style="text-align:center;">${check(u.rights.canCloseEvent)}</td>
            <td data-label="Delete Event" style="text-align:center;">${check(u.rights.canDeleteEvent)}</td>
            <td data-label="View Revenue" style="text-align:center;">${check(u.rights.canViewRevenue)}</td>
            <td data-label="Status">${u.status === 'Active' ? '<span style="color: var(--green, #2ecc71);">Active</span>' : '<span style="color: var(--text3);">Disabled</span>'}</td>
            <td data-label="Action" style="text-align: center; white-space: nowrap;">
                ${u.isSuperAdmin ? '<span style="color: var(--text3); font-size:12px;">Protected</span>' : `
                <button class="btn btn-ghost edit-user-btn" style="padding: 5px 10px; font-size: 11.5px;"><i data-lucide="edit-2"></i></button>
                <button class="btn btn-ghost delete-user-btn" style="padding: 5px 10px; font-size: 11.5px; color: var(--red, #e74c3c);"><i data-lucide="trash-2"></i></button>
                `}
            </td>
        `;
        if (!u.isSuperAdmin) {
            tr.querySelector('.edit-user-btn').addEventListener('click', () => openUserForm(u));
            tr.querySelector('.delete-user-btn').addEventListener('click', () => deleteUser(u, confirmedPin));
        }
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

const ROLE_PRESETS = {
    cashier: { canBook: true, canCreateEvent: false, canCloseEvent: false, canDeleteEvent: false, canViewRevenue: false },
    manager: { canBook: true, canCreateEvent: true, canCloseEvent: true, canDeleteEvent: false, canViewRevenue: true }
};
const RIGHT_CHECKBOX_IDS = { canBook: 'rightCanBook', canCreateEvent: 'rightCanCreateEvent', canCloseEvent: 'rightCanCloseEvent', canDeleteEvent: 'rightCanDeleteEvent', canViewRevenue: 'rightCanViewRevenue' };

function applyRolePreset(roleKey) {
    const preset = ROLE_PRESETS[roleKey];
    if (!preset) return; // 'custom' — leave checkboxes as-is
    Object.keys(RIGHT_CHECKBOX_IDS).forEach(right => {
        document.getElementById(RIGHT_CHECKBOX_IDS[right]).checked = preset[right];
    });
}
function detectRoleFromRights(rights) {
    for (const key of Object.keys(ROLE_PRESETS)) {
        const preset = ROLE_PRESETS[key];
        if (Object.keys(preset).every(r => !!rights[r] === preset[r])) return key;
    }
    return 'custom';
}
document.getElementById('userFormRole').addEventListener('change', (e) => applyRolePreset(e.target.value));
Object.values(RIGHT_CHECKBOX_IDS).forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        document.getElementById('userFormRole').value = 'custom';
    });
});

const userFormModal = document.getElementById('userFormModal');
function openUserForm(user) {
    document.getElementById('userFormTitle').innerHTML = user ? '<i data-lucide="edit-2"></i> Edit Staff' : '<i data-lucide="user-plus"></i> Add Staff';
    document.getElementById('userFormId').value = user ? user.id : '';
    document.getElementById('userFormName').value = user ? user.name : '';
    document.getElementById('userFormPin').value = ''; // PINs are hashed — never shown, never pre-filled
    document.getElementById('userFormPin').placeholder = user ? 'Leave blank to keep current PIN' : 'e.g. 4521';
    document.getElementById('rightCanBook').checked = user ? user.rights.canBook : true;
    document.getElementById('rightCanCreateEvent').checked = user ? user.rights.canCreateEvent : false;
    document.getElementById('rightCanCloseEvent').checked = user ? user.rights.canCloseEvent : false;
    document.getElementById('rightCanDeleteEvent').checked = user ? user.rights.canDeleteEvent : false;
    document.getElementById('rightCanViewRevenue').checked = user ? user.rights.canViewRevenue : false;
    document.getElementById('userFormRole').value = user ? detectRoleFromRights(user.rights) : 'cashier';
    document.getElementById('userFormStatusGroup').style.display = user ? 'block' : 'none';
    document.getElementById('userFormStatus').value = user ? user.status : 'Active';
    document.getElementById('userFormError').style.display = 'none';
    userFormModal.classList.add('open');
    lucide.createIcons();
}
document.getElementById('openAddUserBtn').addEventListener('click', () => openUserForm(null));
document.getElementById('userFormCancelBtn').addEventListener('click', () => userFormModal.classList.remove('open'));

document.getElementById('userFormSaveBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('userFormError');
    errEl.style.display = 'none';

    const id = document.getElementById('userFormId').value;
    const name = document.getElementById('userFormName').value.trim();
    const newPin = document.getElementById('userFormPin').value.trim();
    const rights = {
        canBook: document.getElementById('rightCanBook').checked,
        canCreateEvent: document.getElementById('rightCanCreateEvent').checked,
        canCloseEvent: document.getElementById('rightCanCloseEvent').checked,
        canDeleteEvent: document.getElementById('rightCanDeleteEvent').checked,
        canViewRevenue: document.getElementById('rightCanViewRevenue').checked
    };

    if (!name) { errEl.innerText = "Name is required."; errEl.style.display = 'block'; return; }
    if (!id && !/^\d{4,6}$/.test(newPin)) { errEl.innerText = "PIN must be 4-6 digits."; errEl.style.display = 'block'; return; }
    if (id && newPin && !/^\d{4,6}$/.test(newPin)) { errEl.innerText = "PIN must be 4-6 digits."; errEl.style.display = 'block'; return; }

    const pin = await getSessionPin(id ? "Confirm your PIN to save changes to this staff member." : "Confirm your PIN to add this staff member.");
    if (!pin) return;

    showSpinner();
    let result;
    if (id) {
        const status = document.getElementById('userFormStatus').value;
        result = await sb.rpc('update_staff_user', {
            requestor_pin: pin, p_id: id, p_name: name, p_pin: newPin || null,
            p_can_book: rights.canBook, p_can_create_event: rights.canCreateEvent,
            p_can_close_event: rights.canCloseEvent, p_can_delete_event: rights.canDeleteEvent,
            p_can_view_revenue: rights.canViewRevenue, p_status: status
        });
    } else {
        result = await sb.rpc('add_staff_user', {
            requestor_pin: pin, p_name: name, p_pin: newPin,
            p_can_book: rights.canBook, p_can_create_event: rights.canCreateEvent,
            p_can_close_event: rights.canCloseEvent, p_can_delete_event: rights.canDeleteEvent,
            p_can_view_revenue: rights.canViewRevenue
        });
    }
    const { data, error } = result;
    if (error || !data.success) {
        hideSpinner();
        errEl.innerText = (data && data.error) || (error && error.message) || "Failed to save staff member.";
        errEl.style.display = 'block';
        return;
    }
    userFormModal.classList.remove('open');
    openUserManagement();
});

async function deleteUser(user, confirmedPin) {
    const confirmDelete = confirm(`Remove ${user.name} from staff?\n\nThey will no longer be able to log in.`);
    if (!confirmDelete) return;

    const pin = await getSessionPin(`Confirm your PIN to remove ${user.name}.`);
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('delete_staff_user', { requestor_pin: pin, p_id: user.id });
    hideSpinner();
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to remove staff member.");
        return;
    }
    openUserManagement();
}

// ─── 🔑 BULK CHANGE PINs ───
const bulkPinModal = document.getElementById('bulkPinModal');
let bulkPinUsers = []; // full user objects loaded fresh whenever the modal opens

document.getElementById('openBulkPinBtn').addEventListener('click', async () => {
    const pin = await getSessionPin("Confirm your PIN to change staff PINs.");
    if (!pin) return;

    showSpinner();
    const { data, error } = await sb.rpc('get_users', { requestor_pin: pin });
    hideSpinner();
    if (error || !data.success) return;

    bulkPinUsers = data.users.filter(u => !u.isSuperAdmin); // Super Admin PIN isn't editable here
    renderBulkPinList();
    document.getElementById('bulkPinError').style.display = 'none';
    bulkPinModal.classList.add('open');
    bulkPinModal.dataset.confirmedPin = pin; // reuse this admin's confirmation for the save step too
});

function renderBulkPinList() {
    const list = document.getElementById('bulkPinList');
    list.innerHTML = '';
    if (bulkPinUsers.length === 0) {
        list.innerHTML = '<p style="color: var(--text3);">No editable staff found.</p>';
        return;
    }
    // PINs are hashed — there's nothing to pre-fill. Every field starts blank;
    // leave it blank to keep that person's current PIN unchanged.
    bulkPinUsers.forEach(u => {
        const row = document.createElement('div');
        row.innerHTML = `
            <label style="font-size: 12.5px; color: var(--text3); display:block; margin-bottom: 4px;">${u.name}</label>
            <input type="text" class="form-input bulk-pin-input" data-user-id="${u.id}" inputmode="numeric" maxlength="6" placeholder="Leave blank to keep current PIN">
        `;
        list.appendChild(row);
    });
}

document.getElementById('bulkPinCancelBtn').addEventListener('click', () => bulkPinModal.classList.remove('open'));

document.getElementById('bulkPinSaveBtn').addEventListener('click', async () => {
    const errEl = document.getElementById('bulkPinError');
    errEl.style.display = 'none';

    const inputs = Array.from(document.querySelectorAll('.bulk-pin-input'));
    const entries = inputs.map(inp => ({
        id: inp.dataset.userId,
        newPin: inp.value.trim(),
        user: bulkPinUsers.find(u => u.id === inp.dataset.userId)
    })).filter(e => e.newPin.length > 0); // blank = unchanged, skip entirely

    if (entries.length === 0) {
        bulkPinModal.classList.remove('open');
        return;
    }
    for (const e of entries) {
        if (!/^\d{4,6}$/.test(e.newPin)) {
            errEl.innerText = `${e.user.name}'s PIN must be 4-6 digits.`;
            errEl.style.display = 'block';
            return;
        }
    }
    // Duplicate-PIN checking against unchanged staff can't happen client-side anymore
    // (their current PINs are hashed, not visible here) — each update_staff_user call
    // checks server-side and will reject if it collides with anyone else's PIN.

    const pin = bulkPinModal.dataset.confirmedPin;
    showSpinner();
    const failed = [];
    for (const e of entries) {
        const { data, error } = await sb.rpc('update_staff_user', {
            requestor_pin: pin, p_id: e.id, p_name: e.user.name, p_pin: e.newPin,
            p_can_book: e.user.rights.canBook, p_can_create_event: e.user.rights.canCreateEvent,
            p_can_close_event: e.user.rights.canCloseEvent, p_can_delete_event: e.user.rights.canDeleteEvent,
            p_can_view_revenue: e.user.rights.canViewRevenue, p_status: e.user.status
        });
        if (error || !data.success) {
            failed.push(`${e.user.name}: ${(data && data.error) || (error && error.message)}`);
        }
    }
    hideSpinner();

    if (failed.length > 0) {
        errEl.innerText = `Some PINs couldn't be updated — ${failed.join('; ')}`;
        errEl.style.display = 'block';
    } else {
        bulkPinModal.classList.remove('open');
    }
    // Refresh the staff table using the already-confirmed PIN, no need to re-prompt
    const { data: refreshed, error: refreshErr } = await sb.rpc('get_users', { requestor_pin: pin });
    if (!refreshErr && refreshed.success) renderUsersTable(refreshed.users, pin);
});