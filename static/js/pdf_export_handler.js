// pdf_export_handler.js - Gestione esportazione e salvataggio PDF

/**
 * Funzione principale per esportare un report in PDF e salvarlo nel repository
 */
async function exportAndSavePDF() {
    try {
        showNotification('Generazione PDF in corso...', 'info');

        // 1. Genera il PDF dai dati del report
        const pdfBlob = await generatePDFReport();

        if (!pdfBlob) {
            throw new Error('Errore nella generazione del PDF');
        }

        // 2. Salva il PDF nel repository
        const saveResult = await savePDFToRepository(pdfBlob);

        if (saveResult.success) {
            showNotification(
                `✅ ${saveResult.message}`,
                'success'
            );

            // 3. Aggiorna la lista dei report salvati
            await refreshReportsList();

            // 4. Opzionalmente, offri anche il download diretto
            offerDirectDownload(pdfBlob, saveResult.filename);

        } else {
            throw new Error(saveResult.error || 'Errore nel salvataggio del PDF');
        }

    } catch (error) {
        console.error('Errore esportazione PDF:', error);
        showNotification(`❌ Errore: ${error.message}`, 'error');
    }
}

/**
 * Genera il PDF del report usando jsPDF o libreria simile
 */
async function generatePDFReport() {
    try {
        // Ottieni i dati del report corrente
        const reportData = getCurrentReportData();

        if (!reportData || !reportData.data || reportData.data.length === 0) {
            throw new Error('Nessun dato disponibile per il report');
        }

        // Inizializza jsPDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Configurazione generale
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        let yPosition = margin;

        // === HEADER DEL REPORT ===
        doc.setFontSize(20);
        doc.setFont(undefined, 'bold');
        doc.text(reportData.title || 'Report di Tracciamento', margin, yPosition);
        yPosition += 15;

        // Data di generazione
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Generato il: ${new Date().toLocaleString('it-IT')}`, margin, yPosition);
        yPosition += 10;

        // Periodo del report
        if (reportData.period) {
            const periodText = `Periodo: ${reportData.period.from} - ${reportData.period.to}`;
            doc.text(periodText, margin, yPosition);
            yPosition += 15;
        }

        // === SEZIONE RIEPILOGO ===
        if (reportData.totals) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Riepilogo Generale', margin, yPosition);
            yPosition += 10;

            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');

            const totals = reportData.totals;
            const summaryLines = [
                `Veicoli monitorati: ${reportData.devices_count || 0}`,
                `Distanza totale: ${totals.totalDistance || '0'} km`,
                `Tempo di guida: ${totals.totalDriving || '0'}`,
                `Consumo carburante: ${totals.totalFuel || '0'} L`,
                `Numero soste: ${totals.totalStops || '0'}`
            ];

            summaryLines.forEach(line => {
                doc.text(line, margin, yPosition);
                yPosition += 6;
            });

            yPosition += 10;
        }

        // === TABELLA DETTAGLI VEICOLI ===
        if (reportData.data && reportData.data.length > 0) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.text('Dettagli per Veicolo', margin, yPosition);
            yPosition += 15;

            // Intestazioni tabella
            const headers = ['Veicolo', 'Distanza (km)', 'Durata', 'Velocità Media', 'Soste'];
            const colWidth = (pageWidth - 2 * margin) / headers.length;

            doc.setFontSize(9);
            doc.setFont(undefined, 'bold');

            headers.forEach((header, index) => {
                doc.text(header, margin + (index * colWidth), yPosition);
            });

            // Linea sotto le intestazioni
            doc.line(margin, yPosition + 3, pageWidth - margin, yPosition + 3);
            yPosition += 10;

            // Dati della tabella
            doc.setFont(undefined, 'normal');

            reportData.data.forEach((device, deviceIndex) => {
                // Controlla se serve una nuova pagina
                if (yPosition > pageHeight - 40) {
                    doc.addPage();
                    yPosition = margin;
                }

                const row = [
                    device.deviceName || `Veicolo ${deviceIndex + 1}`,
                    (device.distance / 1000).toFixed(1) || '0.0',
                    formatDuration(device.engineHours) || '00:00',
                    device.averageSpeed ? `${device.averageSpeed.toFixed(1)} km/h` : '0.0 km/h',
                    device.stops?.toString() || '0'
                ];

                row.forEach((cell, colIndex) => {
                    doc.text(cell, margin + (colIndex * colWidth), yPosition);
                });

                yPosition += 8;
            });
        }

        // === FOOTER ===
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.text(
                `Pagina ${i} di ${totalPages} - Generato da Sistema Traccar`,
                pageWidth - margin - 50,
                pageHeight - 10
            );
        }

        // Converti in Blob
        const pdfBlob = doc.output('blob');
        return pdfBlob;

    } catch (error) {
        console.error('Errore generazione PDF:', error);
        throw error;
    }
}

/**
 * Salva il PDF nel repository tramite API
 */
async function savePDFToRepository(pdfBlob, customTitle = null, customDescription = null) {
    try {
        const formData = new FormData();

        // Genera nome file
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const filename = `report_${timestamp}.pdf`;

        formData.append('file', pdfBlob, filename);

        // Aggiungi metadati opzionali
        if (customTitle) {
            formData.append('title', customTitle);
        } else {
            const currentReport = getCurrentReportData();
            const defaultTitle = `Report ${currentReport?.type || 'PDF'} - ${new Date().toLocaleDateString('it-IT')}`;
            formData.append('title', defaultTitle);
        }

        if (customDescription) {
            formData.append('description', customDescription);
        } else {
            const currentReport = getCurrentReportData();
            const period = currentReport?.period ?
                `${currentReport.period.from} - ${currentReport.period.to}` :
                'Periodo non specificato';
            formData.append('description', `Report PDF generato automaticamente. Periodo: ${period}`);
        }

        formData.append('filename', filename);

        const response = await fetch('/api/reports/pdf', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        return result;

    } catch (error) {
        console.error('Errore salvataggio PDF:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Offre il download diretto del PDF
 */
function offerDirectDownload(pdfBlob, filename) {
    const url = window.URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;

    // Aggiungi opzione per download diretto
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-outline-primary btn-sm ms-2';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Scarica anche localmente';
    downloadBtn.onclick = () => {
        a.click();
        window.URL.revokeObjectURL(url);
        downloadBtn.remove();
    };

    // Aggiungi il pulsante vicino alle notifiche
    const notificationArea = document.querySelector('.notification-area') || document.body;
    notificationArea.appendChild(downloadBtn);

    // Rimuovi automaticamente dopo 10 secondi
    setTimeout(() => {
        if (downloadBtn.parentNode) {
            downloadBtn.remove();
        }
        window.URL.revokeObjectURL(url);
    }, 10000);
}

/**
 * Aggiorna la lista dei report salvati
 */
async function refreshReportsList() {
    try {
        const response = await fetch('/api/reports?format=pdf&limit=10');
        const data = await response.json();

        if (data.success) {
            updateReportsListUI(data.reports);
        }

    } catch (error) {
        console.error('Errore aggiornamento lista:', error);
    }
}

/**
 * Aggiorna l'interfaccia con la lista dei report PDF
 */
function updateReportsListUI(reports) {
    const container = document.getElementById('savedReportsList');
    if (!container) return;

    container.innerHTML = '';

    if (reports.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">Nessun report PDF salvato</p>';
        return;
    }

    reports.forEach(report => {
        const reportCard = createReportCard(report);
        container.appendChild(reportCard);
    });
}

/**
 * Crea una card per un report salvato
 */
function createReportCard(report) {
    const card = document.createElement('div');
    card.className = 'card mb-2';

    const formatFileSize = (bytes) => {
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(1)} MB`;
    };

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleString('it-IT');
    };

    card.innerHTML = `
        <div class="card-body py-2">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <h6 class="card-title mb-1">${report.title}</h6>
                    <small class="text-muted">
                        📄 ${report.filename} • ${formatFileSize(report.file_size)} • ${formatDate(report.created_at)}
                    </small>
                </div>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-primary" onclick="downloadReport('${report.id}')"
                            title="Scarica PDF">
                        <i class="fas fa-download"></i>
                    </button>
                    <button class="btn btn-outline-danger" onclick="deleteReport('${report.id}')"
                            title="Elimina">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            ${report.description ? `<p class="card-text small mb-0 mt-1">${report.description}</p>` : ''}
        </div>
    `;

    return card;
}

/**
 * Scarica un report salvato
 */
async function downloadReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}/download`);

        if (!response.ok) {
            throw new Error('Errore nel download del report');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        // Ottieni il nome del file dalla risposta
        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'report.pdf';

        if (contentDisposition) {
            const matches = contentDisposition.match(/filename="(.+)"/);
            if (matches) {
                filename = matches[1];
            }
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification('✅ Report scaricato con successo', 'success');

    } catch (error) {
        console.error('Errore download:', error);
        showNotification(`❌ Errore download: ${error.message}`, 'error');
    }
}

/**
 * Elimina un report salvato
 */
async function deleteReport(reportId) {
    if (!confirm('Sei sicuro di voler eliminare questo report?')) {
        return;
    }

    try {
        const response = await fetch(`/api/reports/${reportId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showNotification('✅ Report eliminato con successo', 'success');
            await refreshReportsList();
        } else {
            throw new Error(result.error);
        }

    } catch (error) {
        console.error('Errore eliminazione:', error);
        showNotification(`❌ Errore eliminazione: ${error.message}`, 'error');
    }
}

/**
 * Funzioni di utilità
 */

// Formatta la durata in formato HH:MM
function formatDuration(minutes) {
    if (!minutes) return '00:00';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// Ottieni i dati del report corrente (da implementare secondo la tua struttura)
function getCurrentReportData() {
    // Questa funzione deve essere implementata secondo come organizzi i dati nel tuo sistema
    // Per esempio, potresti avere una variabile globale o leggere da un elemento DOM
    return window.currentReportData || null;
}

// Mostra notifiche (da implementare secondo il tuo sistema di notifiche)
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);

    // Se hai un sistema di toast/notifiche, usalo qui
    // Esempio con Bootstrap Toast:
    /*
    const toastHtml = `
        <div class="toast" role="alert">
            <div class="toast-body">
                ${message}
            </div>
        </div>
    `;
    */
}

// Inizializzazione quando il DOM è pronto
document.addEventListener('DOMContentLoaded', function() {
    // Aggiungi event listener per il pulsante di esportazione PDF
    const exportPDFBtn = document.getElementById('exportPDF');
    if (exportPDFBtn) {
        exportPDFBtn.onclick = exportAndSavePDF;
    }

    // Carica la lista iniziale dei report salvati
    refreshReportsList();
});

// Esporta funzioni per uso globale
window.exportAndSavePDF = exportAndSavePDF;
window.downloadReport = downloadReport;
window.deleteReport = deleteReport;
window.refreshReportsList = refreshReportsList;