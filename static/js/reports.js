// reports.js - Sistema integrato con salvataggio automatico PDF

// ==================== VARIABILI GLOBALI ====================
let currentReportData = null;
let selectedDevices = [];
let isGenerating = false;

// ==================== INIZIALIZZAZIONE ====================
document.addEventListener('DOMContentLoaded', function() {
    loadDevices();
    setupEventListeners();
    loadSavedReportsList();

    // Imposta date di default
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    document.getElementById('fromDate').value = yesterday.toISOString().split('T')[0];
    document.getElementById('toDate').value = today.toISOString().split('T')[0];
});

function setupEventListeners() {
    // Event listeners per la UI
    document.getElementById('datePreset').addEventListener('change', handleDatePresetChange);
    document.getElementById('selectAllDevices').addEventListener('change', toggleAllDevices);

    // Aggiorna testo pulsante PDF quando si generano reports
    document.getElementById('exportPDF').addEventListener('click', function() {
        // Questo viene ora gestito automaticamente in generateReport
        if (currentReportData) {
            exportAndSavePDF();
        }
    });
}

// ==================== FUNZIONE PRINCIPALE INTEGRATA ====================

/**
 * FUNZIONE PRINCIPALE MODIFICATA: Genera report e salva automaticamente in PDF
 */
async function generateReport() {
    if (isGenerating) {
        showNotification('⚠️ Generazione già in corso...', 'warning');
        return;
    }

    try {
        isGenerating = true;
        showLoadingOverlay(true, 'Generazione report in corso...');

        // 1. Validazione parametri
        const reportParams = validateAndGetReportParams();
        if (!reportParams.isValid) {
            throw new Error(reportParams.error);
        }

        // 2. Genera report dati
        showLoadingOverlay(true, 'Caricamento dati dispositivi...');
        const reportData = await fetchReportData(reportParams);

        if (!reportData || !reportData.success) {
            throw new Error('Errore nel caricamento dei dati del report');
        }

        // 3. Aggiorna UI con i dati del report
        currentReportData = reportData.data;
        displayReportResults(currentReportData);
        enableExportButtons();

        // 4. NOVITÀ: Genera e salva automaticamente il PDF nel repository
        showLoadingOverlay(true, 'Generazione PDF automatica in corso...');
        await generateAndSaveAutoPDF(currentReportData, reportParams);

        // 5. Mostra notifica di successo
        showNotification(
            `✅ Report generato con successo! PDF salvato automaticamente nel repository.`,
            'success'
        );

        // 6. Aggiorna la lista dei report salvati
        await refreshSavedReportsList();

        showLoadingOverlay(false);

    } catch (error) {
        console.error('Errore nella generazione del report:', error);
        showNotification(`❌ Errore: ${error.message}`, 'error');
        showLoadingOverlay(false);
    } finally {
        isGenerating = false;
    }
}

/**
 * NUOVA FUNZIONE: Genera e salva automaticamente il PDF nel repository
 */
async function generateAndSaveAutoPDF(reportData, reportParams) {
    try {
        // Genera il PDF
        const pdfBlob = await generateProfessionalPDF(reportData, reportParams);

        // Crea metadati descrittivi
        const reportType = reportParams.reportType || 'summary';
        const dateRange = `${formatDate(reportParams.fromDate)} - ${formatDate(reportParams.toDate)}`;

        const title = `Report ${getReportTypeLabel(reportType)} - ${formatDate(new Date())}`;
        const description = `Report automatico (${getReportTypeLabel(reportType)}) per il periodo ${dateRange}. Dispositivi: ${reportData.devices_count || 0}`;

        // Salva nel repository
        const saveResult = await savePDFToRepository(pdfBlob, null, title, description);

        if (!saveResult.success) {
            console.warn('Salvataggio PDF fallito:', saveResult.error);
            // Non bloccare l'operazione principale, ma logga l'errore
        }

        return saveResult;

    } catch (error) {
        console.error('Errore nel salvataggio automatico PDF:', error);
        // Non bloccare la generazione del report per errori PDF
        return { success: false, error: error.message };
    }
}

// ==================== FUNZIONI DI SUPPORTO ====================

function validateAndGetReportParams() {
    const selectedDeviceOptions = document.querySelectorAll('#deviceSelect option:checked');
    const selectedDeviceIds = Array.from(selectedDeviceOptions).map(option => option.value);

    if (selectedDeviceIds.length === 0) {
        return {
            isValid: false,
            error: 'Seleziona almeno un dispositivo per generare il report'
        };
    }

    const datePreset = document.getElementById('datePreset').value;
    let fromDate, toDate;

    if (datePreset === 'custom') {
        fromDate = document.getElementById('fromDate').value;
        toDate = document.getElementById('toDate').value;

        if (!fromDate || !toDate) {
            return {
                isValid: false,
                error: 'Inserisci le date di inizio e fine per il periodo personalizzato'
            };
        }

        // Valida che fromDate non sia successiva a toDate
        if (new Date(fromDate) > new Date(toDate)) {
            return {
                isValid: false,
                error: 'La data di inizio non può essere successiva alla data di fine'
            };
        }

        // Valida che le date non siano troppo nel futuro
        const now = new Date();
        if (new Date(toDate) > now) {
            return {
                isValid: false,
                error: 'La data di fine non può essere nel futuro'
            };
        }

        // Avvisa se il range è molto ampio
        const daysDiff = (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24);
        if (daysDiff > 90) {
            if (!confirm(`Stai richiedendo un report per ${Math.round(daysDiff)} giorni. Questo potrebbe richiedere molto tempo. Continuare?`)) {
                return {
                    isValid: false,
                    error: 'Operazione annullata dall\'utente'
                };
            }
        }
    } else {
        const dates = getDateRangeFromPreset(datePreset);
        fromDate = dates.from;
        toDate = dates.to;
    }

    // Informazioni sui dispositivi selezionati per il log
    const selectedDeviceNames = Array.from(selectedDeviceOptions).map(option =>
        option.getAttribute('data-device-name') || option.textContent
    );

    console.log(`Generazione report per ${selectedDeviceIds.length} dispositivi:`, selectedDeviceNames);

    return {
        isValid: true,
        deviceIds: selectedDeviceIds,
        deviceNames: selectedDeviceNames,
        fromDate: fromDate,
        toDate: toDate,
        reportType: document.getElementById('reportType').value,
        datePreset: datePreset
    };
}

async function fetchReportData(params) {
    console.log('=== FETCHING REAL REPORT DATA ===');
    console.log('Parametri report:', params);

    try {
        // Converte le date nel formato ISO per l'API
        const fromDate = new Date(params.fromDate);
        const toDate = new Date(params.toDate);

        // Aggiungi ore per coprire l'intera giornata
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);

        console.log(`Periodo dati: ${fromDate.toISOString()} -> ${toDate.toISOString()}`);

        // Carica dati per ogni dispositivo selezionato
        const devicesData = await Promise.all(
            params.deviceIds.map(async (deviceId) => {
                console.log(`Caricamento dati per dispositivo ${deviceId}...`);

                try {
                    // Ottieni informazioni del dispositivo
                    const deviceResponse = await fetch(`/api/devices/${deviceId}`);
                    const deviceInfo = await deviceResponse.json();

                    if (!deviceResponse.ok) {
                        console.warn(`Impossibile caricare info dispositivo ${deviceId}:`, deviceInfo);
                        throw new Error(`Dispositivo ${deviceId} non accessibile`);
                    }

                    // Ottieni posizioni del dispositivo per il periodo
                    const hoursRange = Math.ceil((toDate - fromDate) / (1000 * 60 * 60));
                    const positionsResponse = await fetch(
                        `/api/positions?deviceId=${deviceId}&hours=${hoursRange}`
                    );
                    const positions = await positionsResponse.json();

                    console.log(`Dispositivo ${deviceId} (${deviceInfo.name}): ${positions.length} posizioni`);

                    // Ottieni status attuale del dispositivo
                    const statusResponse = await fetch(`/api/device/${deviceId}/status`);
                    const deviceStatus = await statusResponse.json();

                    // Calcola statistiche dalle posizioni reali
                    const stats = calculateRealDeviceStats(positions, deviceInfo, deviceStatus);

                    return {
                        deviceId: deviceId,
                        deviceName: deviceInfo.name || `Dispositivo ${deviceId}`,
                        deviceInfo: deviceInfo,
                        positions: positions,
                        status: deviceStatus,
                        ...stats
                    };

                } catch (deviceError) {
                    console.error(`Errore dispositivo ${deviceId}:`, deviceError);
                    return {
                        deviceId: deviceId,
                        deviceName: `Dispositivo ${deviceId} (Errore)`,
                        error: deviceError.message,
                        distance: 0,
                        engineHours: 0,
                        maxSpeed: 0,
                        averageSpeed: 0,
                        stops: 0,
                        fuel: 0
                    };
                }
            })
        );

        // Filtra dispositivi con errori per il calcolo totali
        const validDevices = devicesData.filter(device => !device.error);
        const errorDevices = devicesData.filter(device => device.error);

        if (errorDevices.length > 0) {
            console.warn(`${errorDevices.length} dispositivi con errori:`, errorDevices);
            showNotification(`⚠️ ${errorDevices.length} dispositivi non accessibili`, 'warning');
        }

        // Calcola totali reali
        const totals = calculateTotalStats(validDevices);

        const reportData = {
            type: params.reportType,
            title: `Report ${getReportTypeLabel(params.reportType)}`,
            description: `Report automatico per ${devicesData.length} dispositivi (${validDevices.length} accessibili)`,
            devices_count: devicesData.length,
            valid_devices_count: validDevices.length,
            period: {
                from: params.fromDate,
                to: params.toDate,
                fromISO: fromDate.toISOString(),
                toISO: toDate.toISOString()
            },
            totals: totals,
            data: devicesData,
            generated_at: new Date().toISOString(),
            generated_by: 'Sistema Traccar'
        };

        console.log('Report data generato:', reportData);

        return {
            success: true,
            data: reportData
        };

    } catch (error) {
        console.error('Errore nella generazione report data:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Calcola statistiche reali da array di posizioni Traccar
 */
function calculateRealDeviceStats(positions, deviceInfo, deviceStatus) {
    if (!positions || positions.length === 0) {
        return {
            distance: 0,
            engineHours: 0,
            maxSpeed: 0,
            averageSpeed: 0,
            stops: 0,
            fuel: 0
        };
    }

    // Ordina posizioni per tempo
    positions.sort((a, b) => new Date(a.deviceTime) - new Date(b.deviceTime));

    let totalDistance = 0;
    let totalMovingTime = 0;
    let maxSpeed = 0;
    let speedSum = 0;
    let speedCount = 0;
    let stops = 0;
    let lastPosition = null;
    let wasMoving = false;

    // Calcola statistiche dalle posizioni reali
    positions.forEach((position, index) => {
        // Velocità massima
        const speed = position.speed || 0;
        maxSpeed = Math.max(maxSpeed, speed);

        if (speed > 0) {
            speedSum += speed;
            speedCount++;
        }

        // Calcola distanza tra posizioni consecutive
        if (lastPosition && position.latitude && position.longitude) {
            const distance = calculateDistance(
                lastPosition.latitude, lastPosition.longitude,
                position.latitude, position.longitude
            );
            totalDistance += distance;
        }

        // Rileva soste (velocità zero dopo movimento)
        const isMoving = speed > 3; // km/h soglia movimento
        if (wasMoving && !isMoving) {
            stops++;
        }
        wasMoving = isMoving;

        // Calcola tempo di movimento
        if (lastPosition && isMoving) {
            const timeDiff = new Date(position.deviceTime) - new Date(lastPosition.deviceTime);
            totalMovingTime += timeDiff / (1000 * 60); // minuti
        }

        lastPosition = position;
    });

    // Calcola velocità media
    const averageSpeed = speedCount > 0 ? (speedSum / speedCount) : 0;

    // Stima carburante basata su distanza (approssimazione)
    const estimatedFuel = totalDistance > 0 ? (totalDistance / 100) * 8 : 0; // 8L/100km

    return {
        distance: Math.round(totalDistance * 1000), // metri
        engineHours: Math.round(totalMovingTime), // minuti
        maxSpeed: Math.round(maxSpeed * 3.6), // km/h (da m/s)
        averageSpeed: Math.round(averageSpeed * 3.6), // km/h (da m/s)
        stops: stops,
        fuel: Math.round(estimatedFuel)
    };
}

/**
 * Calcola distanza tra due punti geografici (formula Haversine)
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raggio Terra in km
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

/**
 * Calcola statistiche totali da array di dispositivi
 */
function calculateTotalStats(devicesData) {
    if (!devicesData || devicesData.length === 0) {
        return {
            totalDistance: 0,
            totalDriving: 0,
            totalFuel: 0,
            totalStops: 0,
            averageSpeed: 0,
            maxSpeed: 0
        };
    }

    const totals = devicesData.reduce((acc, device) => {
        return {
            totalDistance: acc.totalDistance + (device.distance || 0),
            totalDriving: acc.totalDriving + (device.engineHours || 0),
            totalFuel: acc.totalFuel + (device.fuel || 0),
            totalStops: acc.totalStops + (device.stops || 0),
            maxSpeed: Math.max(acc.maxSpeed, device.maxSpeed || 0)
        };
    }, {
        totalDistance: 0,
        totalDriving: 0,
        totalFuel: 0,
        totalStops: 0,
        maxSpeed: 0
    });

    // Calcola velocità media ponderata
    const totalValidDevices = devicesData.filter(d => d.averageSpeed > 0).length;
    totals.averageSpeed = totalValidDevices > 0
        ? Math.round(devicesData.reduce((sum, d) => sum + (d.averageSpeed || 0), 0) / totalValidDevices)
        : 0;

    return totals;
}

/**
 * Genera PDF professionale con solo caratteri ASCII standard
 */
async function generateProfessionalPDF(reportData, reportParams) {
    try {
        console.log('=== GENERATING PROFESSIONAL PDF ===');
        console.log('Report data:', reportData);

        const { jsPDF } = window.jspdf;

        if (!jsPDF) {
            throw new Error('jsPDF non è disponibile. Assicurati che la libreria sia caricata.');
        }

        const doc = new jsPDF();

        // Configurazione PDF
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        let yPos = margin;

        console.log('PDF dimensions:', { pageWidth, pageHeight, margin });

        // === HEADER PROFESSIONALE ===
        yPos += 10;
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(13, 110, 253); // Blue primary
        doc.text('TRACCAR GPS SOLUTIONS', margin, yPos);

        yPos += 8;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(108, 117, 125); // Gray
        doc.text('Sistema di Monitoraggio e Tracking GPS Professionale', margin, yPos);

        // Linea separatore
        yPos += 10;
        doc.setDrawColor(13, 110, 253);
        doc.setLineWidth(2);
        doc.line(margin, yPos, pageWidth - margin, yPos);
        yPos += 15;

        // === INFORMAZIONI REPORT ===
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(33, 37, 41);
        doc.text(`REPORT ${getReportTypeLabel(reportData.type).toUpperCase()}`, margin, yPos);

        // Info box
        yPos += 15;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');

        const infoLines = [
            `Generato il: ${formatDateTime(new Date())}`,
            `Periodo: ${formatDate(reportData.period.from)} - ${formatDate(reportData.period.to)}`,
            `Dispositivi monitorati: ${reportData.devices_count} (${reportData.valid_devices_count || reportData.devices_count} accessibili)`,
            `Tipo analisi: ${getReportTypeLabel(reportData.type)}`
        ];

        // Sfondo per info box
        doc.setFillColor(248, 249, 250);
        doc.roundedRect(margin, yPos - 5, pageWidth - 2 * margin, 25, 3, 3, 'F');

        infoLines.forEach(line => {
            doc.text(line, margin + 5, yPos);
            yPos += 5;
        });

        yPos += 15;

        // === SEZIONE RIEPILOGO STATISTICHE ===
        if (reportData.totals) {
            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(13, 110, 253);
            doc.text('RIEPILOGO GENERALE', margin, yPos);
            yPos += 10;

            // Statistiche in colonne - SOLO CARATTERI ASCII
            const stats = [
                { label: 'Distanza Totale', value: `${(reportData.totals.totalDistance / 1000).toFixed(1)} km`, code: '[DIST]' },
                { label: 'Tempo di Guida', value: formatDuration(reportData.totals.totalDriving), code: '[TIME]' },
                { label: 'Velocita Media', value: `${reportData.totals.averageSpeed} km/h`, code: '[V-MED]' },
                { label: 'Velocita Massima', value: `${reportData.totals.maxSpeed} km/h`, code: '[V-MAX]' },
                { label: 'Soste Totali', value: reportData.totals.totalStops.toString(), code: '[STOPS]' },
                { label: 'Consumo Stimato', value: `${reportData.totals.totalFuel || 0} L`, code: '[FUEL]' }
            ];

            // Sfondo per statistiche
            doc.setFillColor(240, 248, 255);
            doc.roundedRect(margin, yPos - 3, pageWidth - 2 * margin, 40, 3, 3, 'F');

            doc.setFontSize(9);
            doc.setTextColor(33, 37, 41);

            const colWidth = (pageWidth - 2 * margin - 10) / 3;
            stats.forEach((stat, index) => {
                const col = index % 3;
                const row = Math.floor(index / 3);
                const x = margin + 5 + (col * colWidth);
                const y = yPos + (row * 18);

                // Codice identificativo
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(108, 117, 125);
                doc.text(stat.code, x, y);

                // Etichetta
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(33, 37, 41);
                doc.text(stat.label, x, y + 5);

                // Valore
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(13, 110, 253);
                doc.text(stat.value, x, y + 11);
            });

            yPos += 50;
        }

        // === TABELLA DETTAGLI DISPOSITIVI ===
        if (reportData.data && reportData.data.length > 0) {
            // Controlla spazio rimanente
            if (yPos > pageHeight - 80) {
                doc.addPage();
                yPos = margin;
            }

            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(13, 110, 253);
            doc.text('DETTAGLI PER DISPOSITIVO', margin, yPos);
            yPos += 15;

            // Header tabella
            const headers = ['Dispositivo', 'Distanza', 'Durata', 'Vel.Media', 'Vel.Max', 'Soste'];
            const colWidths = [55, 22, 22, 22, 22, 17];
            const startX = margin;

            // Sfondo header
            doc.setFillColor(13, 110, 253);
            doc.rect(startX, yPos - 3, pageWidth - 2 * margin, 12, 'F');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(255, 255, 255);

            let xPos = startX + 2;
            headers.forEach((header, index) => {
                doc.text(header, xPos, yPos + 5);
                xPos += colWidths[index];
            });

            yPos += 15;

            // Righe dati
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(33, 37, 41);
            doc.setFontSize(8);

            reportData.data.forEach((device, index) => {
                // Controlla spazio per nuova riga
                if (yPos > pageHeight - 25) {
                    doc.addPage();
                    yPos = margin;

                    // Ripeti header sulla nuova pagina
                    doc.setFillColor(13, 110, 253);
                    doc.rect(startX, yPos - 3, pageWidth - 2 * margin, 12, 'F');
                    doc.setFontSize(9);
                    doc.setFont('helvetica', 'bold');
                    doc.setTextColor(255, 255, 255);

                    xPos = startX + 2;
                    headers.forEach((header, headerIndex) => {
                        doc.text(header, xPos, yPos + 5);
                        xPos += colWidths[headerIndex];
                    });
                    yPos += 15;

                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(33, 37, 41);
                    doc.setFontSize(8);
                }

                // Sfondo alternato
                if (index % 2 === 0) {
                    doc.setFillColor(248, 249, 250);
                    doc.rect(startX, yPos - 2, pageWidth - 2 * margin, 10, 'F');
                }

                // Prepara dati della riga
                const deviceName = device.deviceName || `Dispositivo ${index + 1}`;
                const truncatedName = deviceName.length > 20 ? deviceName.substring(0, 17) + '...' : deviceName;

                const rowData = [
                    truncatedName,
                    `${(device.distance / 1000).toFixed(1)} km`,
                    formatDuration(device.engineHours) || '0:00',
                    `${device.averageSpeed || 0} km/h`,
                    `${device.maxSpeed || 0} km/h`,
                    (device.stops || 0).toString()
                ];

                // Se c'è un errore, mostra il messaggio
                if (device.error) {
                    rowData[1] = 'ERRORE';
                    rowData[2] = 'N/A';
                    rowData[3] = 'N/A';
                    rowData[4] = 'N/A';
                    rowData[5] = 'N/A';
                }

                xPos = startX + 2;
                rowData.forEach((cell, cellIndex) => {
                    doc.text(cell, xPos, yPos + 5);
                    xPos += colWidths[cellIndex];
                });

                yPos += 10;
            });
        }

        // === FOOTER ===
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);

            // Linea footer
            doc.setDrawColor(13, 110, 253);
            doc.setLineWidth(1);
            doc.line(margin, pageHeight - 20, pageWidth - margin, pageHeight - 20);

            // Testo footer
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(108, 117, 125);

            doc.text(
                `Report generato automaticamente da Traccar GPS Solutions - ${formatDateTime(new Date())}`,
                margin,
                pageHeight - 12
            );

            doc.text(
                `Pagina ${i} di ${totalPages}`,
                pageWidth - margin - 30,
                pageHeight - 12
            );
        }

        const pdfBlob = doc.output('blob');
        console.log('PDF generated successfully, size:', pdfBlob.size);

        return pdfBlob;

    } catch (error) {
        console.error('Errore generazione PDF:', error);
        throw new Error(`Errore nella generazione PDF: ${error.message}`);
    }
}

/**
 * Salva PDF nel repository con metadati migliorati
 */
async function savePDFToRepository(pdfBlob, filename = null, title = null, description = null) {
    try {
        console.log('=== SAVING PDF TO REPOSITORY ===');
        console.log('PDF Blob size:', pdfBlob.size);
        console.log('PDF Blob type:', pdfBlob.type);

        const formData = new FormData();

        // Nome file con timestamp
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
        const finalFilename = filename || `report_auto_${timestamp}.pdf`;

        // Assicurati che il blob sia trattato come PDF
        const pdfFile = new File([pdfBlob], finalFilename, {
            type: 'application/pdf',
            lastModified: Date.now()
        });

        formData.append('file', pdfFile);

        if (title) {
            formData.append('title', title);
        }

        if (description) {
            formData.append('description', description);
        }

        formData.append('filename', finalFilename);

        console.log('FormData contents:');
        for (let [key, value] of formData.entries()) {
            if (value instanceof File) {
                console.log(`${key}: File(${value.name}, ${value.size} bytes, ${value.type})`);
            } else {
                console.log(`${key}: ${value}`);
            }
        }

        const response = await fetch('/api/reports/pdf', {
            method: 'POST',
            body: formData
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);

        if (!response.ok) {
            const responseText = await response.text();
            console.error('Error response body:', responseText);

            let errorMessage = `Errore HTTP: ${response.status} ${response.statusText}`;

            // Prova a parsare la risposta come JSON per ottenere un messaggio di errore più specifico
            try {
                const errorData = JSON.parse(responseText);
                if (errorData.error) {
                    errorMessage = errorData.error;
                }
            } catch (parseError) {
                // Se non è JSON, usa il testo della risposta
                if (responseText) {
                    errorMessage = responseText;
                }
            }

            throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log('Save result:', result);
        return result;

    } catch (error) {
        console.error('Errore nel salvataggio PDF:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==================== FUNZIONI DI ESPORTAZIONE MANUALE ====================

/**
 * Funzione di esportazione manuale (pulsante Export PDF)
 */
async function exportReport(format) {
    if (!currentReportData) {
        showNotification('❌ Genera prima un report prima di esportare', 'error');
        return;
    }

    try {
        showLoadingOverlay(true, `Esportazione ${format.toUpperCase()} in corso...`);

        switch (format) {
            case 'pdf':
                await exportAndSavePDF();
                break;
            case 'excel':
                await exportToExcel();
                break;
            case 'csv':
                await exportToCSV();
                break;
            default:
                throw new Error(`Formato ${format} non supportato`);
        }

        showLoadingOverlay(false);

    } catch (error) {
        console.error(`Errore esportazione ${format}:`, error);
        showNotification(`❌ Errore esportazione ${format}: ${error.message}`, 'error');
        showLoadingOverlay(false);
    }
}

/**
 * Esportazione PDF manuale (con opzioni personalizzabili)
 */
async function exportAndSavePDF() {
    try {
        // Leggi opzioni PDF
        const options = {
            includeLogo: document.getElementById('includeLogo')?.checked ?? true,
            includeCharts: document.getElementById('includeCharts')?.checked ?? true,
            includeMap: document.getElementById('includeMap')?.checked ?? true
        };

        // Genera PDF con opzioni personalizzate
        const pdfBlob = await generateCustomPDF(currentReportData, options);

        // Richiedi titolo personalizzato
        const customTitle = prompt(
            'Inserisci un titolo per il report PDF (opzionale):',
            `Report ${getReportTypeLabel(currentReportData.type)} - ${formatDate(new Date())}`
        );

        let customDescription = null;
        if (customTitle) {
            customDescription = prompt(
                'Inserisci una descrizione (opzionale):',
                `Report personalizzato esportato manualmente.`
            );
        }

        // Salva nel repository
        const saveResult = await savePDFToRepository(
            pdfBlob,
            null,
            customTitle || undefined,
            customDescription || undefined
        );

        if (saveResult.success) {
            showNotification(
                `✅ PDF salvato nel repository: ${saveResult.filename}`,
                'success'
            );

            // Offri anche download diretto
            offerDirectDownload(pdfBlob, saveResult.filename);

            // Aggiorna lista salvati
            await refreshSavedReportsList();
        } else {
            throw new Error(saveResult.error);
        }

    } catch (error) {
        if (error.message !== 'Operazione annullata dall\'utente') {
            throw error;
        }
    }
}

async function generateCustomPDF(reportData, options = {}) {
    // Utilizza la funzione di generazione PDF principale con opzioni personalizzate
    return await generateProfessionalPDF(reportData, {
        reportType: reportData.type,
        fromDate: reportData.period.from,
        toDate: reportData.period.to,
        options: options
    });
}

// ==================== GESTIONE LISTA REPORT SALVATI ====================

async function refreshSavedReportsList() {
    try {
        const response = await fetch('/api/reports?format=pdf&limit=5');
        const data = await response.json();

        if (data.success) {
            updateSavedReportsUI(data.reports);
        }

    } catch (error) {
        console.error('Errore aggiornamento lista salvati:', error);
    }
}

async function loadSavedReportsList() {
    await refreshSavedReportsList();
}

function updateSavedReportsUI(reports) {
    const container = document.getElementById('savedReportsList');
    if (!container) {
        // Crea container se non esiste
        createSavedReportsContainer();
        return updateSavedReportsUI(reports);
    }

    container.innerHTML = '';

    if (reports.length === 0) {
        container.innerHTML = `
            <div class="text-center text-muted py-3">
                <i class="fas fa-folder-open"></i>
                <p class="mb-0 small">Nessun PDF salvato</p>
            </div>
        `;
        return;
    }

    reports.forEach(report => {
        const reportCard = createSavedReportCard(report);
        container.appendChild(reportCard);
    });
}

function createSavedReportsContainer() {
    const exportSection = document.querySelector('.export-section');
    if (!exportSection) return;

    const savedContainer = document.createElement('div');
    savedContainer.className = 'mt-4';
    savedContainer.innerHTML = `
        <h6 class="mb-3">
            <i class="fas fa-archive"></i> PDF Salvati di Recente
        </h6>
        <div id="savedReportsList" class="saved-reports-list">
            <!-- Reports salvati -->
        </div>
        <div class="text-center mt-2">
            <a href="/reports/repository" class="btn btn-outline-light btn-sm">
                <i class="fas fa-folder"></i> Vedi Tutti
            </a>
        </div>
    `;

    exportSection.appendChild(savedContainer);
}

function createSavedReportCard(report) {
    const card = document.createElement('div');
    card.className = 'card mb-2 saved-report-card';

    const formatFileSize = (bytes) => {
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(bytes / 1024).toFixed(0)}KB` : `${mb.toFixed(1)}MB`;
    };

    const formatDate = (isoString) => {
        return new Date(isoString).toLocaleDateString('it-IT', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    card.innerHTML = `
        <div class="card-body py-2 px-3">
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <h6 class="card-title mb-1 small">${report.title}</h6>
                    <p class="card-text mb-0" style="font-size: 0.75rem; color: rgba(255,255,255,0.7);">
                        📄 ${formatFileSize(report.file_size)} • ${formatDate(report.created_at)}
                    </p>
                </div>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-outline-light btn-sm" onclick="downloadSavedReport('${report.id}')"
                            title="Scarica PDF">
                        <i class="fas fa-download"></i>
                    </button>
                </div>
            </div>
        </div>
    `;

    return card;
}

async function downloadSavedReport(reportId) {
    try {
        const response = await fetch(`/api/reports/${reportId}/download`);

        if (!response.ok) {
            throw new Error('Errore nel download del report');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = 'report.pdf';

        if (contentDisposition) {
            const matches = contentDisposition.match(/filename="(.+)"/);
            if (matches) filename = matches[1];
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();

        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showNotification('✅ Report scaricato', 'success');

    } catch (error) {
        console.error('Errore download:', error);
        showNotification(`❌ Errore download: ${error.message}`, 'error');
    }
}

// ==================== FUNZIONI DI UTILITÀ ====================

function displayReportResults(reportData) {
    // Aggiorna statistiche
    if (reportData.totals) {
        document.getElementById('totalDistance').textContent = `${(reportData.totals.totalDistance / 1000).toFixed(1)} km`;
        document.getElementById('totalTime').textContent = formatDuration(reportData.totals.totalDriving);
        document.getElementById('avgSpeed').textContent = `${reportData.totals.averageSpeed} km/h`;
        document.getElementById('maxSpeed').textContent = `${reportData.totals.maxSpeed} km/h`;
    }

    // Mostra cards statistiche
    document.getElementById('statsCards').style.display = 'block';

    // Aggiorna contenuto report
    const reportContent = document.getElementById('reportContent');
    reportContent.innerHTML = generateReportHTML(reportData);

    // Aggiorna info report
    document.getElementById('reportInfo').style.display = 'block';
    document.getElementById('reportGeneratedAt').textContent = `Generato il ${formatDateTime(new Date())}`;
}

function generateReportHTML(reportData) {
    let html = `
        <div class="report-summary mb-4">
            <h5><i class="fas fa-chart-bar text-primary"></i> ${reportData.title}</h5>
            <p class="text-muted">${reportData.description}</p>
        </div>

        <div class="table-responsive">
            <table class="table table-striped report-table">
                <thead>
                    <tr>
                        <th>Dispositivo</th>
                        <th>Distanza</th>
                        <th>Durata</th>
                        <th>Velocità Media</th>
                        <th>Velocità Max</th>
                        <th>Soste</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (reportData.data && reportData.data.length > 0) {
        reportData.data.forEach(device => {
            html += `
                <tr>
                    <td><strong>${device.deviceName || 'N/A'}</strong></td>
                    <td>${(device.distance / 1000).toFixed(1)} km</td>
                    <td>${formatDuration(device.engineHours) || '0:00'}</td>
                    <td>${device.averageSpeed || 0} km/h</td>
                    <td>${device.maxSpeed || 0} km/h</td>
                    <td>${device.stops || 0}</td>
                </tr>
            `;
        });
    } else {
        html += '<tr><td colspan="6" class="text-center text-muted">Nessun dato disponibile</td></tr>';
    }

    html += `
                </tbody>
            </table>
        </div>
    `;

    return html;
}

function enableExportButtons() {
    document.getElementById('exportPDF').disabled = false;
    document.getElementById('exportExcel').disabled = false;
    document.getElementById('exportCSV').disabled = false;
}

function getReportTypeLabel(type) {
    const labels = {
        'summary': 'Riepilogo Generale',
        'routes': 'Analisi Percorsi',
        'stops': 'Analisi Soste',
        'trips': 'Dettaglio Viaggi',
        'performance': 'Performance Veicoli'
    };
    return labels[type] || 'Report Generico';
}

function formatDuration(minutes) {
    if (!minutes || minutes === 0) return '0:00';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}:${mins.toString().padStart(2, '0')}`;
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('it-IT');
}

function formatDateTime(date) {
    return date.toLocaleString('it-IT');
}

function showNotification(message, type = 'info') {
    // Implementa il tuo sistema di notifiche
    console.log(`[${type.toUpperCase()}] ${message}`);

    // Esempio con alert temporaneo - sostituisci con il tuo sistema
    if (type === 'error') {
        console.error(message);
    }
}

function showLoadingOverlay(show, message = '') {
    const overlay = document.getElementById('loadingOverlay');
    if (!overlay) return;

    if (show) {
        overlay.style.display = 'flex';
        const messageEl = overlay.querySelector('.loading-content p');
        if (messageEl && message) {
            messageEl.textContent = message;
        }
    } else {
        overlay.style.display = 'none';
    }
}

function offerDirectDownload(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;

    // Offri il download con un pulsante temporaneo
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'btn btn-outline-success btn-sm ms-2';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Scarica anche localmente';
    downloadBtn.onclick = () => {
        a.click();
        window.URL.revokeObjectURL(url);
        downloadBtn.remove();
    };

    // Aggiungi il pulsante temporaneamente
    setTimeout(() => {
        if (downloadBtn.parentNode) downloadBtn.remove();
        window.URL.revokeObjectURL(url);
    }, 30000);
}

// ==================== CARICAMENTO DISPOSITIVI REALI ====================

async function loadDevices() {
    console.log('=== LOADING REAL DEVICES ===');
    const deviceSelect = document.getElementById('deviceSelect');

    try {
        // Mostra loading
        deviceSelect.innerHTML = '<option value="">Caricamento dispositivi...</option>';

        // Prima verifica lo stato della connessione Traccar
        const debugResponse = await fetch('/api/debug/traccar-status');
        const debugInfo = await debugResponse.json();

        console.log('Debug Traccar Status:', debugInfo);

        if (!debugInfo.server_reachable) {
            throw new Error('Server Traccar non raggiungibile');
        }

        if (!debugInfo.session_valid) {
            console.warn('Sessione Traccar non valida, tentativo di riparazione...');

            // Tenta di riparare la sessione
            try {
                const repairResponse = await fetch('/api/force-reload-devices');
                const repairResult = await repairResponse.json();

                if (repairResult.success) {
                    console.log('Sessione riparata con successo');
                    showNotification('✅ Connessione Traccar ripristinata', 'success');
                } else {
                    console.warn('Riparazione sessione fallita:', repairResult.error);
                }
            } catch (repairError) {
                console.error('Errore nella riparazione sessione:', repairError);
            }
        }

        // Carica i dispositivi reali
        console.log('Caricamento dispositivi da API Traccar...');
        const response = await fetch('/api/devices');

        if (!response.ok) {
            throw new Error(`Errore API dispositivi: ${response.status} ${response.statusText}`);
        }

        const devices = await response.json();
        console.log(`Ricevuti ${devices.length} dispositivi:`, devices);

        // Popola il select con i dispositivi reali
        deviceSelect.innerHTML = '<option value="">Seleziona dispositivi...</option>';

        if (devices.length === 0) {
            deviceSelect.innerHTML = '<option value="" disabled>Nessun dispositivo disponibile</option>';
            showNotification('⚠️ Nessun dispositivo trovato', 'warning');
            return;
        }

        devices.forEach(device => {
            const option = document.createElement('option');
            option.value = device.id;

            // Crea un nome descrittivo per il dispositivo
            let deviceDisplayName = device.name || `Dispositivo ${device.id}`;

            // Aggiungi IMEI/UniqueID se disponibile
            if (device.uniqueId) {
                deviceDisplayName += ` (${device.uniqueId})`;
            }

            // Aggiungi info sul modello se disponibile
            if (device.model) {
                deviceDisplayName += ` - ${device.model}`;
            }

            option.textContent = deviceDisplayName;
            option.setAttribute('data-device-name', device.name);
            option.setAttribute('data-device-imei', device.uniqueId || '');
            option.setAttribute('data-device-model', device.model || '');
            option.setAttribute('data-device-category', device.category || '');

            deviceSelect.appendChild(option);
        });

        console.log(`✅ Caricati ${devices.length} dispositivi reali`);
        showNotification(`✅ Caricati ${devices.length} dispositivi`, 'success');

        // Salva i dispositivi per uso futuro
        window.traccarDevices = devices;

    } catch (error) {
        console.error('Errore nel caricamento dei dispositivi:', error);

        deviceSelect.innerHTML = `
            <option value="" disabled>❌ Errore caricamento</option>
            <option value="" disabled>${error.message}</option>
        `;

        showNotification(`❌ Errore caricamento dispositivi: ${error.message}`, 'error');

        // Mostra un pulsante per riprovare
        const retryBtn = document.createElement('button');
        retryBtn.className = 'btn btn-warning btn-sm mt-2 w-100';
        retryBtn.innerHTML = '<i class="fas fa-redo"></i> Riprova Caricamento';
        retryBtn.onclick = loadDevices;

        const deviceContainer = deviceSelect.parentElement;
        const existingRetryBtn = deviceContainer.querySelector('.btn-warning');
        if (existingRetryBtn) {
            existingRetryBtn.remove();
        }
        deviceContainer.appendChild(retryBtn);
    }
}

function handleDatePresetChange() {
    const preset = document.getElementById('datePreset').value;
    const customRange = document.getElementById('customDateRange');

    if (preset === 'custom') {
        customRange.style.display = 'block';
    } else {
        customRange.style.display = 'none';

        const dates = getDateRangeFromPreset(preset);
        document.getElementById('fromDate').value = dates.from;
        document.getElementById('toDate').value = dates.to;
    }
}

function getDateRangeFromPreset(preset) {
    const today = new Date();
    const dates = { to: today.toISOString().split('T')[0] };

    switch (preset) {
        case 'today':
            dates.from = dates.to;
            break;
        case 'yesterday':
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            dates.from = dates.to = yesterday.toISOString().split('T')[0];
            break;
        case 'week':
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            dates.from = weekAgo.toISOString().split('T')[0];
            break;
        case 'month':
            const monthAgo = new Date(today);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            dates.from = monthAgo.toISOString().split('T')[0];
            break;
        default:
            dates.from = dates.to;
    }

    return dates;
}

function toggleAllDevices() {
    const selectAll = document.getElementById('selectAllDevices');
    const deviceOptions = document.querySelectorAll('#deviceSelect option:not([value=""])');

    deviceOptions.forEach(option => {
        option.selected = selectAll.checked;
    });

    // Aggiorna il contatore dei dispositivi selezionati
    updateDeviceSelectionInfo();
}

/**
 * Aggiorna le informazioni sui dispositivi selezionati
 */
function updateDeviceSelectionInfo() {
    const selectedOptions = document.querySelectorAll('#deviceSelect option:checked');
    const selectedCount = selectedOptions.length;

    // Aggiorna il testo del pulsante genera report
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        if (selectedCount > 0) {
            generateBtn.innerHTML = `<i class="fas fa-play"></i> Genera Report + Auto-PDF (${selectedCount} dispositivi)`;
            generateBtn.disabled = false;
        } else {
            generateBtn.innerHTML = `<i class="fas fa-play"></i> Genera Report + Auto-PDF`;
            generateBtn.disabled = false; // Lascio abilitato, la validazione avviene al click
        }
    }

    // Aggiorna il checkbox "Seleziona tutti"
    const selectAllCheckbox = document.getElementById('selectAllDevices');
    const totalOptions = document.querySelectorAll('#deviceSelect option:not([value=""])').length;

    if (selectAllCheckbox) {
        if (selectedCount === 0) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = false;
        } else if (selectedCount === totalOptions) {
            selectAllCheckbox.indeterminate = false;
            selectAllCheckbox.checked = true;
        } else {
            selectAllCheckbox.indeterminate = true;
            selectAllCheckbox.checked = false;
        }
    }

    // Mostra info sui dispositivi selezionati
    const deviceSelect = document.getElementById('deviceSelect');
    let infoText = '';

    if (selectedCount > 0) {
        const selectedNames = Array.from(selectedOptions)
            .map(option => option.getAttribute('data-device-name') || option.textContent)
            .slice(0, 3); // Mostra max 3 nomi

        infoText = selectedNames.join(', ');
        if (selectedCount > 3) {
            infoText += ` e altri ${selectedCount - 3}`;
        }
    }

    // Aggiorna o crea l'elemento info
    let infoElement = document.getElementById('deviceSelectionInfo');
    if (!infoElement) {
        infoElement = document.createElement('div');
        infoElement.id = 'deviceSelectionInfo';
        infoElement.className = 'form-text text-info mt-1';
        deviceSelect.parentElement.appendChild(infoElement);
    }

    if (selectedCount > 0) {
        infoElement.innerHTML = `<i class="fas fa-check-circle"></i> ${selectedCount} selezionati: ${infoText}`;
        infoElement.style.display = 'block';
    } else {
        infoElement.style.display = 'none';
    }
}

function setupEventListeners() {
    // Event listeners per la UI
    document.getElementById('datePreset').addEventListener('change', handleDatePresetChange);

    const selectAllDevices = document.getElementById('selectAllDevices');
    if (selectAllDevices) {
        selectAllDevices.addEventListener('change', toggleAllDevices);
    }

    const deviceSelect = document.getElementById('deviceSelect');
    if (deviceSelect) {
        deviceSelect.addEventListener('change', updateDeviceSelectionInfo);
    }

    // Aggiorna testo pulsante PDF quando si generano reports
    document.getElementById('exportPDF').addEventListener('click', function() {
        if (currentReportData) {
            exportAndSavePDF();
        }
    });

    // Event listener per controlli avanzati
    setupAdvancedEventListeners();
}

function setupAdvancedEventListeners() {
    // Validazione in tempo reale delle date personalizzate
    const fromDate = document.getElementById('fromDate');
    const toDate = document.getElementById('toDate');

    if (fromDate && toDate) {
        fromDate.addEventListener('change', validateDateRange);
        toDate.addEventListener('change', validateDateRange);
    }

    // Auto-refresh dispositivi ogni 5 minuti
    setInterval(async () => {
        if (document.visibilityState === 'visible') {
            console.log('Auto-refresh dispositivi...');
            await loadDevices();
        }
    }, 300000); // 5 minuti
}

function validateDateRange() {
    const fromDate = document.getElementById('fromDate');
    const toDate = document.getElementById('toDate');

    if (!fromDate.value || !toDate.value) return;

    const from = new Date(fromDate.value);
    const to = new Date(toDate.value);
    const now = new Date();

    // Reset stili
    fromDate.classList.remove('is-invalid');
    toDate.classList.remove('is-invalid');

    let hasError = false;

    // Valida che fromDate non sia successiva a toDate
    if (from > to) {
        toDate.classList.add('is-invalid');
        hasError = true;
    }

    // Valida che toDate non sia nel futuro
    if (to > now) {
        toDate.classList.add('is-invalid');
        hasError = true;
    }

    // Avvisa se il range è molto ampio (>30 giorni)
    const daysDiff = (to - from) / (1000 * 60 * 60 * 24);
    if (daysDiff > 30) {
        showNotification(`⚠️ Range molto ampio: ${Math.round(daysDiff)} giorni`, 'warning');
    }

    return !hasError;
}

// Esportazione in Excel e CSV (da implementare)
async function exportToExcel() {
    // Implementa esportazione Excel
    showNotification('Funzione Excel in sviluppo', 'info');
}

async function exportToCSV() {
    // Implementa esportazione CSV
    showNotification('Funzione CSV in sviluppo', 'info');
}

// Esporta le funzioni principali per l'uso globale
window.generateReport = generateReport;
window.exportReport = exportReport;
window.downloadSavedReport = downloadSavedReport;