// reports_repository.js - Sistema completo di gestione repository reports

// Variabili globali
let allReports = [];
let filteredReports = [];
let selectedReports = new Set();
let currentFilter = 'all';
let currentSort = 'created_desc';
let contextMenuReportId = null;
let currentPage = 1;
const REPORTS_PER_PAGE = 10;

// Inizializzazione
document.addEventListener('DOMContentLoaded', function() {
    initializeRepository();
    setupEventListeners();
    loadRepositoryData();
});

function initializeRepository() {
    console.log('🗂️ Inizializzazione Repository Reports...');

    // Setup context menu
    document.addEventListener('click', function(e) {
        hideContextMenu();
    });

    // Setup keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 'r':
                    e.preventDefault();
                    refreshRepository();
                    break;
                case 'a':
                    e.preventDefault();
                    selectAllReports();
                    break;
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    if (selectedReports.size > 0) {
                        deleteSelectedReports();
                    }
                    break;
            }
        }

        if (e.key === 'Escape') {
            clearSelection();
        }
    });
}

function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', debounce(performSearch, 300));
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const type = this.getAttribute('data-type');
            setFilter(type);
        });
    });

    // Sort select
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', function() {
            currentSort = this.value;
            applyFiltersAndSort();
        });
    }

    // Cleanup modal trigger (add to header if needed)
    const cleanupBtn = document.createElement('button');
    cleanupBtn.className = 'btn btn-outline-warning btn-sm ms-2';
    cleanupBtn.innerHTML = '<i class="fas fa-broom"></i> Pulizia';
    cleanupBtn.onclick = () => showCleanupModal();

    // Add cleanup button to header if there's space
    const headerButtons = document.querySelector('.page-header .d-flex');
    if (headerButtons) {
        headerButtons.appendChild(cleanupBtn);
    }
}

// ==================== CARICAMENTO DATI ====================

async function loadRepositoryData() {
    showLoading();

    try {
        const response = await fetch('/api/reports');
        const data = await response.json();

        if (response.ok) {
            allReports = data.reports || [];
            updateStatistics(data.stats || {});
            applyFiltersAndSort();
            console.log(`✅ Caricati ${allReports.length} reports dal repository`);
            if (allReports.length > 0) {
                showAlert('Repository caricato con successo', 'success');
            }
        } else {
            throw new Error(data.error || 'Errore nel caricamento');
        }
    } catch (error) {
        console.error('Errore nel caricamento repository:', error);
        showAlert('Errore nel caricamento del repository: ' + error.message, 'danger');
        showEmptyState();
    } finally {
        hideLoading();
    }
}

function updateStatistics(stats) {
    const totalReports = document.getElementById('totalReports');
    const totalSize = document.getElementById('totalSize');
    const recentReports = document.getElementById('recentReports');
    const lastCleanup = document.getElementById('lastCleanup');

    if (totalReports) totalReports.textContent = stats.total_reports || 0;
    if (totalSize) totalSize.textContent = (stats.total_size_mb || 0) + ' MB';

    // Calcola reports degli ultimi 7 giorni
    const lastWeek = new Date();
    lastWeek.setDate(lastWeek.getDate() - 7);

    const recentCount = allReports.filter(report => {
        const reportDate = new Date(report.created_at);
        return reportDate >= lastWeek;
    }).length;

    if (recentReports) recentReports.textContent = recentCount;

    // Formatta data ultimo cleanup
    const lastCleanupDate = stats.last_cleanup;
    if (lastCleanup) {
        if (lastCleanupDate) {
            const cleanupDate = new Date(lastCleanupDate);
            lastCleanup.textContent = cleanupDate.toLocaleDateString('it-IT');
        } else {
            lastCleanup.textContent = 'Mai';
        }
    }
}

// ==================== FILTRI E RICERCA ====================

function performSearch() {
    const query = document.getElementById('searchInput').value.toLowerCase();

    if (!query) {
        filteredReports = [...allReports];
    } else {
        filteredReports = allReports.filter(report => {
            return report.title.toLowerCase().includes(query) ||
                   report.type.toLowerCase().includes(query) ||
                   (report.description && report.description.toLowerCase().includes(query)) ||
                   report.filename.toLowerCase().includes(query);
        });
    }

    applyFiltersAndSort();
}

function setFilter(type) {
    currentFilter = type;

    // Update filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.querySelector(`[data-type="${type}"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    applyFiltersAndSort();
}

function applyFiltersAndSort() {
    let reports = [...allReports];

    // Apply search filter
    const searchInput = document.getElementById('searchInput');
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    if (query) {
        reports = reports.filter(report => {
            return report.title.toLowerCase().includes(query) ||
                   report.type.toLowerCase().includes(query) ||
                   (report.description && report.description.toLowerCase().includes(query)) ||
                   report.filename.toLowerCase().includes(query);
        });
    }

    // Apply type filter
    if (currentFilter !== 'all') {
        reports = reports.filter(report => report.type === currentFilter);
    }

    // Apply sorting
    reports.sort((a, b) => {
        switch (currentSort) {
            case 'created_desc':
                return new Date(b.created_at) - new Date(a.created_at);
            case 'created_asc':
                return new Date(a.created_at) - new Date(b.created_at);
            case 'name_asc':
                return a.title.localeCompare(b.title);
            case 'name_desc':
                return b.title.localeCompare(a.title);
            case 'size_desc':
                return (b.file_size || 0) - (a.file_size || 0);
            case 'size_asc':
                return (a.file_size || 0) - (b.file_size || 0);
            default:
                return 0;
        }
    });

    filteredReports = reports;
    currentPage = 1;
    renderReports();
}

// ==================== RENDERING ====================

function renderReports() {
    const container = document.getElementById('reportsContainer');

    if (!container) {
        console.error('❌ Container reportsContainer non trovato');
        return;
    }

    const startIndex = (currentPage - 1) * REPORTS_PER_PAGE;
    const endIndex = startIndex + REPORTS_PER_PAGE;
    const reportsToShow = filteredReports.slice(0, endIndex);

    if (reportsToShow.length === 0) {
        showEmptyState();
        return;
    }

    hideEmptyState();

    let html = '';

    reportsToShow.forEach(report => {
        const isSelected = selectedReports.has(report.id);
        const reportDate = new Date(report.created_at);
        const fileSize = formatFileSize(report.file_size || 0);
        const typeBadge = getTypeBadge(report.type);

        html += `
            <div class="report-card ${isSelected ? 'border-primary' : ''}"
                 data-report-id="${report.id}"
                 oncontextmenu="showContextMenu(event, '${report.id}'); return false;">

                <div class="report-header">
                    <div class="d-flex justify-content-between align-items-start">
                        <div class="d-flex align-items-start">
                            <div class="form-check me-3">
                                <input class="form-check-input" type="checkbox"
                                       ${isSelected ? 'checked' : ''}
                                       onchange="toggleReportSelection('${report.id}')">
                            </div>
                            <div>
                                <h6 class="mb-1 fw-bold">${escapeHtml(report.title || 'Report Senza Titolo')}</h6>
                                <div class="d-flex align-items-center gap-2 mb-2">
                                    ${typeBadge}
                                    <span class="file-size">
                                        <i class="fas fa-file"></i> ${fileSize}
                                    </span>
                                    <span class="file-size">
                                        <i class="fas fa-mobile-alt"></i> ${report.devices_count || 0} dispositivi
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div class="report-actions">
                            <button class="btn btn-sm btn-outline-primary"
                                    onclick="viewReport('${report.id}')"
                                    title="Visualizza Report">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-success"
                                    onclick="downloadReport('${report.id}')"
                                    title="Scarica Report">
                                <i class="fas fa-download"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-danger"
                                    onclick="deleteReport('${report.id}')"
                                    title="Elimina Report">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="report-body">
                    <p class="text-muted mb-2">${escapeHtml(report.description || 'Nessuna descrizione disponibile')}</p>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted">
                            <i class="fas fa-calendar"></i>
                            Creato il ${reportDate.toLocaleString('it-IT')}
                        </small>
                        <small class="text-muted">
                            <i class="fas fa-tag"></i>
                            ${report.filename || 'N/A'}
                        </small>
                    </div>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;

    // Show/hide load more button
    const loadMoreContainer = document.getElementById('loadMoreContainer');
    if (loadMoreContainer) {
        if (filteredReports.length > endIndex) {
            loadMoreContainer.style.display = 'block';
        } else {
            loadMoreContainer.style.display = 'none';
        }
    }

    updateBulkActionsVisibility();
}

function getTypeBadge(type) {
    const badges = {
        'summary': '<span class="badge bg-primary report-type-badge">Riepilogo</span>',
        'routes': '<span class="badge bg-success report-type-badge">Percorsi</span>',
        'stops': '<span class="badge bg-warning report-type-badge">Soste</span>',
        'trips': '<span class="badge bg-info report-type-badge">Viaggi</span>',
        'performance': '<span class="badge bg-danger report-type-badge">Performance</span>'
    };
    return badges[type] || `<span class="badge bg-secondary report-type-badge">${type || 'unknown'}</span>`;
}

// ==================== AZIONI SUI REPORT ====================

async function viewReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            // Apri il report in una nuova finestra
            const reportWindow = window.open('', '_blank');
            reportWindow.document.write(`
                <html>
                <head>
                    <title>${data.report.title}</title>
                    <link href="https://cdnjs.cloudflare.com/ajax/libs/bootstrap/5.3.0/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
                        .json-container { background: #f8f9fa; border-radius: 8px; padding: 1rem; }
                        .json-key { color: #0066cc; font-weight: bold; }
                        .json-string { color: #009900; }
                        .json-number { color: #cc6600; }
                    </style>
                </head>
                <body class="p-4">
                    <div class="container">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h2>${escapeHtml(data.report.title)}</h2>
                            <button class="btn btn-outline-secondary" onclick="window.close()">Chiudi</button>
                        </div>
                        <div class="mb-3">
                            <p class="text-muted">${escapeHtml(data.report.description || '')}</p>
                            <p><strong>Tipo:</strong> ${data.report.type}</p>
                            <p><strong>Creato:</strong> ${new Date(data.report.created_at).toLocaleString('it-IT')}</p>
                            <p><strong>Dispositivi:</strong> ${data.report.devices_count || 0}</p>
                        </div>
                        <div class="json-container">
                            <h5>Dati Report:</h5>
                            <pre class="small">${JSON.stringify(data.report, null, 2)}</pre>
                        </div>
                    </div>
                </body>
                </html>
            `);
        } else {
            throw new Error(data.error || 'Errore nel caricamento del report');
        }
    } catch (error) {
        console.error('Errore nella visualizzazione:', error);
        showAlert('Errore nella visualizzazione del report: ' + error.message, 'danger');
    }
}

async function downloadReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}/download`);

        if (response.ok) {
            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition');
            const filename = contentDisposition
                ? contentDisposition.split('filename=')[1].replace(/"/g, '')
                : `report_${reportId}.json`;

            downloadBlob(blob, filename);
            showAlert('Report scaricato con successo', 'success');
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Errore nel download');
        }
    } catch (error) {
        console.error('Errore nel download:', error);
        showAlert('Errore nel download del report: ' + error.message, 'danger');
    }
}

async function deleteReport(reportId) {
    if (!confirm('Sei sicuro di voler eliminare questo report? L\'operazione è irreversibile.')) {
        return;
    }

    try {
        const response = await fetch(`/api/reports/${reportId}`, {
            method: 'DELETE'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            // Rimuovi dalla lista locale
            allReports = allReports.filter(r => r.id !== reportId);
            selectedReports.delete(reportId);

            applyFiltersAndSort();
            showAlert('Report eliminato con successo', 'success');
        } else {
            throw new Error(data.error || 'Errore nell\'eliminazione');
        }
    } catch (error) {
        console.error('Errore nell\'eliminazione:', error);
        showAlert('Errore nell\'eliminazione del report: ' + error.message, 'danger');
    }
}

async function duplicateReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}`);
        const data = await response.json();

        if (response.ok && data.success) {
            const originalReport = data.report;

            // Modifica i dati per la duplicazione
            const duplicatedReport = {
                ...originalReport,
                title: originalReport.title + ' (Copia)',
                description: 'Copia di: ' + (originalReport.description || ''),
                generated_by: 'Sistema (Duplicazione)'
            };

            // Rimuovi campi che verranno rigenerati
            delete duplicatedReport.id;
            delete duplicatedReport.filename;
            delete duplicatedReport.created_at;

            // Salva la copia
            const saveResponse = await fetch('/api/reports', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(duplicatedReport)
            });

            const saveData = await saveResponse.json();

            if (saveResponse.ok && saveData.success) {
                showAlert('Report duplicato con successo', 'success');
                refreshRepository();
            } else {
                throw new Error(saveData.error || 'Errore nella duplicazione');
            }
        } else {
            throw new Error(data.error || 'Errore nel caricamento del report originale');
        }
    } catch (error) {
        console.error('Errore nella duplicazione:', error);
        showAlert('Errore nella duplicazione del report: ' + error.message, 'danger');
    }
}

// ==================== SELEZIONE MULTIPLA ====================

function toggleReportSelection(reportId) {
    if (selectedReports.has(reportId)) {
        selectedReports.delete(reportId);
    } else {
        selectedReports.add(reportId);
    }

    updateBulkActionsVisibility();
    renderReports(); // Re-render per aggiornare gli stati visivi
}

function selectAllReports() {
    if (selectedReports.size === filteredReports.length) {
        // Deseleziona tutti
        selectedReports.clear();
    } else {
        // Seleziona tutti i filtrati
        filteredReports.forEach(report => {
            selectedReports.add(report.id);
        });
    }

    updateBulkActionsVisibility();
    renderReports();
}

function clearSelection() {
    selectedReports.clear();
    updateBulkActionsVisibility();
    renderReports();
}

function updateBulkActionsVisibility() {
    const bulkActions = document.getElementById('bulkActions');
    const selectedCount = document.getElementById('selectedCount');

    if (bulkActions && selectedCount) {
        if (selectedReports.size > 0) {
            bulkActions.style.display = 'block';
            selectedCount.textContent = selectedReports.size;
        } else {
            bulkActions.style.display = 'none';
        }
    }
}

async function deleteSelectedReports() {
    const count = selectedReports.size;
    if (count === 0) return;

    if (!confirm(`Sei sicuro di voler eliminare ${count} report(s)? L'operazione è irreversibile.`)) {
        return;
    }

    const deletePromises = Array.from(selectedReports).map(reportId =>
        fetch(`/api/reports/${reportId}`, { method: 'DELETE' })
    );

    try {
        const responses = await Promise.all(deletePromises);
        const results = await Promise.all(responses.map(r => r.json()));

        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        // Aggiorna la lista locale
        allReports = allReports.filter(r => !selectedReports.has(r.id));
        selectedReports.clear();

        applyFiltersAndSort();

        if (failed === 0) {
            showAlert(`${successful} report(s) eliminati con successo`, 'success');
        } else {
            showAlert(`${successful} eliminati, ${failed} errori`, 'warning');
        }
    } catch (error) {
        console.error('Errore nell\'eliminazione multipla:', error);
        showAlert('Errore nell\'eliminazione dei report selezionati', 'danger');
    }
}

async function exportSelectedReports() {
    const selectedIds = Array.from(selectedReports);
    if (selectedIds.length === 0) return;

    // Per ora, scarica i file uno per uno
    // In futuro si può implementare un endpoint per ZIP multipli
    for (const reportId of selectedIds) {
        await downloadReport(reportId);
        // Piccola pausa tra i download
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    showAlert(`${selectedIds.length} report(s) scaricati`, 'success');
}

// ==================== FUNZIONI PRINCIPALI ====================

async function refreshRepository() {
    const refreshIcon = document.getElementById('refreshIcon');
    if (refreshIcon) {
        refreshIcon.classList.add('fa-spin');
    }

    try {
        await loadRepositoryData();
    } finally {
        if (refreshIcon) {
            refreshIcon.classList.remove('fa-spin');
        }
    }
}

async function exportAllReports() {
    try {
        const response = await fetch('/api/reports/export/all');

        if (response.ok) {
            const blob = await response.blob();
            const contentDisposition = response.headers.get('Content-Disposition');
            const filename = contentDisposition
                ? contentDisposition.split('filename=')[1].replace(/"/g, '')
                : `traccar_reports_backup_${new Date().toISOString().split('T')[0]}.zip`;

            downloadBlob(blob, filename);
            showAlert('Backup completo scaricato con successo', 'success');
        } else {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Errore nell\'esportazione');
        }
    } catch (error) {
        console.error('Errore nell\'esportazione:', error);
        showAlert('Errore nell\'esportazione di tutti i report: ' + error.message, 'danger');
    }
}

function loadMoreReports() {
    currentPage++;
    renderReports();
}

function showCleanupModal() {
    const modal = document.getElementById('cleanupModal');
    if (modal) {
        const bootstrapModal = new bootstrap.Modal(modal);
        bootstrapModal.show();
    }
}

async function performCleanup() {
    const cleanupDaysSelect = document.getElementById('cleanupDays');
    const days = cleanupDaysSelect ? cleanupDaysSelect.value : 30;

    try {
        const response = await fetch(`/api/reports/cleanup?days=${days}`, {
            method: 'POST'
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showAlert(`Pulizia completata: ${data.deleted_count} report eliminati`, 'success');

            // Chiudi modal
            const modal = document.getElementById('cleanupModal');
            if (modal && bootstrap.Modal.getInstance(modal)) {
                bootstrap.Modal.getInstance(modal).hide();
            }

            // Ricarica dati
            refreshRepository();
        } else {
            throw new Error(data.error || 'Errore nella pulizia');
        }
    } catch (error) {
        console.error('Errore nella pulizia:', error);
        showAlert('Errore nella pulizia del repository: ' + error.message, 'danger');
    }
}

// Context Menu
function showContextMenu(event, reportId) {
    event.preventDefault();

    contextMenuReportId = reportId;
    const menu = document.getElementById('contextMenu');

    if (menu) {
        menu.style.display = 'block';
        menu.style.left = event.pageX + 'px';
        menu.style.top = event.pageY + 'px';
    }
}

function hideContextMenu() {
    const menu = document.getElementById('contextMenu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuReportId = null;
}

// UI State Management
function showLoading() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const reportsContainer = document.getElementById('reportsContainer');

    if (loadingSpinner) loadingSpinner.style.display = 'block';
    if (reportsContainer) reportsContainer.style.display = 'none';
    hideEmptyState();
}

function hideLoading() {
    const loadingSpinner = document.getElementById('loadingSpinner');
    const reportsContainer = document.getElementById('reportsContainer');

    if (loadingSpinner) loadingSpinner.style.display = 'none';
    if (reportsContainer) reportsContainer.style.display = 'block';
}

function showEmptyState() {
    const emptyState = document.getElementById('emptyState');
    const reportsContainer = document.getElementById('reportsContainer');
    const loadMoreContainer = document.getElementById('loadMoreContainer');

    if (emptyState) emptyState.style.display = 'block';
    if (reportsContainer) reportsContainer.style.display = 'none';
    if (loadMoreContainer) loadMoreContainer.style.display = 'none';
}

function hideEmptyState() {
    const emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.style.display = 'none';
}

// Utility Functions
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
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

// Log di inizializzazione
console.log('✅ reports_repository.js caricato completamente');
console.log('🚀 Funzioni disponibili:', {
    refreshRepository: typeof refreshRepository,
    exportAllReports: typeof exportAllReports,
    loadRepositoryData: typeof loadRepositoryData,
    renderReports: typeof renderReports
});