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