// ─── INITIALIZATION ───
lucide.createIcons();

// ⚠️ IMPORTANT: PASTE YOUR GOOGLE WEB APP URL HERE ⚠️
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyKv5kxLErjM8dqOcMpaRlX4PjllKXsQjIwewIvbyOFCRAvkC3l2ClHEMYJ5V5aQ937/exec';

const appState = { staffName: null, activeEvent: null, tickets: [], selectedTickets: [], currentFilter: 'all' };

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
function showPage(pageId) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    if(pageId === 'dashboardPage') document.getElementById('navDashboardBtn').classList.add('active');
    if(pageId === 'customersPage') document.getElementById('navCustomersBtn').classList.add('active');
    if(pageId === 'settingsPage') document.getElementById('navSettingsBtn').classList.add('active');
}
function showSpinner() { document.getElementById('loadingSpinner').style.display = 'block'; }
function hideSpinner() { document.getElementById('loadingSpinner').style.display = 'none'; }

// ─── 📡 API CONNECTION TOOL ───
async function fetchAPI(action, payload = {}) {
    payload.action = action;
    try {
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            redirect: "follow", 
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }, 
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);
        return data;
    } catch (error) {
        alert("API Error: " + error.message);
        hideSpinner();
        throw error;
    }
}

// ─── 🔐 SECURE LOGIN LOGIC ───
document.getElementById('loginBtn').addEventListener('click', async () => {
    const user = document.getElementById('staffLoginSelect').value;
    const pin = document.getElementById('staffLoginPin').value;
    const err = document.getElementById('loginError');
    
    if(!pin) {
        err.innerText = "Please enter a PIN.";
        err.style.display = 'block';
        return;
    }

    showSpinner();
    try {
        // ✨ NEW: Sending the login check securely to the Google Apps Script Backend!
        await fetchAPI('authenticate', { user: user, pin: pin });
        
        appState.staffName = user;
        document.getElementById('loggedInStaffDisplay').innerText = `👋 ${user}`;
        err.style.display = 'none';
        
        document.getElementById('loginPage').style.display = 'none';
        document.getElementById('appShell').style.display = 'flex';
        
        showPage('dashboardPage');
        loadEventsFromBackend();
    } catch (error) {
        err.innerText = "Invalid PIN. Access Denied.";
        err.style.display = 'block';
    }
    hideSpinner();
});
document.getElementById('staffLoginPin').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });

document.getElementById('logoutBtn').addEventListener('click', () => {
    appState.staffName = null; 
    document.getElementById('appShell').style.display = 'none';
    document.getElementById('loginPage').style.display = 'flex';
    document.getElementById('staffLoginPin').value = '';
});

// ─── NAVIGATION HANDLERS ───
document.getElementById('navDashboardBtn').addEventListener('click', () => { showPage('dashboardPage'); loadEventsFromBackend(); });
document.getElementById('navCustomersBtn').addEventListener('click', () => { showPage('customersPage'); loadCustomers(); });
document.getElementById('navSettingsBtn').addEventListener('click', () => { showPage('settingsPage'); });

// ─── 📅 DASHBOARD: EVENT HUB & STATS ───
async function loadEventsFromBackend() {
    showSpinner();
    const data = await fetchAPI('getAvailableEvents');
    hideSpinner();
    
    const grid = document.getElementById('eventCardsGrid');
    grid.innerHTML = ''; 

    let totalEvents = data.events.length;
    let totalSold = 0;
    let realRevenue = 0; 
    
    if (totalEvents === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; color: var(--text3); text-align: center; padding: 40px;">No active events found. Click Create Event to begin.</p>';
        document.getElementById('dashTotalEvents').innerText = "0";
        document.getElementById('dashTotalSold').innerText = "0";
        document.getElementById('dashTotalRevenue').innerText = "₹0";
        return;
    }

    data.events.forEach(event => {
        const cleanName = event.name.replace('BOOK_', '');
        const ticketsSold = 600 - event.openCount;
        totalSold += ticketsSold;
        realRevenue += (event.revenue || 0);

        const card = document.createElement('div');
        card.className = 'event-card';
        card.innerHTML = `
          <div class="event-card-header">
            <div class="event-icon"><i data-lucide="ticket"></i></div>
            <span style="font-size: 11px; font-weight: 700; background: var(--blueBg); color: var(--blue); padding: 4px 10px; border-radius: 999px;">${event.openCount} Open</span>
          </div>
          <div class="event-name">${cleanName}</div>
          <div class="event-date"><i data-lucide="calendar"></i> 600 Capacity | ${ticketsSold} Sold</div>
        `;
        card.onclick = () => selectEvent(event.name);
        grid.appendChild(card);
    });
    
    document.getElementById('dashTotalEvents').innerText = totalEvents;
    document.getElementById('dashTotalSold').innerText = totalSold.toLocaleString();
    document.getElementById('dashTotalRevenue').innerText = `₹${realRevenue.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`; 
    lucide.createIcons();
}

// ─── 👥 CUSTOMERS DIRECTORY ───
async function loadCustomers() {
    showSpinner();
    const tbody = document.getElementById('customersTableBody');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text3);">Loading customers...</td></tr>';
    
    try {
        const data = await fetchAPI('getAllCustomers');
        hideSpinner();
        
        tbody.innerHTML = '';
        if(data.customers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text3);">No customers found across active events.</td></tr>';
            return;
        }
        
        data.customers.sort((a,b) => b.spent - a.spent);

        data.customers.forEach(cust => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${cust.name}</strong></td>
                <td style="font-family: var(--mono); color: var(--text3);">${cust.phone || '-'}</td>
                <td><span style="background: var(--blueBg); color: var(--blue); padding: 2px 8px; border-radius: 4px; font-weight: 600;">${cust.tickets}</span></td>
                <td style="color: var(--green); font-weight: 700;">₹${cust.spent.toFixed(2)}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--red);">Failed to load customers.</td></tr>';
        hideSpinner();
    }
}

// ─── 📝 MODAL: CREATE EVENT ───
const createModal = document.getElementById('createSheetModal');
document.getElementById('topbarCreateEventBtn').addEventListener('click', () => {
    document.getElementById('newSheetNameInput').value = '';
    createModal.classList.add('open');
});
document.getElementById('cancelCreateSheetBtn').addEventListener('click', () => createModal.classList.remove('open'));
document.getElementById('closeCreateSheetModal').addEventListener('click', () => createModal.classList.remove('open'));

document.getElementById('confirmCreateSheetBtn').addEventListener('click', async () => {
    let newName = document.getElementById('newSheetNameInput').value.trim().replace(/\s+/g, '_').toUpperCase();
    if(!newName) return alert('Enter a valid name');
    if(!newName.startsWith('BOOK_')) newName = 'BOOK_' + newName;

    createModal.classList.remove('open');
    showSpinner();
    
    await fetchAPI('createNewEventSheet', { sheetName: newName, staffName: appState.staffName });
    if(document.getElementById('dashboardPage').classList.contains('active')) {
        loadEventsFromBackend(); 
    } else {
        hideSpinner();
    }
});

// ─── 🤖 BATCH IMPORT & OCR LOGIC ───
const batchModal = document.getElementById('batchModal');
document.getElementById('openBatchBtn').addEventListener('click', () => {
    document.getElementById('ocrImageInput').value = '';
    document.getElementById('batchTicketNumbers').value = '';
    document.getElementById('batchCustomerName').value = '';
    document.getElementById('ocrStatus').innerText = '';
    batchModal.classList.add('open');
});
document.getElementById('closeBatchModalBtn').addEventListener('click', () => batchModal.classList.remove('open'));

// Trigger Tesseract OCR on image upload
document.getElementById('ocrImageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusText = document.getElementById('ocrStatus');
    statusText.innerText = "⏳ Scanning image with AI...";
    statusText.style.color = "var(--orange)";
    
    try {
        const worker = await Tesseract.createWorker('eng');
        const ret = await worker.recognize(file);
        const text = ret.data.text;
        
        // Extract all numbers between 1 and 600
        let nums = text.match(/\b\d+\b/g) || [];
        nums = nums.map(Number).filter(n => n >= 1 && n <= 600);
        
        // Remove duplicates and sort sequentially
        nums = [...new Set(nums)].sort((a,b) => a - b);
        
        document.getElementById('batchTicketNumbers').value = nums.join(', ');
        statusText.innerText = `✅ Found ${nums.length} valid tickets in image!`;
        statusText.style.color = "var(--green)";
        await worker.terminate();
    } catch (error) {
        statusText.innerText = "❌ OCR Failed. Please manually type the numbers.";
        statusText.style.color = "var(--red)";
    }
});

// Process Batch Submission
document.getElementById('confirmBatchBtn').addEventListener('click', async () => {
    const rawData = document.getElementById('batchTicketNumbers').value;
    const customer = document.getElementById('batchCustomerName').value.trim() || "Batch Import";
    
    let ticketsToBook = rawData.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if(ticketsToBook.length === 0) return alert("No valid tickets to batch book.");
    
    batchModal.classList.remove('open');
    showSpinner();
    try {
        await fetchAPI('bookTickets', {
            eventName: appState.activeEvent,
            tickets: ticketsToBook,
            status: "Booked", // Defaults batch imports to Booked
            customer: customer,
            phone: "",
            payment: "Cash",
            amount: 0,
            staffName: appState.staffName
        });
        selectEvent(appState.activeEvent); 
    } catch (error) {
        alert("Batch booking failed.");
        hideSpinner();
    }
});


// ─── 🎟️ POS & TICKET GRID ───
async function selectEvent(eventName) {
    appState.activeEvent = eventName;
    document.getElementById('posTitle').innerText = eventName.replace('BOOK_', '');
    showPage('posPage');
    
    showSpinner();
    const data = await fetchAPI('getTicketsForEvent', { sheetName: eventName });
    hideSpinner();
    
    appState.tickets = data.tickets;
    appState.selectedTickets = [];
    appState.currentFilter = 'all';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.tab-btn[data-filter="all"]').classList.add('active');
    
    renderTicketGrid();
}
document.getElementById('backBtn').addEventListener('click', () => { showPage('dashboardPage'); loadEventsFromBackend(); });

function renderTicketGrid() {
    const grid = document.getElementById('ticketGrid');
    grid.innerHTML = '';
    
    const filter = appState.currentFilter;

    // ✨ FIXED: "Individual" view now rigidly locks into exactly 15 Columns!
    if (filter === 'all') {
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(15, 1fr)';
        grid.style.gap = '4px'; 
    } else {
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(12, max-content)';
        grid.style.gap = '6px';
        grid.style.justifyContent = 'start';
    }
    
    appState.tickets.forEach((ticket, index) => {
        const box = document.createElement('div');
        box.className = `ticket-box status-${ticket.status.toLowerCase()} t-${ticket.status.toLowerCase()}`;
        box.innerText = ticket.number;
        
        if (ticket.status !== 'Open') {
            const tooltip = document.createElement('span');
            tooltip.className = 'tooltip-text';
            tooltip.innerText = `👤 ${ticket.customer}\n📞 ${ticket.phone}`;
            box.appendChild(tooltip);
        }

        box.onclick = () => toggleTicketSelection(ticket.number);
        applyGroupingStyles(box, ticket.number);
        grid.appendChild(box);
    });
    updateUISelection();
    renderLedger();
}

function applyGroupingStyles(element, num) {
    const filter = appState.currentFilter;
    element.style.marginRight = "0px"; 
    
    if (filter === 'all') return; 
    if (num % 12 === 0) return; 

    if (filter === 'set' && num % 6 === 0) element.style.marginRight = "18px";
    if (filter === 'halfSet' && num % 3 === 0) element.style.marginRight = "18px";
    if (filter === 'twoTicket' && num % 2 === 0) element.style.marginRight = "18px";
}

function toggleTicketSelection(clickedNum) {
    let group = [clickedNum];
    const filter = appState.currentFilter;

    if (filter === 'set') {
        const start = Math.floor((clickedNum - 1) / 6) * 6 + 1;
        group = Array.from({length: 6}, (_, i) => start + i);
    } else if (filter === 'halfSet') {
        const start = Math.floor((clickedNum - 1) / 3) * 3 + 1;
        group = Array.from({length: 3}, (_, i) => start + i);
    } else if (filter === 'twoTicket') {
        const start = Math.floor((clickedNum - 1) / 2) * 2 + 1;
        group = Array.from({length: 2}, (_, i) => start + i);
    }

    group.forEach(num => {
        const ticket = appState.tickets.find(t => t.number == num);
        if (ticket && ticket.status === 'Open') {
            const index = appState.selectedTickets.indexOf(num);
            if (index > -1) appState.selectedTickets.splice(index, 1);
            else appState.selectedTickets.push(num);
        }
    });
    updateUISelection();
}

function updateUISelection() {
    const boxes = document.querySelectorAll('.ticket-box');
    boxes.forEach(box => {
        const num = parseInt(box.innerText);
        if (appState.selectedTickets.includes(num)) {
            box.classList.add('t-selected');
        } else {
            box.classList.remove('t-selected');
        }
    });
    
    document.getElementById('selectedCount').innerText = appState.selectedTickets.length;
    
    const openBtn = document.getElementById('openBookingModalBtn');
    const floatBtn = document.getElementById('floatingBookBtn');

    if (appState.selectedTickets.length > 0) {
        openBtn.style.display = 'flex';
        if (floatBtn) floatBtn.style.display = 'flex';
    } else {
        openBtn.style.display = 'none';
        if (floatBtn) floatBtn.style.display = 'none';
    }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelector('.tab-btn.active').classList.remove('active');
        this.classList.add('active');
        appState.currentFilter = this.getAttribute('data-filter');
        appState.selectedTickets = []; 
        renderTicketGrid();
    });
});

// ─── 📝 MODAL: BOOKING / EDITING ───
const bookingModal = document.getElementById('bookingModal');
const bookingErrorMsg = document.getElementById('bookingFormError');

function openNewBookingModal() {
    document.getElementById('currentBookingSheet').innerText = appState.activeEvent.replace('BOOK_', '');
    document.getElementById('ticketsToBookDisplay').innerText = appState.selectedTickets.join(', ');
    document.getElementById('manualTicketNumbers').value = appState.selectedTickets.join(', ');
    
    document.getElementById('fullName').value = '';
    document.getElementById('phoneNumber').value = '';
    document.getElementById('amount').value = '';
    
    const removeWrapper = document.getElementById('removeBookingWrapper');
    if (removeWrapper) removeWrapper.style.display = 'none';
    
    const bookedRadio = document.querySelector('input[name="initialStatus"][value="Booked"]');
    if(bookedRadio) bookedRadio.checked = true;

    bookingErrorMsg.style.display = 'none';
    bookingModal.classList.add('open');
}

document.getElementById('openBookingModalBtn').addEventListener('click', openNewBookingModal);
document.getElementById('floatingBookBtn').addEventListener('click', openNewBookingModal);

document.getElementById('closeBookingModal').addEventListener('click', () => bookingModal.classList.remove('open'));
document.getElementById('cancelBookingBtn').addEventListener('click', () => bookingModal.classList.remove('open'));

document.getElementById('confirmBookingBtn').addEventListener('click', async () => {
    const rawTicketInput = document.getElementById('manualTicketNumbers').value;
    const status = document.querySelector('input[name="initialStatus"]:checked').value;
    const name = document.getElementById('fullName').value.trim();
    const phone = document.getElementById('phoneNumber').value.trim();
    const paymentMode = document.getElementById('paymentMode').value;
    const amount = document.getElementById('amount').value;

    if (status !== 'Open' && !name) {
        bookingErrorMsg.innerText = "Please enter a Full Name.";
        bookingErrorMsg.style.display = 'block';
        return;
    }

    let ticketsToBook = rawTicketInput.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (ticketsToBook.length === 0) {
        bookingErrorMsg.innerText = "No valid tickets selected.";
        bookingErrorMsg.style.display = 'block';
        return;
    }

    bookingModal.classList.remove('open');
    showSpinner();

    try {
        await fetchAPI('bookTickets', {
            eventName: appState.activeEvent,
            tickets: ticketsToBook,
            status: status,
            customer: name,
            phone: phone,
            payment: paymentMode,
            amount: amount,
            staffName: appState.staffName
        });
        selectEvent(appState.activeEvent); 
    } catch (error) {
        alert("Failed to update tickets. Please try again.");
        hideSpinner();
    }
});

// ─── 📊 LIVE LEDGER LOGIC ───
function renderLedger() {
    const tbody = document.getElementById('ledgerTableBody');
    tbody.innerHTML = '';

    let bookedTickets = appState.tickets.filter(t => t.status !== 'Open');
    if (bookedTickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text3);">No tickets booked yet.</td></tr>';
        return;
    }

    const combine = document.getElementById('combineNamesToggle').checked;
    const sortType = document.getElementById('ledgerSortSelect').value;
    let displayData = [];

    if (combine) {
        const grouped = {};
        bookedTickets.forEach(t => {
            const key = t.customer.trim().toLowerCase();
            if (!key) return; 
            if (!grouped[key]) {
                grouped[key] = { tickets: [], originalName: t.customer, phone: t.phone, status: t.status, payment: t.payment || "Cash", totalAmount: 0 };
            }
            grouped[key].tickets.push(t.number);
            grouped[key].totalAmount += parseFloat(t.amount || 0);
        });

        displayData = Object.values(grouped).map(g => ({
            displayTicket: g.tickets.join(', '), sortTicket: g.tickets[0],
            name: g.originalName, phone: g.phone, status: g.status, payment: g.payment,
            amount: g.totalAmount.toFixed(2)
        }));
    } else {
        displayData = bookedTickets.map(t => ({
            displayTicket: t.number, sortTicket: t.number,
            name: t.customer, phone: t.phone, status: t.status, payment: t.payment || "Cash",
            amount: parseFloat(t.amount || 0).toFixed(2)
        }));
    }

    displayData.sort((a, b) => {
        if (sortType === 'number') return a.sortTicket - b.sortTicket;
        if (sortType === 'name') return a.name.localeCompare(b.name);
        if (sortType === 'status') return a.status.localeCompare(b.status);
        return 0;
    });

    displayData.forEach(row => {
        let badgeClass = 'sb-advanced'; 
        if (row.status.includes('Paid')) badgeClass = 'sb-paid';
        else if (row.status.includes('Booked')) badgeClass = 'sb-booked';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Ticket(s)"><strong style="font-family: var(--mono); color: var(--text);">${row.displayTicket}</strong></td>
            <td data-label="Name">${row.name}</td>
            <td data-label="Phone" style="font-family: var(--mono); color: var(--text3);">${row.phone}</td>
            <td data-label="Status"><span class="status-badge ${badgeClass}">${row.status}</span></td>
            <td data-label="Payment">${row.payment}</td>
            <td data-label="Amount" style="font-weight: 700; color: var(--text);">₹${row.amount}</td>
            <td data-label="Action" style="text-align: center;">
                <button class="btn btn-ghost edit-row-btn" style="padding: 6px 12px; font-size: 11.5px;"><i data-lucide="edit-2"></i> Edit</button>
            </td>
        `;
        
        tr.querySelector('.edit-row-btn').addEventListener('click', () => {
            const removeWrapper = document.getElementById('removeBookingWrapper');
            if (removeWrapper) removeWrapper.style.display = 'flex';
            
            document.getElementById('currentBookingSheet').innerText = appState.activeEvent.replace('BOOK_', '');
            document.getElementById('ticketsToBookDisplay').innerText = row.displayTicket;
            document.getElementById('manualTicketNumbers').value = row.displayTicket;
            document.getElementById('fullName').value = row.name;
            document.getElementById('phoneNumber').value = row.phone;
            document.getElementById('amount').value = row.amount;
            
            const statusRadio = document.querySelector(`input[name="initialStatus"][value="${row.status.split(' / ')[0]}"]`);
            if (statusRadio) {
                statusRadio.checked = true;
            }

            bookingErrorMsg.style.display = 'none';
            bookingModal.classList.add('open');
        });
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

document.getElementById('combineNamesToggle').addEventListener('change', renderLedger);
document.getElementById('ledgerSortSelect').addEventListener('change', renderLedger);

// ─── 🗑️ DELETE EVENT ───
document.getElementById('deleteEventBtn').addEventListener('click', async () => {
    const confirmDelete = confirm(`⚠️ WARNING: Delete ${appState.activeEvent.replace('BOOK_', '')}?\n\nThis permanently deletes all 600 tickets.`);
    if (confirmDelete) {
        showSpinner();
        try {
            await fetchAPI('deleteEvent', { eventName: appState.activeEvent });
            showPage('dashboardPage');
            loadEventsFromBackend(); 
        } catch (error) {
            alert("Failed to delete event.");
            hideSpinner();
        }
    }
});

// ─── 📸 SHARE GRID AS JPG ───
document.getElementById('shareGridBtn').addEventListener('click', async () => {
    showSpinner();
    const container = document.createElement('div');
    container.id = 'exportGridContainer';
    const grid = document.createElement('div');
    grid.className = 'export-grid';
    
    appState.tickets.forEach(t => {
        const cell = document.createElement('div');
        cell.className = 'export-cell ' + (t.status === 'Open' ? '' : 'export-booked');
        cell.innerText = t.number;
        grid.appendChild(cell);
    });
    
    const footer = document.createElement('div');
    footer.className = 'export-footer';
    const today = new Date();
    footer.innerText = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()} — Housie Pro — ${appState.activeEvent.replace('BOOK_', '')}`;
    
    container.appendChild(grid);
    container.appendChild(footer);
    document.body.appendChild(container);

    try {
        const canvas = await html2canvas(container, { scale: 2 });
        document.body.removeChild(container);
        canvas.toBlob(async (blob) => {
            const fileName = `${appState.activeEvent}_Grid.jpg`;
            const file = new File([blob], fileName, { type: 'image/jpeg' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file], title: 'Housie Chart' }); } catch (e) {}
            } else {
                const link = document.createElement('a');
                link.download = fileName; link.href = canvas.toDataURL('image/jpeg', 0.9); link.click();
            }
            hideSpinner();
        }, 'image/jpeg', 0.9);
    } catch (err) { hideSpinner(); if(document.body.contains(container)) document.body.removeChild(container); }
});