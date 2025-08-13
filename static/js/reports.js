// reports.js - Sistema avanzato di reporting con esportazione PDF professionale

// Variabili globali
let allDevices = [];
let currentReportData = null;
let reportCounter = 1;

// Configurazione azienda
const COMPANY_CONFIG = {
    name: "Traccar GPS Solutions",
    subtitle: "Sistema di Monitoraggio e Tracking GPS",
    address: "Via Roma 123, 00100 Roma",
    phone: "+39 06 1234567",
    email: "info@traccar.it",
    website: "www.traccar.it",
    logoBase64: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iNDAiIGN5PSI0MCIgcj0iNDAiIGZpbGw9IiMwZDZlZmQiLz4KPHN2ZyB4PSIyMCIgeT0iMjAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+CjxwYXRoIGQ9Ik0xMiAyQzYuNDggMiAyIDYuNDggMiAxMnM0LjQ4IDEwIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0tMiAxNWwtNS01IDEuNDEtMS40MUwxMCAxNC4xN2w3LjU5LTcuNTlMMTkgOGwtOSA5eiIvPgo8L3N2Zz4KPC9zdmc+"
};

// Inizializzazione documento
document.addEventListener('DOMContentLoaded', function() {
    loadDevices();
    setupEventListeners();
    setDefaultDates();
    initializeCompanyInfo();
});

// ==================== INIZIALIZZAZIONE ====================

function initializeCompanyInfo() {
    document.getElementById('companyName').textContent = COMPANY_CONFIG.name;
    document.getElementById('companyLogo').src = COMPANY_CONFIG.logoBase64;
    document.getElementById('reportDate').textContent = new Date().toLocaleDateString('it-IT');
    document.getElementById('reportNumber').textContent = `#${String(reportCounter).padStart(4, '0')}`;
}

function setupEventListeners() {
    // Gestione preset date
    document.getElementById('datePreset').addEventListener('change', function() {
        const customRange = document.getElementById('customDateRange');
        const pdfOptions = document.getElementById('pdfOptions');

        if (this.value === 'custom') {
            customRange.style.display = 'block';
        } else {
            customRange.style.display = 'none';
            setPresetDates(this.value);
        }
    });

    // Selezione tutti i dispositivi
    document.getElementById('selectAllDevices').addEventListener('change', function() {
        const deviceSelect = document.getElementById('deviceSelect');
        const options = deviceSelect.options;

        for (let i = 0; i < options.length; i++) {
            options[i].selected = this.checked;
        }
    });

    // Mostra opzioni PDF quando abilitato
    document.getElementById('exportPDF').addEventListener('mouseenter', function() {
        if (!this.disabled) {
            document.getElementById('pdfOptions').style.display = 'block';
        }
    });
}

function loadDevices() {
    fetch('/api/devices')
        .then(response => response.json())
        .then(devices => {
            allDevices = devices;
            const select = document.getElementById('deviceSelect');
            select.innerHTML = '';

            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = `${device.name} (${device.uniqueId})`;
                option.setAttribute('data-category', device.category || 'unknown');
                select.appendChild(option);
            });

            showAlert(`Caricati ${devices.length} dispositivi`, 'success');
        })
        .catch(error => {
            console.error('Errore nel caricamento dispositivi:', error);
            showAlert('Errore nel caricamento dei dispositivi', 'danger');
        });
}

function setDefaultDates() {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

    document.getElementById('fromDate').value = yesterday.toISOString().split('T')[0];
    document.getElementById('toDate').value = today.toISOString().split('T')[0];
}

function setPresetDates(preset) {
    const now = new Date();
    let fromDate, toDate;

    switch (preset) {
        case 'today':
            fromDate = new Date(now);
            toDate = new Date(now);
            break;
        case 'yesterday':
            fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            toDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
        case 'week':
            fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            toDate = new Date(now);
            break;
        case 'month':
            fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
            toDate = new Date(now);
            break;
    }

    document.getElementById('fromDate').value = fromDate.toISOString().split('T')[0];
    document.getElementById('toDate').value = toDate.toISOString().split('T')[0];
}

// ==================== GENERAZIONE REPORT ====================

function generateReport() {
    const selectedDevices = getSelectedDeviceIds();
    const dateRange = getDateRange();
    const reportType = document.getElementById('reportType').value;

    if (selectedDevices.length === 0) {
        showAlert('Seleziona almeno un dispositivo', 'warning');
        return;
    }

    if (!dateRange.from || !dateRange.to) {
        showAlert('Seleziona un periodo valido', 'warning');
        return;
    }

    // Mostra loading
    showLoadingState(selectedDevices.length);

    // Calcola giorni per API
    const diffTime = Math.abs(dateRange.to - dateRange.from);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Genera report basato sul tipo
    switch (reportType) {
        case 'summary':
            generateSummaryReport(selectedDevices, diffDays);
            break;
        case 'routes':
            generateRoutesReport(selectedDevices, diffDays);
            break;
        case 'stops':
            generateStopsReport(selectedDevices, diffDays);
            break;
        case 'trips':
            generateTripsReport(selectedDevices, diffDays);
            break;
        case 'performance':
            generatePerformanceReport(selectedDevices, diffDays);
            break;
    }
}

function showLoadingState(deviceCount) {
    const reportContent = document.getElementById('reportContent');
    reportContent.innerHTML = `
        <div class="text-center p-5">
            <div class="spinner-border text-primary mb-3" role="status" style="width: 3rem; height: 3rem;">
                <span class="visually-hidden">Generazione report...</span>
            </div>
            <h5>Generazione Report in corso...</h5>
            <p class="text-muted">Elaborazione dati per ${deviceCount} dispositivi</p>
            <div class="progress mt-3" style="height: 6px;">
                <div class="progress-bar progress-bar-striped progress-bar-animated"
                     style="width: 0%" id="loadingProgress"></div>
            </div>
        </div>
    `;

    // Simula progresso
    let progress = 0;
    const progressBar = document.getElementById('loadingProgress');
    const interval = setInterval(() => {
        progress += Math.random() * 20;
        if (progress >= 90) progress = 90;
        progressBar.style.width = progress + '%';

        if (progress >= 90) {
            clearInterval(interval);
        }
    }, 300);
}

function generateSummaryReport(deviceIds, days) {
    const promises = deviceIds.map(deviceId =>
        fetch(`/api/positions?deviceId=${deviceId}&hours=${days * 24}`)
            .then(response => response.json())
            .then(positions => ({ deviceId, positions }))
    );

    Promise.all(promises)
        .then(results => {
            const reportData = processSummaryData(results);
            renderSummaryReport(reportData);
            renderPDFPreview(reportData);
            updateStatistics(reportData);
            enableExportButtons();
            showReportInfo();
        })
        .catch(error => {
            console.error('Errore nella generazione del report:', error);
            showAlert('Errore nella generazione del report', 'danger');
            showEmptyReport();
        });
}

function generateRoutesReport(deviceIds, days) {
    showAlert('Report Percorsi - Funzionalità avanzata in sviluppo', 'info');
    // Placeholder per report percorsi più dettagliato
    generateSummaryReport(deviceIds, days);
}

function generateStopsReport(deviceIds, days) {
    showAlert('Report Soste - Funzionalità avanzata in sviluppo', 'info');
    // Placeholder per analisi soste
    generateSummaryReport(deviceIds, days);
}

function generateTripsReport(deviceIds, days) {
    showAlert('Report Viaggi - Funzionalità avanzata in sviluppo', 'info');
    // Placeholder per dettaglio viaggi
    generateSummaryReport(deviceIds, days);
}

function generatePerformanceReport(deviceIds, days) {
    showAlert('Report Performance - Funzionalità avanzata in sviluppo', 'info');
    // Placeholder per analisi performance
    generateSummaryReport(deviceIds, days);
}

// ==================== ELABORAZIONE DATI ====================

function processSummaryData(results) {
    const summary = [];
    let totalDistance = 0;
    let totalTime = 0;
    let totalMaxSpeed = 0;
    let totalAvgSpeed = 0;
    let deviceCount = 0;

    results.forEach(({ deviceId, positions }) => {
        if (positions.length === 0) return;

        const deviceName = getDeviceName(deviceId);
        positions.sort((a, b) => new Date(a.serverTime) - new Date(b.serverTime));

        let deviceDistance = 0;
        let deviceMaxSpeed = 0;
        let speedSum = 0;
        let speedCount = 0;

        for (let i = 0; i < positions.length - 1; i++) {
            const pos1 = positions[i];
            const pos2 = positions[i + 1];

            const distance = calculateDistance(
                pos1.latitude, pos1.longitude,
                pos2.latitude, pos2.longitude
            );
            deviceDistance += distance;

            if (pos1.speed) {
                deviceMaxSpeed = Math.max(deviceMaxSpeed, pos1.speed);
                speedSum += pos1.speed;
                speedCount++;
            }
        }

        const deviceAvgSpeed = speedCount > 0 ? speedSum / speedCount : 0;
        const startTime = new Date(positions[0].serverTime);
        const endTime = new Date(positions[positions.length - 1].serverTime);
        const duration = endTime - startTime;

        summary.push({
            deviceId,
            deviceName,
            distance: deviceDistance / 1000, // Convert to km
            duration,
            avgSpeed: deviceAvgSpeed,
            maxSpeed: deviceMaxSpeed,
            positionsCount: positions.length,
            startTime,
            endTime,
            category: getDeviceCategory(deviceId)
        });

        totalDistance += deviceDistance / 1000;
        totalTime += duration;
        totalMaxSpeed = Math.max(totalMaxSpeed, deviceMaxSpeed);
        totalAvgSpeed += deviceAvgSpeed;
        deviceCount++;
    });

    currentReportData = {
        type: 'summary',
        data: summary,
        totals: {
            distance: totalDistance,
            time: totalTime,
            avgSpeed: deviceCount > 0 ? totalAvgSpeed / deviceCount : 0,
            maxSpeed: totalMaxSpeed,
            deviceCount
        },
        period: getDateRange(),
        generatedAt: new Date()
    };

    return currentReportData;
}

// ==================== RENDERING REPORT ====================

function renderSummaryReport(reportData) {
    let html = `
        <div class="table-responsive">
            <table class="table table-striped table-hover report-table">
                <thead>
                    <tr>
                        <th><i class="fas fa-mobile-alt"></i> Dispositivo</th>
                        <th><i class="fas fa-route"></i> Distanza</th>
                        <th><i class="fas fa-clock"></i> Tempo</th>
                        <th><i class="fas fa-tachometer-alt"></i> Vel. Media</th>
                        <th><i class="fas fa-exclamation-triangle"></i> Vel. Max</th>
                        <th><i class="fas fa-map-marker-alt"></i> Posizioni</th>
                        <th><i class="fas fa-calendar"></i> Periodo</th>
                    </tr>
                </thead>
                <tbody>
    `;

    reportData.data.forEach(device => {
        const categoryIcon = getCategoryIcon(device.category);
        const distanceColor = device.distance > 100 ? 'text-success' : device.distance > 50 ? 'text-warning' : 'text-danger';
        const speedColor = device.maxSpeed > 130 ? 'text-danger' : device.maxSpeed > 90 ? 'text-warning' : 'text-success';

        html += `
            <tr>
                <td>
                    <div class="d-flex align-items-center">
                        <i class="${categoryIcon} text-primary me-2"></i>
                        <div>
                            <div class="fw-bold">${device.deviceName}</div>
                            <small class="text-muted">${device.category || 'N/A'}</small>
                        </div>
                    </div>
                </td>
                <td class="${distanceColor} fw-bold">${device.distance.toFixed(1)} km</td>
                <td>${formatDuration(device.duration)}</td>
                <td>${Math.round(device.avgSpeed)} km/h</td>
                <td class="${speedColor} fw-bold">${Math.round(device.maxSpeed)} km/h</td>
                <td>
                    <span class="badge bg-info">${device.positionsCount}</span>
                </td>
                <td>
                    <small>
                        ${formatDateTime(device.startTime)}<br>
                        <i class="fas fa-arrow-down"></i><br>
                        ${formatDateTime(device.endTime)}
                    </small>
                </td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>

        <!-- Summary Cards -->
        <div class="row mt-4">
            <div class="col-md-12">
                <div class="alert alert-info">
                    <h6><i class="fas fa-info-circle"></i> Riepilogo del Periodo</h6>
                    <div class="row">
                        <div class="col-md-3">
                            <strong>Dispositivi analizzati:</strong> ${reportData.totals.deviceCount}
                        </div>
                        <div class="col-md-3">
                            <strong>Distanza totale:</strong> ${reportData.totals.distance.toFixed(1)} km
                        </div>
                        <div class="col-md-3">
                            <strong>Tempo totale:</strong> ${formatDuration(reportData.totals.time)}
                        </div>
                        <div class="col-md-3">
                            <strong>Velocità media generale:</strong> ${Math.round(reportData.totals.avgSpeed)} km/h
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.getElementById('reportContent').innerHTML = html;
}

function renderPDFPreview(reportData) {
    const pdfContent = document.getElementById('reportContentPDF');

    let html = `
        <!-- Executive Summary -->
        <div class="row mb-4">
            <div class="col-12">
                <h4 class="text-primary fw-bold mb-3">Riepilogo Esecutivo</h4>
                <div class="row">
                    <div class="col-md-3">
                        <div class="text-center p-3 border rounded">
                            <h3 class="text-primary fw-bold">${reportData.totals.deviceCount}</h3>
                            <p class="mb-0 small">Dispositivi Monitorati</p>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center p-3 border rounded">
                            <h3 class="text-success fw-bold">${reportData.totals.distance.toFixed(0)} km</h3>
                            <p class="mb-0 small">Distanza Totale</p>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center p-3 border rounded">
                            <h3 class="text-warning fw-bold">${formatDuration(reportData.totals.time, true)}</h3>
                            <p class="mb-0 small">Tempo di Viaggio</p>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="text-center p-3 border rounded">
                            <h3 class="text-danger fw-bold">${Math.round(reportData.totals.avgSpeed)} km/h</h3>
                            <p class="mb-0 small">Velocità Media</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detailed Table -->
        <div class="mb-4">
            <h5 class="text-primary fw-bold mb-3">Dettaglio per Dispositivo</h5>
            <table class="table table-bordered table-sm">
                <thead style="background-color: #f8f9fa;">
                    <tr>
                        <th>Dispositivo</th>
                        <th>Categoria</th>
                        <th>Distanza (km)</th>
                        <th>Tempo Viaggio</th>
                        <th>Vel. Media</th>
                        <th>Vel. Massima</th>
                        <th>N° Posizioni</th>
                    </tr>
                </thead>
                <tbody>
    `;

    reportData.data.forEach(device => {
        html += `
            <tr>
                <td class="fw-bold">${device.deviceName}</td>
                <td>${device.category || 'N/A'}</td>
                <td class="text-end">${device.distance.toFixed(1)}</td>
                <td>${formatDuration(device.duration, true)}</td>
                <td class="text-end">${Math.round(device.avgSpeed)}</td>
                <td class="text-end fw-bold">${Math.round(device.maxSpeed)}</td>
                <td class="text-center">${device.positionsCount}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>

        <!-- Analysis Section -->
        <div class="row">
            <div class="col-12">
                <h5 class="text-primary fw-bold mb-3">Analisi e Considerazioni</h5>
                <div class="bg-light p-3 rounded">
                    <p><strong>Periodo di analisi:</strong> ${formatDate(reportData.period.from)} - ${formatDate(reportData.period.to)}</p>
                    <p><strong>Dispositivo più attivo:</strong> ${getMostActiveDevice(reportData.data)}</p>
                    <p><strong>Distanza media per dispositivo:</strong> ${(reportData.totals.distance / reportData.totals.deviceCount).toFixed(1)} km</p>
                    <p><strong>Efficienza di tracking:</strong> ${calculateTrackingEfficiency(reportData.data)}% (basata sul numero di posizioni registrate)</p>
                    <p class="mb-0"><strong>Note:</strong> Report generato automaticamente dal sistema Traccar GPS Solutions.
                    Tutti i dati sono elaborati in tempo reale e riflettono l'attività effettiva dei dispositivi nel periodo selezionato.</p>
                </div>
            </div>
        </div>
    `;

    pdfContent.innerHTML = html;
    document.getElementById('generationTimestamp').textContent = formatDateTime(new Date());
}

// ==================== ESPORTAZIONE ====================

function exportReport(format) {
    if (!currentReportData) {
        showAlert('Nessun report da esportare', 'warning');
        return;
    }

    switch (format) {
        case 'csv':
            exportCSV();
            break;
        case 'excel':
            exportExcel();
            break;
        case 'pdf':
            exportPDF();
            break;
    }
}

function exportPDF() {
    // Mostra loading overlay
    document.getElementById('loadingOverlay').style.display = 'flex';

    setTimeout(() => {
        try {
            // Carica la libreria jsPDF
            if (typeof jsPDF === 'undefined') {
                loadJsPDF().then(() => {
                    generatePDFDocument();
                });
            } else {
                generatePDFDocument();
            }
        } catch (error) {
            console.error('Errore nell\'esportazione PDF:', error);
            showAlert('Errore nell\'esportazione PDF', 'danger');
            document.getElementById('loadingOverlay').style.display = 'none';
        }
    }, 500);
}

function loadJsPDF() {
    return new Promise((resolve, reject) => {
        if (document.querySelector('script[src*="jspdf"]')) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

function generatePDFDocument() {
    try {
        // Fallback: utilizza la funzione di stampa del browser con stili PDF
        document.getElementById('pdfPreview').style.display = 'block';
        document.getElementById('reportContent').style.display = 'none';

        // Applica stili per la stampa
        const printStyle = document.createElement('style');
        printStyle.innerHTML = `
            @media print {
                body * { visibility: hidden; }
                .pdf-preview, .pdf-preview * { visibility: visible; }
                .pdf-preview { position: absolute; left: 0; top: 0; width: 100%; }
                .no-print { display: none !important; }
            }
        `;
        document.head.appendChild(printStyle);

        // Aggiorna le informazioni del report
        updatePDFMetadata();

        // Attiva la stampa
        setTimeout(() => {
            window.print();

            // Ripulisci dopo la stampa
            setTimeout(() => {
                document.head.removeChild(printStyle);
                document.getElementById('pdfPreview').style.display = 'none';
                document.getElementById('reportContent').style.display = 'block';
                document.getElementById('loadingOverlay').style.display = 'none';
                showAlert('PDF generato con successo', 'success');
            }, 1000);
        }, 500);

    } catch (error) {
        console.error('Errore nella generazione PDF:', error);
        showAlert('Errore nella generazione PDF. Utilizza la funzione di stampa del browser.', 'warning');
        document.getElementById('loadingOverlay').style.display = 'none';
    }
}

function updatePDFMetadata() {
    const now = new Date();
    document.getElementById('reportDate').textContent = now.toLocaleDateString('it-IT');
    document.getElementById('reportNumber').textContent = `#${String(reportCounter++).padStart(4, '0')}`;
    document.getElementById('generationTimestamp').textContent = now.toLocaleString('it-IT');
}

function exportCSV() {
    let csvContent = '';

    if (currentReportData.type === 'summary') {
        csvContent = 'Dispositivo,Categoria,Distanza (km),Tempo di Viaggio,Velocità Media (km/h),Velocità Massima (km/h),Posizioni,Data Inizio,Data Fine\n';

        currentReportData.data.forEach(device => {
            const duration = formatDuration(device.duration, true);
            csvContent += `"${device.deviceName}","${device.category || 'N/A'}",${device.distance.toFixed(1)},"${duration}",${Math.round(device.avgSpeed)},${Math.round(device.maxSpeed)},${device.positionsCount},"${formatDateTime(device.startTime)}","${formatDateTime(device.endTime)}"\n`;
        });
    }

    downloadFile(csvContent, `traccar_report_${new Date().toISOString().split('T')[0]}.csv`, 'text/csv');
    showAlert('Report CSV esportato con successo', 'success');
}

function exportExcel() {
    showAlert('Esportazione Excel - Implementazione avanzata in sviluppo', 'info');
    // Placeholder per esportazione Excel con librerie come SheetJS
}

// ==================== UTILITÀ ====================

function getSelectedDeviceIds() {
    const select = document.getElementById('deviceSelect');
    const selected = [];
    for (let option of select.options) {
        if (option.selected) {
            selected.push(option.value);
        }
    }
    return selected;
}

function getDateRange() {
    const preset = document.getElementById('datePreset').value;

    if (preset === 'custom') {
        return {
            from: new Date(document.getElementById('fromDate').value),
            to: new Date(document.getElementById('toDate').value)
        };
    } else {
        const now = new Date();
        switch (preset) {
            case 'today':
                return { from: new Date(now), to: new Date(now) };
            case 'yesterday':
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                return { from: yesterday, to: yesterday };
            case 'week':
                return {
                    from: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
                    to: new Date(now)
                };
            case 'month':
                return {
                    from: new Date(now.getFullYear(), now.getMonth(), 1),
                    to: new Date(now)
                };
        }
    }
}

function updateStatistics(reportData) {
    if (!reportData || !reportData.totals) return;

    const totals = reportData.totals;

    document.getElementById('totalDistance').textContent = totals.distance.toFixed(1) + ' km';
    document.getElementById('totalTime').textContent = formatDuration(totals.time);
    document.getElementById('avgSpeed').textContent = Math.round(totals.avgSpeed) + ' km/h';
    document.getElementById('maxSpeed').textContent = Math.round(totals.maxSpeed) + ' km/h';

    document.getElementById('statsCards').style.display = 'flex';
}

function enableExportButtons() {
    document.getElementById('exportExcel').disabled = false;
    document.getElementById('exportCSV').disabled = false;
    document.getElementById('exportPDF').disabled = false;
}

function showReportInfo() {
    const info = document.getElementById('reportInfo');
    const timestamp = document.getElementById('reportGeneratedAt');

    timestamp.textContent = `Generato il ${new Date().toLocaleString('it-IT')}`;
    info.style.display = 'block';
}

function showEmptyReport() {
    const reportContent = document.getElementById('reportContent');
    reportContent.innerHTML = `
        <div class="text-center p-5 text-muted">
            <i class="fas fa-exclamation-triangle fa-3x mb-3"></i>
            <h5>Errore nella Generazione</h5>
            <p>Riprova con parametri diversi o verifica la connessione</p>
        </div>
    `;
}

// Funzioni di utilità per calcoli e formattazione
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
}

function getDeviceName(deviceId) {
    const device = allDevices.find(d => d.id == deviceId);
    return device ? device.name : `Dispositivo ${deviceId}`;
}

function getDeviceCategory(deviceId) {
    const device = allDevices.find(d => d.id == deviceId);
    return device ? device.category : 'unknown';
}

function getCategoryIcon(category) {
    const icons = {
        'car': 'fas fa-car',
        'truck': 'fas fa-truck',
        'motorcycle': 'fas fa-motorcycle',
        'bus': 'fas fa-bus',
        'van': 'fas fa-shuttle-van',
        'boat': 'fas fa-ship',
        'person': 'fas fa-walking',
        'animal': 'fas fa-paw'
    };
    return icons[category] || 'fas fa-map-marker-alt';
}

function formatDuration(milliseconds, short = false) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (short) {
        return `${hours}h ${minutes}m`;
    }

    return `${hours}h ${minutes}m`;
}

function formatDateTime(date) {
    return date.toLocaleString('it-IT');
}

function formatDate(date) {
    return date.toLocaleDateString('it-IT');
}

function getMostActiveDevice(devices) {
    const mostActive = devices.reduce((max, device) =>
        device.distance > max.distance ? device : max, devices[0]);
    return mostActive ? mostActive.deviceName : 'N/A';
}

function calculateTrackingEfficiency(devices) {
    const totalPositions = devices.reduce((sum, device) => sum + device.positionsCount, 0);
    const avgPositions = totalPositions / devices.length;
    // Stima efficienza basata su 1 posizione ogni 2 minuti come ideale
    const idealPositions = 720; // 24 ore * 30 posizioni/ora
    return Math.min(100, Math.round((avgPositions / idealPositions) * 100));
}

function downloadFile(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType + ';charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function showAlert(message, type = 'info') {
    const alertHtml = `
        <div class="alert alert-${type} alert-dismissible fade show position-fixed"
             style="top: 80px; right: 20px; z-index: 2000; min-width: 300px;" role="alert">
            <i class="fas fa-${getAlertIcon(type)}"></i> ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', alertHtml);

    setTimeout(() => {
        const alert = document.querySelector('.alert');
        if (alert) {
            alert.remove();
        }
    }, 5000);
}

function getAlertIcon(type) {
    const icons = {
        'success': 'check-circle',
        'danger': 'exclamation-triangle',
        'warning': 'exclamation-circle',
        'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
}

// reports_integration.js - Integrazione per salvare automaticamente i reports

// Aggiungi queste funzioni al file reports.js esistente

// ==================== INTEGRAZIONE REPOSITORY ====================

/**
 * Aggiunge il pulsante "Salva nel Repository" all'interfaccia reports
 */
function addSaveToRepositoryButton() {
    const exportSection = document.querySelector('.export-section .d-grid');
    if (exportSection && !document.getElementById('saveToRepo')) {
        const saveButton = document.createElement('button');
        saveButton.className = 'btn btn-outline-light btn-sm';
        saveButton.id = 'saveToRepo';
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fas fa-save text-info"></i> Salva nel Repository';
        saveButton.onclick = () => showSaveToRepositoryModal();

        exportSection.appendChild(saveButton);
    }
}

/**
 * Abilita il pulsante salva repository quando un report è generato
 */
function enableSaveToRepository() {
    const saveBtn = document.getElementById('saveToRepo');
    if (saveBtn) {
        saveBtn.disabled = false;
    }
}

/**
 * Mostra il modal per salvare nel repository
 */
function showSaveToRepositoryModal() {
    if (!currentReportData) {
        showAlert('Nessun report da salvare', 'warning');
        return;
    }

    // Crea modal dinamicamente se non esiste
    if (!document.getElementById('saveRepositoryModal')) {
        createSaveRepositoryModal();
    }

    // Popola i campi con dati predefiniti
    populateModalDefaults();

    const modal = new bootstrap.Modal(document.getElementById('saveRepositoryModal'));
    modal.show();
}

/**
 * Crea il modal per salvare nel repository
 */
function createSaveRepositoryModal() {
    const modalHtml = `
        <div class="modal fade" id="saveRepositoryModal" tabindex="-1">
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header bg-primary text-white">
                        <h5 class="modal-title">
                            <i class="fas fa-save"></i> Salva Report nel Repository
                        </h5>
                        <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <form id="saveRepositoryForm">
                            <!-- Informazioni Base -->
                            <div class="row mb-4">
                                <div class="col-12">
                                    <h6 class="border-bottom pb-2 mb-3">
                                        <i class="fas fa-info-circle text-primary"></i> Informazioni Report
                                    </h6>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Titolo Report *</label>
                                    <input type="text" class="form-control" id="reportTitle" required
                                           placeholder="Es: Report Mensile Gennaio 2024">
                                    <div class="form-text">Nome identificativo del report</div>
                                </div>
                                <div class="col-md-6">
                                    <label class="form-label">Tipo Report</label>
                                    <select class="form-select" id="reportTypeRepo" disabled>
                                        <option value="summary">Riepilogo Generale</option>
                                        <option value="routes">Analisi Percorsi</option>
                                        <option value="stops">Analisi Soste</option>
                                        <option value="trips">Dettaglio Viaggi</option>
                                        <option value="performance">Performance Veicoli</option>
                                    </select>
                                </div>
                            </div>

                            <div class="row mb-4">
                                <div class="col-12">
                                    <label class="form-label">Descrizione</label>
                                    <textarea class="form-control" id="reportDescription" rows="3"
                                              placeholder="Descrizione dettagliata del report e del suo scopo..."></textarea>
                                </div>
                            </div>

                            <!-- Metadati Automatici -->
                            <div class="row mb-4">
                                <div class="col-12">
                                    <h6 class="border-bottom pb-2 mb-3">
                                        <i class="fas fa-robot text-info"></i> Metadati Automatici
                                    </h6>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Dispositivi Analizzati</label>
                                    <input type="text" class="form-control" id="devicesCount" readonly>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Periodo Analisi</label>
                                    <input type="text" class="form-control" id="analysisPeriod" readonly>
                                </div>
                                <div class="col-md-4">
                                    <label class="form-label">Generato da</label>
                                    <input type="text" class="form-control" id="generatedBy"
                                           value="Sistema Traccar GPS" readonly>
                                </div>
                            </div>

                            <!-- Statistiche Report -->
                            <div class="row mb-4">
                                <div class="col-12">
                                    <h6 class="border-bottom pb-2 mb-3">
                                        <i class="fas fa-chart-bar text-success"></i> Statistiche Report
                                    </h6>
                                </div>
                                <div class="col-md-3">
                                    <div class="card bg-primary text-white">
                                        <div class="card-body text-center p-2">
                                            <h6 id="statTotalDistance">0 km</h6>
                                            <small>Distanza Totale</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="card bg-success text-white">
                                        <div class="card-body text-center p-2">
                                            <h6 id="statTotalTime">0h 0m</h6>
                                            <small>Tempo Totale</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="card bg-warning text-white">
                                        <div class="card-body text-center p-2">
                                            <h6 id="statAvgSpeed">0 km/h</h6>
                                            <small>Velocità Media</small>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-md-3">
                                    <div class="card bg-danger text-white">
                                        <div class="card-body text-center p-2">
                                            <h6 id="statMaxSpeed">0 km/h</h6>
                                            <small>Velocità Massima</small>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Opzioni Avanzate -->
                            <div class="row mb-3">
                                <div class="col-12">
                                    <h6 class="border-bottom pb-2 mb-3">
                                        <i class="fas fa-cogs text-warning"></i> Opzioni Avanzate
                                    </h6>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" id="includeRawData" checked>
                                        <label class="form-check-label" for="includeRawData">
                                            Includi dati grezzi per future analisi
                                        </label>
                                    </div>
                                </div>
                                <div class="col-md-6">
                                    <div class="form-check form-switch">
                                        <input class="form-check-input" type="checkbox" id="autoCleanup" checked>
                                        <label class="form-check-label" for="autoCleanup">
                                            Elimina automaticamente dopo 90 giorni
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <!-- Nome File -->
                            <div class="row">
                                <div class="col-12">
                                    <label class="form-label">Nome File (opzionale)</label>
                                    <input type="text" class="form-control" id="customFilename"
                                           placeholder="Se vuoto, verrà generato automaticamente">
                                    <div class="form-text">
                                        <i class="fas fa-info-circle"></i>
                                        Formato suggerito: report_tipo_YYYYMMDD_HHMMSS.json
                                    </div>
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
                            <i class="fas fa-times"></i> Annulla
                        </button>
                        <button type="button" class="btn btn-primary" onclick="saveReportToRepository()">
                            <i class="fas fa-save"></i> Salva nel Repository
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

/**
 * Popola il modal con i dati del report corrente
 */
function populateModalDefaults() {
    if (!currentReportData) return;

    const now = new Date();
    const reportType = currentReportData.type || 'summary';
    const deviceCount = currentReportData.totals?.deviceCount || 0;

    // Titolo suggerito
    const titleSuggestion = `Report ${getReportTypeName(reportType)} - ${now.toLocaleDateString('it-IT')}`;
    document.getElementById('reportTitle').value = titleSuggestion;

    // Tipo report
    document.getElementById('reportTypeRepo').value = reportType;

    // Descrizione suggerita
    const period = currentReportData.period;
    const periodText = period ?
        `dal ${formatDate(period.from)} al ${formatDate(period.to)}` :
        'periodo selezionato';

    const descriptionSuggestion = `Report ${getReportTypeName(reportType).toLowerCase()} generato per ${deviceCount} dispositivi nel ${periodText}. Include statistiche complete su distanze, tempi di percorrenza e velocità.`;
    document.getElementById('reportDescription').value = descriptionSuggestion;

    // Metadati automatici
    document.getElementById('devicesCount').value = `${deviceCount} dispositivi`;
    document.getElementById('analysisPeriod').value = periodText;

    // Statistiche
    if (currentReportData.totals) {
        const totals = currentReportData.totals;
        document.getElementById('statTotalDistance').textContent = totals.distance.toFixed(1) + ' km';
        document.getElementById('statTotalTime').textContent = formatDuration(totals.time);
        document.getElementById('statAvgSpeed').textContent = Math.round(totals.avgSpeed) + ' km/h';
        document.getElementById('statMaxSpeed').textContent = Math.round(totals.maxSpeed) + ' km/h';
    }

    // Nome file suggerito
    const timestamp = now.toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '_');
    const filenameSuggestion = `report_${reportType}_${timestamp}.json`;
    document.getElementById('customFilename').placeholder = `Suggerito: ${filenameSuggestion}`;
}

/**
 * Salva il report nel repository
 */
async function saveReportToRepository() {
    const form = document.getElementById('saveRepositoryForm');
    const formData = new FormData(form);

    // Validazione
    const title = document.getElementById('reportTitle').value.trim();
    if (!title) {
        showAlert('Il titolo del report è obbligatorio', 'warning');
        return;
    }

    // Prepara i dati per il salvataggio
    const reportToSave = {
        ...currentReportData,
        title: title,
        description: document.getElementById('reportDescription').value.trim(),
        generated_by: document.getElementById('generatedBy').value,
        repository_metadata: {
            include_raw_data: document.getElementById('includeRawData').checked,
            auto_cleanup: document.getElementById('autoCleanup').checked,
            saved_at: new Date().toISOString(),
            saved_from: 'reports_interface'
        }
    };

    // Nome file personalizzato se specificato
    const customFilename = document.getElementById('customFilename').value.trim();
    const filename = customFilename || null; // null = auto-generate

    try {
        // Mostra loading
        const saveBtn = document.querySelector('#saveRepositoryModal .btn-primary');
        const originalText = saveBtn.innerHTML;
        saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvataggio...';
        saveBtn.disabled = true;

        // Effettua il salvataggio
        const response = await fetch('/api/reports' + (filename ? `?filename=${encodeURIComponent(filename)}` : ''), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(reportToSave)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            // Chiudi modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('saveRepositoryModal'));
            modal.hide();

            // Mostra successo con opzioni
            showSuccessWithActions(result);

        } else {
            throw new Error(result.error || 'Errore nel salvataggio');
        }

    } catch (error) {
        console.error('Errore nel salvataggio:', error);
        showAlert('Errore nel salvataggio del report: ' + error.message, 'danger');
    } finally {
        // Ripristina pulsante
        const saveBtn = document.querySelector('#saveRepositoryModal .btn-primary');
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Salva nel Repository';
        saveBtn.disabled = false;
    }
}

/**
 * Mostra notifica di successo con azioni
 */
function showSuccessWithActions(result) {
    const alertHtml = `
        <div class="alert alert-success alert-dismissible fade show position-fixed"
             style="top: 80px; right: 20px; z-index: 2000; min-width: 400px;" role="alert">
            <div class="d-flex align-items-start">
                <i class="fas fa-check-circle fa-2x text-success me-3"></i>
                <div class="flex-grow-1">
                    <h6 class="mb-1">Report Salvato con Successo!</h6>
                    <p class="mb-2">${result.message}</p>
                    <div class="d-flex gap-2">
                        <a href="/reports/repository" class="btn btn-sm btn-outline-success">
                            <i class="fas fa-folder-open"></i> Apri Repository
                        </a>
                        <button class="btn btn-sm btn-outline-info" onclick="downloadSavedReport('${result.report_id}')">
                            <i class="fas fa-download"></i> Scarica
                        </button>
                    </div>
                </div>
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', alertHtml);

    // Auto-remove dopo 10 secondi invece di 5 per dare tempo alle azioni
    setTimeout(() => {
        const alert = document.querySelector('.alert-success');
        if (alert) {
            alert.remove();
        }
    }, 10000);
}

/**
 * Scarica un report salvato dal repository
 */
async function downloadSavedReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}/download`);

        if (response.ok) {
            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition');
            const filename = contentDisposition
                ? contentDisposition.split('filename=')[1].replace(/"/g, '')
                : `report_${reportId}.json`;

            // Crea link per download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showAlert('Report scaricato dal repository', 'success');
        } else {
            throw new Error('Errore nel download dal repository');
        }
    } catch (error) {
        console.error('Errore nel download:', error);
        showAlert('Errore nel download del report: ' + error.message, 'danger');
    }
}

/**
 * Salvataggio automatico del report (chiamata da enableExportButtons)
 */
function autoSaveReport() {
    if (!currentReportData) return;

    // Salvataggio automatico silenzioso con titolo auto-generato
    const now = new Date();
    const reportType = currentReportData.type || 'summary';
    const deviceCount = currentReportData.totals?.deviceCount || 0;

    const autoReport = {
        ...currentReportData,
        title: `Auto-Save ${getReportTypeName(reportType)} - ${now.toLocaleString('it-IT')}`,
        description: `Report generato automaticamente per ${deviceCount} dispositivi - ${now.toLocaleString('it-IT')}`,
        generated_by: 'Sistema (Auto-Save)',
        repository_metadata: {
            auto_saved: true,
            include_raw_data: true,
            auto_cleanup: true,
            saved_at: now.toISOString(),
            saved_from: 'auto_save'
        }
    };

    // Salvataggio in background senza UI
    fetch('/api/reports', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(autoReport)
    })
    .then(response => response.json())
    .then(result => {
        if (result.success) {
            console.log('✅ Report auto-salvato:', result.filename);
            // Piccola notifica discreta
            showAlert('Report auto-salvato nel repository', 'info');
        }
    })
    .catch(error => {
        console.error('❌ Errore auto-save:', error);
    });
}

// ==================== UTILITY FUNCTIONS ====================

function getReportTypeName(type) {
    const typeNames = {
        'summary': 'Riepilogo',
        'routes': 'Percorsi',
        'stops': 'Soste',
        'trips': 'Viaggi',
        'performance': 'Performance'
    };
    return typeNames[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

// ==================== MODIFICHE AL CODICE ESISTENTE ====================

// Modifica la funzione enableExportButtons esistente per includere il repository
const originalEnableExportButtons = enableExportButtons;
enableExportButtons = function() {
    // Chiama la funzione originale
    originalEnableExportButtons();

    // Abilita il salvataggio nel repository
    enableSaveToRepository();

    // Auto-salvataggio opzionale (commentato per default)
    // autoSaveReport();
};

// Modifica l'inizializzazione per aggiungere il pulsante
const originalSetupEventListeners = setupEventListeners;
setupEventListeners = function() {
    // Chiama la funzione originale
    originalSetupEventListeners();

    // Aggiungi il pulsante salva repository
    addSaveToRepositoryButton();
};

// ==================== ESEMPI DI INTEGRAZIONE ====================

/*
// Per integrare questo sistema nel file reports.js esistente:

1. Aggiungi questo codice alla fine del file reports.js

2. Modifica la funzione enableExportButtons aggiungendo:
   enableSaveToRepository();

3. Modifica la funzione setupEventListeners aggiungendo:
   addSaveToRepositoryButton();

4. Opzionalmente, per l'auto-save, aggiungi alla fine di generateSummaryReport:
   if (ENABLE_AUTO_SAVE) {
       autoSaveReport();
   }

5. Aggiungi questa configurazione in cima al file:
   const ENABLE_AUTO_SAVE = false; // true per abilitare auto-save
*/

// ==================== CONFIGURAZIONE ====================

// Configurazione per il sistema di repository
const REPOSITORY_CONFIG = {
    // Auto-save ogni report generato
    AUTO_SAVE_ENABLED: false,

    // Mostra sempre il pulsante salva repository
    SHOW_SAVE_BUTTON: true,

    // Cleanup automatico dopo X giorni
    AUTO_CLEANUP_DAYS: 90,

    // Dimensione massima repository (MB)
    MAX_REPOSITORY_SIZE: 500,

    // Notifiche per azioni repository
    SHOW_NOTIFICATIONS: true
};

console.log('📁 Repository Integration caricato con successo!');