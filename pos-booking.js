// ══════════════════════════════════════════════════════════════════
// POS-BOOKING.JS — load this AFTER app-core.js
// Covers: Batch Import & OCR, POS ticket grid, Booking/Edit modal,
// Live Booking Ledger, WhatsApp grid export.
// Uses globals from app-core.js (appState, showSpinner/
// hideSpinner, showPage, getSessionPin, canBookRight, etc).
// ══════════════════════════════════════════════════════════════════

// ─── 🤖 BATCH IMPORT & OCR LOGIC ───
const batchModal = document.getElementById('batchModal');

// ─── 📤 EXPORT EVENT TICKETS (full 600-row grid, not just booked ones) ───
document.getElementById('exportEventTicketsBtn').addEventListener('click', () => {
    if (!appState.tickets || appState.tickets.length === 0) return alert("No tickets to export.");
    downloadCSV(
        `${appState.activeEventName || 'event'}_tickets_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Ticket Number', 'Status', 'Customer Name', 'Phone', 'Payment', 'Amount'],
        appState.tickets.map(t => [t.number, t.status, t.customer || '', t.phone || '', t.payment || '', t.amount || 0])
    );
});

// ─── 📥 IMPORT EVENT TICKETS (restore/bulk-set the grid from a matching CSV) ───
document.getElementById('importEventTicketsBtn').addEventListener('click', () => {
    document.getElementById('eventTicketsImportFile').click();
});

document.getElementById('eventTicketsImportFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
            e.target.value = '';
            const getCol = (row, ...names) => {
                for (const key of Object.keys(row)) {
                    if (names.some(n => key.trim().toLowerCase() === n.toLowerCase())) return row[key];
                }
                return '';
            };

            const rows = results.data.map(r => ({
                number: parseInt(getCol(r, 'Ticket Number', 'Number')),
                status: (getCol(r, 'Status') || '').trim(),
                customer: (getCol(r, 'Customer Name', 'Customer') || '').trim(),
                phone: (getCol(r, 'Phone') || '').trim(),
                payment: (getCol(r, 'Payment') || '').trim(),
                amount: parseFloat(getCol(r, 'Amount')) || 0
            })).filter(r => !isNaN(r.number) && r.status && r.status !== 'Open');

            if (rows.length === 0) return alert("No bookable rows found — make sure the CSV has Ticket Number and Status columns, with Status not 'Open'.");

            const confirmImport = confirm(`Import ${rows.length} ticket booking(s) into ${appState.activeEventName}?\n\nThis will overwrite the current booking for any matching ticket numbers.`);
            if (!confirmImport) return;

            const pin = await getSessionPin("Confirm your PIN to import tickets.");
            if (!pin) return;

            showSpinner();
            let success = 0, failed = 0;
            for (const row of rows) {
                const { data, error } = await sb.rpc('book_tickets', {
                    requestor_pin: pin, p_event_id: appState.activeEvent, p_ticket_numbers: [row.number],
                    p_status: row.status, p_customer_name: row.customer, p_phone: row.phone,
                    p_payment: row.payment, p_amount: row.amount
                });
                if (error || !data.success) failed++; else success++;
            }
            hideSpinner();
            alert(`Import complete — ${success} ticket(s) updated${failed > 0 ? `, ${failed} failed` : ''}.`);
            selectEvent(appState.activeEvent, appState.activeEventName, appState.eventClosed);
        },
        error: () => alert("Couldn't read that CSV file.")
    });
});

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

    const pin = await getSessionPin("Confirm your PIN to save this batch import.");
    if (!pin) return;

    batchModal.classList.remove('open');
    showSpinner();
    const { data, error } = await sb.rpc('book_tickets', {
        requestor_pin: pin, p_event_id: appState.activeEvent, p_ticket_numbers: ticketsToBook,
        p_status: "Booked", // Defaults batch imports to Booked
        p_customer_name: customer, p_phone: "", p_payment: "Cash", p_amount: 0
    });
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Batch booking failed.");
        hideSpinner();
        return;
    }
    selectEvent(appState.activeEvent, appState.activeEventName); 
});


// ─── 📷 QR / BARCODE SCANNER — scan a ticket instead of manually selecting it ───
let qrScannerInstance = null;

document.getElementById('openScannerBtn').addEventListener('click', async () => {
    document.getElementById('scannerModal').classList.add('open');
    document.getElementById('scannerStatus').innerText = 'Starting camera...';
    renderScannedChips();
    lucide.createIcons();

    try {
        qrScannerInstance = new Html5Qrcode("qrReaderView");
        await qrScannerInstance.start(
            { facingMode: "environment" },
            { fps: 10, qrbox: { width: 240, height: 240 } },
            onTicketScanned,
            () => {} // per-frame "no code found" noise — ignore
        );
        document.getElementById('scannerStatus').innerText = 'Point the camera at a ticket code...';
    } catch (err) {
        document.getElementById('scannerStatus').innerText = "Couldn't access the camera — check camera permissions for this site.";
    }
});

async function stopScanner() {
    if (qrScannerInstance) {
        try { await qrScannerInstance.stop(); qrScannerInstance.clear(); } catch (e) {}
        qrScannerInstance = null;
    }
}

document.getElementById('scannerCancelBtn').addEventListener('click', async () => {
    await stopScanner();
    document.getElementById('scannerModal').classList.remove('open');
});

document.getElementById('scannerDoneBtn').addEventListener('click', async () => {
    await stopScanner();
    document.getElementById('scannerModal').classList.remove('open');
    if (appState.selectedTickets.length > 0) openNewBookingModal();
});

function onTicketScanned(decodedText) {
    // Ticket codes are expected to encode just the ticket number as plain text (e.g. "247").
    // Fall back to pulling the first run of digits out of the scanned text for barcodes/QRs
    // that wrap the number in other formatting.
    const match = decodedText.match(/\d+/);
    const status = document.getElementById('scannerStatus');
    if (!match) { status.innerText = `Unrecognized code: "${decodedText}"`; return; }

    const num = parseInt(match[0]);
    if (num < 1 || num > 600) { status.innerText = `"${decodedText}" isn't a valid ticket number.`; return; }

    const ticket = appState.tickets.find(t => t.number == num);
    if (!ticket) { status.innerText = `Ticket #${num} not found in this event.`; return; }
    if (ticket.status !== 'Open') { status.innerText = `Ticket #${num} is already booked (${ticket.status}).`; return; }
    if (appState.selectedTickets.includes(num)) { status.innerText = `Ticket #${num} already scanned.`; return; }

    appState.selectedTickets.push(num);
    updateUISelection();
    renderScannedChips();
    status.innerText = `✅ Added ticket #${num} — keep scanning or tap Done.`;
}

function renderScannedChips() {
    const box = document.getElementById('scannedTicketsChips');
    box.innerHTML = appState.selectedTickets.map(n =>
        `<span style="background: var(--blueBg); color: var(--blue); padding: 4px 10px; border-radius: 999px; font-size: 12.5px; font-weight: 600;">#${n}</span>`
    ).join('');
}

// ─── 🎟️ POS & TICKET GRID ───
async function selectEvent(eventId, eventName, isClosed = false) {
    appState.activeEvent = eventId;       // now a Supabase UUID, not a Sheet name
    appState.activeEventName = eventName; // kept separately for display text
    appState.eventClosed = isClosed;
    document.getElementById('posTitle').innerText = eventName;
    showPage('posPage');
    
    showSpinner();
    const { data: result, error } = await sb.rpc('get_event_tickets', { p_event_id: eventId });
    hideSpinner();
    if (error || !result.success) { alert('Failed to load tickets: ' + ((result && result.error) || (error && error.message))); return; }
    
    appState.tickets = result.tickets;
    appState.selectedTickets = [];
    appState.currentFilter = 'all';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const allTabBtn = document.querySelector('.tab-btn[data-filter="all"]');
    if (allTabBtn) allTabBtn.classList.add('active');

    // 🔒 Toggle read-only UI for closed events
    document.getElementById('closedEventBanner').style.display = isClosed ? 'block' : 'none';
    const canClose = appState.isSuperAdmin || appState.rights.canCloseEvent;
    const canDelete = appState.isSuperAdmin || appState.rights.canDeleteEvent;
    document.getElementById('closeEventBtn').style.display = (!isClosed && canClose) ? 'inline-flex' : 'none';
    document.getElementById('reopenEventBtn').style.display = (isClosed && canClose) ? 'inline-flex' : 'none';
    document.getElementById('deleteEventBtn').style.display = (!isClosed && canDelete) ? 'inline-flex' : 'none';
    document.getElementById('openBatchBtn').style.display = (isClosed || !canBookRight()) ? 'none' : 'inline-flex';
    document.getElementById('openScannerBtn').style.display = (isClosed || !canBookRight()) ? 'none' : 'inline-flex';
    document.getElementById('importEventTicketsBtn').style.display = (isClosed || !canBookRight()) ? 'none' : 'inline-flex';
    const floatBtn = document.getElementById('floatingBookBtn');
    if (floatBtn) floatBtn.style.display = (isClosed || !canBookRight()) ? 'none' : floatBtn.style.display;
    const bookBtn = document.getElementById('openBookingModalBtn');
    if (bookBtn) bookBtn.style.display = (isClosed || !canBookRight()) ? 'none' : bookBtn.style.display;
    
    renderTicketGrid();
    lucide.createIcons();
    localStorage.setItem('housie_last_event', JSON.stringify({ id: eventId, name: eventName, closed: isClosed }));
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
    if (appState.eventClosed) return; // 🔒 read-only: no booking on closed events
    if (!canBookRight()) return; // 🔒 staff without booking rights can't select tickets
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
    document.getElementById('currentBookingSheet').innerText = appState.activeEventName;
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
    const hintEl = document.getElementById('perTicketHint');
    if (hintEl) hintEl.innerText = '';
}

document.getElementById('openBookingModalBtn').addEventListener('click', openNewBookingModal);
document.getElementById('floatingBookBtn').addEventListener('click', openNewBookingModal);

// 💰 Live "per ticket" split hint as the staff types the total amount / ticket list
function updatePerTicketHint() {
    const hint = document.getElementById('perTicketHint');
    if (!hint) return;
    const tickets = document.getElementById('manualTicketNumbers').value
        .split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    const total = parseFloat(document.getElementById('amount').value) || 0;
    if (tickets.length > 1 && total > 0) {
        hint.innerText = `≈ ₹${(total / tickets.length).toFixed(2)} per ticket across ${tickets.length} tickets`;
    } else {
        hint.innerText = '';
    }
}
document.getElementById('amount').addEventListener('input', updatePerTicketHint);
document.getElementById('manualTicketNumbers').addEventListener('input', updatePerTicketHint);

// 🔎 Customer autocomplete — suggests existing customers as "Name (Address)" so two
// people with the same name are distinguishable. Selecting one fills phone too.
let customerSuggestTimer = null;
document.getElementById('fullName').addEventListener('input', (e) => {
    clearTimeout(customerSuggestTimer);
    const query = e.target.value.trim();
    const box = document.getElementById('customerSuggestions');
    if (query.length < 2) { box.style.display = 'none'; box.innerHTML = ''; return; }

    customerSuggestTimer = setTimeout(async () => {
        const { data, error } = await sb.rpc('search_customers_autocomplete', { p_query: query });
        if (error || !data || !data.length) { box.style.display = 'none'; box.innerHTML = ''; return; }

        box.innerHTML = data.map(c => {
            const label = c.address ? `${c.name} <span style="color:var(--text3);">(${c.address})</span>` : c.name;
            return `<div class="customer-suggestion" data-name="${c.name.replace(/"/g, '&quot;')}" data-phone="${(c.phone || '').replace(/"/g, '&quot;')}" style="padding:10px 12px; cursor:pointer; border-bottom:1px solid var(--border2);">${label}</div>`;
        }).join('');
        box.style.display = 'block';

        box.querySelectorAll('.customer-suggestion').forEach(el => {
            el.addEventListener('click', () => {
                document.getElementById('fullName').value = el.dataset.name;
                document.getElementById('phoneNumber').value = el.dataset.phone;
                box.style.display = 'none';
                box.innerHTML = '';
            });
            el.addEventListener('mouseenter', () => el.style.background = 'var(--bg3, rgba(255,255,255,0.05))');
            el.addEventListener('mouseleave', () => el.style.background = 'transparent');
        });
    }, 250);
});
document.addEventListener('click', (e) => {
    const box = document.getElementById('customerSuggestions');
    if (box && !box.contains(e.target) && e.target.id !== 'fullName') { box.style.display = 'none'; }
});

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

    // 💰 Split the entered TOTAL amount evenly across all tickets being booked
    const totalAmount = parseFloat(amount) || 0;
    const perTicketAmount = ticketsToBook.length > 0 ? (totalAmount / ticketsToBook.length) : 0;

    const pin = await getSessionPin("Confirm your PIN to save this booking.");
    if (!pin) return;

    bookingModal.classList.remove('open');
    showSpinner();

    const { data, error } = await sb.rpc('book_tickets', {
        requestor_pin: pin, p_event_id: appState.activeEvent, p_ticket_numbers: ticketsToBook,
        p_status: status, p_customer_name: name, p_phone: phone, p_payment: paymentMode,
        p_amount: perTicketAmount.toFixed(2)
    });
    if (error || !data.success) {
        alert((data && data.error) || (error && error.message) || "Failed to update tickets. Please try again.");
        hideSpinner();
        return;
    }
    selectEvent(appState.activeEvent, appState.activeEventName); 
});

// ─── 📊 LIVE LEDGER LOGIC ───
let lastLedgerDisplayData = [];

document.getElementById('exportLedgerBtn').addEventListener('click', () => {
    if (lastLedgerDisplayData.length === 0) return alert("No ledger rows to export.");
    downloadCSV(
        `${appState.activeEventName || 'event'}_ledger_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Ticket(s)', 'Name', 'Phone', 'Status', 'Payment', 'Amount'],
        lastLedgerDisplayData.map(r => [r.displayTicket, r.name, r.phone, r.status, r.payment, r.amount])
    );
});

function renderLedger() {
    const tbody = document.getElementById('ledgerTableBody');
    tbody.innerHTML = '';

    let bookedTickets = appState.tickets.filter(t => t.status !== 'Open');
    if (bookedTickets.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text3);">No tickets booked yet.</td></tr>';
        lastLedgerDisplayData = [];
        return;
    }

    const combine = document.getElementById('combineNamesToggle').checked;
    const sortType = document.getElementById('ledgerSortSelect').value;
    const searchTerm = document.getElementById('ledgerSearchInput').value.trim().toLowerCase();
    let displayData = [];

    if (combine) {
        // 🔧 FIX: group by name + phone (not name alone), so two different customers who
        // happen to share a name are never merged into one row.
        const grouped = {};
        bookedTickets.forEach(t => {
            const nameKey = t.customer.trim().toLowerCase();
            if (!nameKey) return;
            const key = nameKey + '|' + (t.phone || '').trim();
            if (!grouped[key]) {
                grouped[key] = {
                    tickets: [], originalName: t.customer, phone: t.phone,
                    status: t.status, payment: t.payment || "Cash", totalAmount: 0, modifiedAt: 0,
                    mixedStatus: false, mixedPayment: false
                };
            }
            const g = grouped[key];
            g.tickets.push(t.number);
            g.totalAmount += parseFloat(t.amount || 0);
            // 🔧 FIX: previously the group silently kept only the FIRST ticket's status/payment,
            // even when the customer's tickets actually had different statuses/payment modes —
            // showing a misleading single value and risking overwriting all of them on Edit+Save.
            if (t.status !== g.status) g.mixedStatus = true;
            if ((t.payment || "Cash") !== g.payment) g.mixedPayment = true;
            const tMod = t.modifiedAt ? new Date(t.modifiedAt).getTime() : 0;
            if (tMod > g.modifiedAt) g.modifiedAt = tMod;
        });

        displayData = Object.values(grouped).map(g => ({
            displayTicket: g.tickets.join(', '), sortTicket: g.tickets[0],
            name: g.originalName, phone: g.phone,
            status: g.mixedStatus ? 'Mixed' : g.status,
            payment: g.mixedPayment ? 'Mixed' : g.payment,
            amount: g.totalAmount.toFixed(2), modifiedAt: g.modifiedAt,
            mixed: g.mixedStatus || g.mixedPayment
        }));
    } else {
        displayData = bookedTickets.map(t => ({
            displayTicket: t.number, sortTicket: t.number,
            name: t.customer, phone: t.phone, status: t.status, payment: t.payment || "Cash",
            amount: parseFloat(t.amount || 0).toFixed(2),
            modifiedAt: t.modifiedAt ? new Date(t.modifiedAt).getTime() : 0,
            mixed: false
        }));
    }

    if (searchTerm) {
        displayData = displayData.filter(row =>
            row.name.toLowerCase().includes(searchTerm) ||
            (row.phone || '').toLowerCase().includes(searchTerm) ||
            row.displayTicket.toString().toLowerCase().includes(searchTerm)
        );
    }

    displayData.sort((a, b) => {
        if (sortType === 'number') return a.sortTicket - b.sortTicket;
        if (sortType === 'name') return a.name.localeCompare(b.name);
        if (sortType === 'status') return a.status.localeCompare(b.status);
        if (sortType === 'modified') return b.modifiedAt - a.modifiedAt;
        return 0;
    });

    lastLedgerDisplayData = displayData;

    if (displayData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 24px; color: var(--text3);">No matching bookings found.</td></tr>';
        return;
    }

    displayData.forEach(row => {
        let badgeClass = 'sb-advanced'; 
        if (row.status.includes('Paid')) badgeClass = 'sb-paid';
        else if (row.status.includes('Booked')) badgeClass = 'sb-booked';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td data-label="Ticket(s)"><strong style="font-family: var(--mono); color: var(--text);">${row.displayTicket}</strong></td>
            <td data-label="Name">${row.name}</td>
            <td data-label="Phone" style="font-family: var(--mono); color: var(--text3);">${row.phone}</td>
            <td data-label="Status"><span class="status-badge ${badgeClass}" title="${row.mixed ? 'This customer\'s tickets have different statuses — turn off Combine to see each one' : ''}">${row.status}</span></td>
            <td data-label="Payment">${row.payment}</td>
            <td data-label="Amount" style="font-weight: 700; color: var(--text);">₹${row.amount}</td>
            <td data-label="Action" style="text-align: center;">
                ${(appState.eventClosed || !canBookRight() || row.mixed) ? '' : '<button class="btn btn-ghost edit-row-btn" style="padding: 6px 12px; font-size: 11.5px;"><i data-lucide="edit-2"></i> Edit</button>'}
            </td>
        `;
        
        const editBtn = tr.querySelector('.edit-row-btn');
        if (editBtn) editBtn.addEventListener('click', () => {
            const removeWrapper = document.getElementById('removeBookingWrapper');
            if (removeWrapper) removeWrapper.style.display = 'flex';
            
            document.getElementById('currentBookingSheet').innerText = appState.activeEventName;
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
            updatePerTicketHint();
        });
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

document.getElementById('combineNamesToggle').addEventListener('change', renderLedger);
document.getElementById('ledgerSortSelect').addEventListener('change', renderLedger);
document.getElementById('ledgerSearchInput').addEventListener('input', renderLedger);

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
    footer.innerText = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()} — Housie Pro — ${appState.activeEventName}`;
    
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