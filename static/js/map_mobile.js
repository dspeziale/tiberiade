// Map Mobile JavaScript - Traccar Dashboard
// File: static/js/map_mobile.js

let map;
let markersLayer;
let pathLayer;
let currentData = [];
let allDevices = [];
let autoTrackingEnabled = false;
let autoRefreshInterval = null;
let isMobileDevice = window.innerWidth <= 768;
let isTabletDevice = window.innerWidth <= 1024 && window.innerWidth > 768;

// Inizializzazione quando la pagina è caricata
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing map page...');

    // Detecta se è un dispositivo mobile/tablet
    detectDeviceType();

    // Verifica che Leaflet sia caricato
    if (typeof L === 'undefined') {
        console.error('Leaflet not loaded!');
        showToast('Errore: Leaflet non caricato. Controlla la connessione internet.', 'error');
        return;
    }

    initializeMap();
    loadDevices();
    initializeDateInputs();
    setupSidebarObserver();
    setupMobileGestures();

    // Event listener per checkbox "tutti i dispositivi"
    document.getElementById('showAllDevices').addEventListener('change', function() {
        const container = document.getElementById('allDevicesContainer');
        if (this.checked) {
            container.classList.add('active');
            updateMapAllDevices();
        } else {
            container.classList.remove('active');
            const deviceId = document.getElementById('deviceSelect').value;
            if (deviceId) {
                updateMap();
            }
        }
    });

    // Gestione resize window
    window.addEventListener('resize', function() {
        detectDeviceType();
        handleResponsiveChanges();
        if (map) {
            setTimeout(() => map.invalidateSize(), 300);
        }
    });

    // Gestione orientamento su mobile
    window.addEventListener('orientationchange', function() {
        setTimeout(() => {
            detectDeviceType();
            handleResponsiveChanges();
            if (map) {
                map.invalidateSize();
            }
        }, 500);
    });
});

// Detecta il tipo di dispositivo
function detectDeviceType() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    isMobileDevice = width <= 768;
    isTabletDevice = width <= 1024 && width > 768;

    // Detecta anche touch device
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    console.log('Device detection:', {
        width,
        height,
        isMobileDevice,
        isTabletDevice,
        isTouchDevice
    });

    // Applica classi al body per CSS targeting
    document.body.classList.toggle('mobile-device', isMobileDevice);
    document.body.classList.toggle('tablet-device', isTabletDevice);
    document.body.classList.toggle('touch-device', isTouchDevice);
}

// Gestisce i cambiamenti responsive
function handleResponsiveChanges() {
    const controlsPanel = document.getElementById('controlsPanel');
    const floatingControls = document.getElementById('floatingControls');

    if (isMobileDevice) {
        // Su mobile, assicurati che il pannello sia chiuso inizialmente
        if (!controlsPanel.classList.contains('collapsed')) {
            // Non chiudere automaticamente, lascia che l'utente controlli
        }

        // Gestisci visibilità floating controls
        handleFloatingControlsVisibility();
    }
}

// Setup gesture su mobile
function setupMobileGestures() {
    if (!isMobileDevice) return;

    const controlsPanel = document.getElementById('controlsPanel');
    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    // Touch events per swipe down/up
    controlsPanel.addEventListener('touchstart', function(e) {
        startY = e.touches[0].clientY;
        isDragging = true;
    });

    controlsPanel.addEventListener('touchmove', function(e) {
        if (!isDragging) return;

        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // Solo se stai scrollando verso il basso all'inizio del contenuto
        if (deltaY > 0 && controlsPanel.scrollTop === 0) {
            e.preventDefault();

            // Applica una leggera trasformazione per feedback visivo
            if (deltaY > 50) {
                controlsPanel.style.transform = `translateY(${Math.min(deltaY - 50, 20)}px)`;
            }
        }
    });

    controlsPanel.addEventListener('touchend', function(e) {
        if (!isDragging) return;
        isDragging = false;

        const deltaY = currentY - startY;

        // Reset transform
        controlsPanel.style.transform = '';

        // Se swipe down > 100px, chiudi il pannello
        if (deltaY > 100 && controlsPanel.scrollTop === 0) {
            toggleControlsPanel();
        }
    });
}

// Gestisce la visibilità dei floating controls
function handleFloatingControlsVisibility() {
    if (!isMobileDevice) return;

    const controlsPanel = document.getElementById('controlsPanel');
    const floatingControls = document.getElementById('floatingControls');

    const isPanelOpen = !controlsPanel.classList.contains('collapsed');

    floatingControls.classList.toggle('panel-open', isPanelOpen);
}

// Funzione per osservare i cambiamenti della sidebar
function setupSidebarObserver() {
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                setTimeout(() => {
                    if (map) {
                        map.invalidateSize();
                    }
                }, 350);
            }
        });
    });

    observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
    });

    const sidebar = document.querySelector('.sidebar, .nav-sidebar, #sidebar, [class*="sidebar"]');
    if (sidebar) {
        observer.observe(sidebar, {
            attributes: true,
            attributeFilter: ['class']
        });
    }

    setInterval(() => {
        checkSidebarState();
    }, 1000);
}

function checkSidebarState() {
    const body = document.body;
    const sidebar = document.querySelector('.sidebar, .nav-sidebar, #sidebar, [class*="sidebar"]');

    let isCollapsed = false;

    if (body.classList.contains('sidebar-collapsed') ||
        body.classList.contains('sidebar-mini') ||
        body.classList.contains('nav-collapsed') ||
        body.classList.contains('sidebar-collapse')) {
        isCollapsed = true;
    }

    if (sidebar) {
        const sidebarWidth = sidebar.offsetWidth;
        if (sidebarWidth < 100) {
            isCollapsed = true;
        }
    }

    if (isCollapsed && !body.classList.contains('sidebar-collapsed')) {
        body.classList.add('sidebar-collapsed');
    } else if (!isCollapsed && body.classList.contains('sidebar-collapsed')) {
        body.classList.remove('sidebar-collapsed');
    }
}

function initializeMap() {
    console.log('Creating Leaflet map...');

    try {
        map = L.map('map', {
            center: [41.9028, 12.4964], // Roma, Italia
            zoom: 6,
            zoomControl: false,
            // Opzioni specifiche per mobile
            tap: isMobileDevice,
            touchZoom: true,
            doubleClickZoom: true,
            scrollWheelZoom: !isMobileDevice, // Disabilita scroll zoom su mobile
            dragging: true,
            keyboard: !isMobileDevice,
            // Smooth zoom animation
            zoomAnimation: true,
            fadeAnimation: true,
            markerZoomAnimation: true
        });

        // Layer tiles
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });

        const satelliteLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });

        osmLayer.addTo(map);

        window.layerControl = L.control.layers({
            'OpenStreetMap': osmLayer,
            'Topografica': satelliteLayer
        }, {}, {
            position: 'topright',
            collapsed: true
        });

        markersLayer = L.layerGroup().addTo(map);
        pathLayer = L.layerGroup().addTo(map);

        console.log('Map initialized successfully');

        setTimeout(() => {
            map.invalidateSize();
        }, 500);

        // Setup mobile-specific map behaviors
        if (isMobileDevice) {
            setupMobileMapBehaviors();
        }

    } catch (error) {
        console.error('Error initializing map:', error);
        showToast('Errore nell\'inizializzazione della mappa: ' + error.message, 'error');
    }
}

// Setup comportamenti specifici per mobile
function setupMobileMapBehaviors() {
    // Prevent context menu on long press
    map.getContainer().addEventListener('contextmenu', function(e) {
        e.preventDefault();
    });

    // Better touch handling
    map.on('movestart', function() {
        if (isMobileDevice) {
            // Nascondi temporaneamente UI durante il pan
            const controls = document.getElementById('floatingControls');
            controls.style.pointerEvents = 'none';
        }
    });

    map.on('moveend', function() {
        if (isMobileDevice) {
            // Ripristina UI dopo il pan
            const controls = document.getElementById('floatingControls');
            controls.style.pointerEvents = 'auto';
        }
    });
}

// FUNZIONE MODIFICATA per gestire mobile
function toggleControlsPanel() {
    const panel = document.getElementById('controlsPanel');
    const toggleBtn = document.getElementById('toggleBtn');
    const indicator = document.getElementById('collapsedIndicator');

    const isCollapsed = panel.classList.contains('collapsed');

    if (isCollapsed) {
        // Mostra pannello
        panel.classList.remove('collapsed');
        toggleBtn.classList.remove('collapsed');
        indicator.classList.remove('show');

        if (isMobileDevice) {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            toggleBtn.title = 'Nascondi Pannello';
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
            toggleBtn.title = 'Nascondi Pannello';
        }

        setTimeout(() => {
            toggleBtn.style.background = '#0d6efd';
        }, 150);

    } else {
        // Nascondi pannello
        panel.classList.add('collapsed');
        toggleBtn.classList.add('collapsed');

        if (isMobileDevice) {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
            toggleBtn.title = 'Mostra Pannello';
        } else {
            toggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            toggleBtn.title = 'Mostra Pannello';
        }

        setTimeout(() => {
            if (panel.classList.contains('collapsed')) {
                indicator.classList.add('show');
            }
        }, 300);
    }

    // Gestisci visibilità floating controls su mobile
    if (isMobileDevice) {
        handleFloatingControlsVisibility();
    }

    setTimeout(() => {
        if (map) {
            map.invalidateSize();
        }
    }, 350);
}

// Funzione wrapper per aggiornare la mappa
function updateMapAction() {
    if (document.getElementById('showAllDevices').checked) {
        updateMapAllDevices();
    } else {
        updateMap();
    }
}

function loadDevices() {
    console.log('Loading devices...');

    fetch('/api/devices')
        .then(response => response.json())
        .then(devices => {
            console.log('Devices loaded:', devices);
            allDevices = devices;
            const deviceSelect = document.getElementById('deviceSelect');
            deviceSelect.innerHTML = '<option value="">Seleziona un dispositivo</option>';

            devices.forEach(device => {
                const option = document.createElement('option');
                option.value = device.id;
                option.textContent = `${device.name} (${device.uniqueId})`;
                deviceSelect.appendChild(option);
            });

            if (devices.length === 0) {
                showToast('Nessun dispositivo trovato', 'warning');
            } else {
                showToast(`Caricati ${devices.length} dispositivi`, 'success');
            }
        })
        .catch(error => {
            console.error('Error loading devices:', error);
            const deviceSelect = document.getElementById('deviceSelect');
            deviceSelect.innerHTML = '<option value="">Errore caricamento dispositivi</option>';
            showToast('Errore nel caricamento dei dispositivi', 'error');
        });
}

function initializeDateInputs() {
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const formatLocalDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    document.getElementById('fromDate').value = formatLocalDateTime(from);
    document.getElementById('toDate').value = formatLocalDateTime(now);

    console.log('Date inputs initialized:');
    console.log('From (local):', formatLocalDateTime(from));
    console.log('To (local):', formatLocalDateTime(now));
}

function setTimeRange(hours) {
    const now = new Date();
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);

    const formatLocalDateTime = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };

    document.getElementById('fromDate').value = formatLocalDateTime(from);
    document.getElementById('toDate').value = formatLocalDateTime(now);

    console.log(`Time range set to ${hours} hours:`);
    console.log('From (local):', formatLocalDateTime(from));
    console.log('To (local):', formatLocalDateTime(now));

    showToast(`Periodo impostato: ultime ${hours} ore`, 'info');

    // Su mobile, chiudi il pannello dopo aver impostato il filtro rapido
    if (isMobileDevice) {
        setTimeout(() => {
            const panel = document.getElementById('controlsPanel');
            if (!panel.classList.contains('collapsed')) {
                toggleControlsPanel();
            }
        }, 1000);
    }
}

function updateMap() {
    const deviceId = document.getElementById('deviceSelect').value;
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;

    if (!deviceId || !fromDate || !toDate) {
        showToast('Seleziona dispositivo e periodo', 'warning');
        return;
    }

    console.log('Updating map for device:', deviceId);
    console.log('Date range (local inputs):', fromDate, 'to', toDate);
    showLoading(true);

    const fromTime = new Date(fromDate);
    const toTime = new Date(toDate);
    const hoursDiff = Math.ceil((toTime - fromTime) / (1000 * 60 * 60));

    console.log(`Time range: ${fromTime.toLocaleString()} to ${toTime.toLocaleString()}`);
    console.log(`Requesting ${hoursDiff} hours of data for device ${deviceId}`);

    fetch(`/api/positions?deviceId=${deviceId}&hours=${hoursDiff}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            return response.json();
        })
        .then(positions => {
            console.log('Positions loaded from API:', positions.length);

            const filteredPositions = positions.filter(pos => {
                const posTime = new Date(pos.serverTime || pos.deviceTime);
                const inRange = posTime >= fromTime && posTime <= toTime;

                if (!inRange) {
                    console.log(`Position ${pos.serverTime || pos.deviceTime} outside range ${fromTime.toISOString()} - ${toTime.toISOString()}`);
                }

                return inRange;
            });

            console.log(`Filtered ${filteredPositions.length} positions from ${positions.length} total`);
            console.log('Date filter range:', fromTime.toISOString(), 'to', toTime.toISOString());

            if (filteredPositions.length > 0) {
                console.log('First position time:', new Date(filteredPositions[0].serverTime || filteredPositions[0].deviceTime).toISOString());
                console.log('Last position time:', new Date(filteredPositions[filteredPositions.length - 1].serverTime || filteredPositions[filteredPositions.length - 1].deviceTime).toISOString());
            }

            currentData = filteredPositions;
            displayPositionsOnMap(filteredPositions);
            calculateStatistics(filteredPositions);
            showLoading(false);
            showToast(`Caricati ${filteredPositions.length} punti GPS`, 'success');
        })
        .catch(error => {
            console.error('Error loading positions:', error);
            showLoading(false);
            showToast(`Errore nel caricamento delle posizioni: ${error.message}`, 'error');
        });
}

function updateMapAllDevices() {
    console.log('Updating map for all devices');
    showLoading(true);

    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;

    const fromTime = new Date(fromDate);
    const toTime = new Date(toDate);
    const hoursDiff = Math.ceil((toTime - fromTime) / (1000 * 60 * 60));

    console.log(`Requesting ${hoursDiff} hours of data for all ${allDevices.length} devices`);

    const promises = allDevices.map(device =>
        fetch(`/api/positions?deviceId=${device.id}&hours=${hoursDiff}`)
            .then(response => response.ok ? response.json() : [])
            .then(positions => ({
                device: device,
                positions: positions.filter(pos => {
                    const posTime = new Date(pos.serverTime || pos.deviceTime);
                    return posTime >= fromTime && posTime <= toTime;
                })
            }))
            .catch(error => {
                console.error(`Error loading positions for device ${device.id}:`, error);
                return { device: device, positions: [] };
            })
    );

    Promise.all(promises)
        .then(deviceData => {
            displayAllDevicesOnMap(deviceData);
            showLoading(false);

            const totalPositions = deviceData.reduce((sum, data) => sum + data.positions.length, 0);
            showToast(`Caricati ${totalPositions} punti GPS da ${allDevices.length} dispositivi`, 'success');

            console.log('All devices data loaded:', deviceData.map(d => ({
                device: d.device.name,
                positions: d.positions.length
            })));
        })
        .catch(error => {
            console.error('Error loading all devices data:', error);
            showLoading(false);
            showToast('Errore nel caricamento dei dati', 'error');
        });
}

function displayPositionsOnMap(positions) {
    console.log('Displaying positions on map:', positions.length);

    markersLayer.clearLayers();
    pathLayer.clearLayers();

    if (positions.length === 0) {
        showToast('Nessuna posizione trovata per il periodo selezionato', 'warning');
        return;
    }

    const showPath = document.getElementById('showPath').checked;
    const showMarkers = document.getElementById('showMarkers').checked;

    positions.sort((a, b) => new Date(a.serverTime || a.deviceTime) - new Date(b.serverTime || b.deviceTime));

    if (showPath && positions.length > 1) {
        const latlngs = positions.map(pos => [pos.latitude, pos.longitude]);
        const polyline = L.polyline(latlngs, {
            color: '#0d6efd',
            weight: 3,
            opacity: 0.8
        }).addTo(pathLayer);
    }

    if (showMarkers) {
        positions.forEach((position, index) => {
            const isFirst = index === 0;
            const isLast = index === positions.length - 1;

            let markerColor = '#0d6efd';
            let markerIcon = 'circle';

            if (isFirst) {
                markerColor = '#198754';
                markerIcon = 'play';
            } else if (isLast) {
                markerColor = '#dc3545';
                markerIcon = 'stop';
            }

            const markerSize = isMobileDevice ? 20 : 18;

            const marker = L.marker([position.latitude, position.longitude], {
                icon: L.divIcon({
                    html: `<div style="background: ${markerColor}; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center;"><i class="fas fa-${markerIcon}" style="color: white; font-size: ${markerSize * 0.4}px;"></i></div>`,
                    iconSize: [markerSize, markerSize],
                    className: 'custom-div-icon'
                })
            });

            const popupContent = `
                <div>
                    <strong>${isFirst ? 'Inizio' : isLast ? 'Fine' : 'Posizione'}</strong><br>
                    <small>
                        Coordinate: ${position.latitude.toFixed(6)}, ${position.longitude.toFixed(6)}<br>
                        Velocità: ${(position.speed || 0).toFixed(1)} km/h<br>
                        Data: ${new Date(position.serverTime || position.deviceTime).toLocaleString()}
                    </small>
                </div>
            `;

            marker.bindPopup(popupContent);
            marker.addTo(markersLayer);
        });
    }

    fitMapToBounds();
}

function displayAllDevicesOnMap(deviceData) {
    markersLayer.clearLayers();
    pathLayer.clearLayers();

    const colors = ['#0d6efd', '#198754', '#dc3545', '#fd7e14', '#6f42c1', '#d63384', '#20c997', '#ffc107'];

    deviceData.forEach((data, deviceIndex) => {
        const { device, positions } = data;
        const color = colors[deviceIndex % colors.length];

        if (positions.length === 0) return;

        positions.sort((a, b) => new Date(a.serverTime || a.deviceTime) - new Date(b.serverTime || b.deviceTime));

        const showPath = document.getElementById('showPath').checked;
        const showMarkers = document.getElementById('showMarkers').checked;

        if (showPath && positions.length > 1) {
            const latlngs = positions.map(pos => [pos.latitude, pos.longitude]);
            const polyline = L.polyline(latlngs, {
                color: color,
                weight: 3,
                opacity: 0.8
            }).addTo(pathLayer);

            polyline.bindPopup(`<strong>${device.name}</strong><br>${positions.length} posizioni`);
        }

        if (showMarkers && positions.length > 0) {
            const lastPosition = positions[positions.length - 1];
            const markerSize = isMobileDevice ? 22 : 20;

            const marker = L.marker([lastPosition.latitude, lastPosition.longitude], {
                icon: L.divIcon({
                    html: `<div style="background: ${color}; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-size: ${markerSize * 0.5}px; font-weight: bold;">${deviceIndex + 1}</div>`,
                    iconSize: [markerSize, markerSize],
                    className: 'custom-div-icon'
                })
            });

            const popupContent = `
                <div>
                    <strong>${device.name}</strong><br>
                    <small>
                        ID: ${device.uniqueId}<br>
                        Coordinate: ${lastPosition.latitude.toFixed(6)}, ${lastPosition.longitude.toFixed(6)}<br>
                        Velocità: ${(lastPosition.speed || 0).toFixed(1)} km/h<br>
                        Ultima posizione: ${new Date(lastPosition.serverTime || lastPosition.deviceTime).toLocaleString()}<br>
                        Punti totali: ${positions.length}
                    </small>
                </div>
            `;

            marker.bindPopup(popupContent);
            marker.addTo(markersLayer);
        }
    });

    const allPositions = deviceData.flatMap(data => data.positions);
    calculateStatistics(allPositions);
    fitMapToBounds();
}

function calculateStatistics(positions) {
    if (positions.length === 0) {
        document.getElementById('totalDistance').textContent = '0 km';
        document.getElementById('avgSpeed').textContent = '0 km/h';
        document.getElementById('maxSpeed').textContent = '0 km/h';
        document.getElementById('totalTime').textContent = '0h 0m';
        return;
    }

    let totalDistance = 0;
    let maxSpeed = 0;
    let totalSpeed = 0;
    let speedCount = 0;

    positions.sort((a, b) => new Date(a.serverTime || a.deviceTime) - new Date(b.serverTime || b.deviceTime));

    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];

        if (pos.speed !== null && pos.speed !== undefined) {
            maxSpeed = Math.max(maxSpeed, pos.speed);
            totalSpeed += pos.speed;
            speedCount++;
        }

        if (i > 0) {
            const prevPos = positions[i - 1];
            const distance = calculateDistance(
                prevPos.latitude, prevPos.longitude,
                pos.latitude, pos.longitude
            );
            totalDistance += distance;
        }
    }

    const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 0;
    const startTime = new Date(positions[0].serverTime || positions[0].deviceTime);
    const endTime = new Date(positions[positions.length - 1].serverTime || positions[positions.length - 1].deviceTime);
    const totalTimeMs = endTime - startTime;
    const hours = Math.floor(totalTimeMs / (1000 * 60 * 60));
    const minutes = Math.floor((totalTimeMs % (1000 * 60 * 60)) / (1000 * 60));

    document.getElementById('totalDistance').textContent = `${totalDistance.toFixed(2)} km`;
    document.getElementById('avgSpeed').textContent = `${avgSpeed.toFixed(1)} km/h`;
    document.getElementById('maxSpeed').textContent = `${maxSpeed.toFixed(1)} km/h`;
    document.getElementById('totalTime').textContent = `${hours}h ${minutes}m`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function fitMapToBounds() {
    try {
        const allLayers = [];

        markersLayer.eachLayer(layer => allLayers.push(layer));
        pathLayer.eachLayer(layer => allLayers.push(layer));

        if (allLayers.length === 0) return;

        const group = new L.featureGroup(allLayers);
        const bounds = group.getBounds();

        if (bounds && bounds.isValid()) {
            const padding = isMobileDevice ? 0.15 : 0.1;
            map.fitBounds(bounds.pad(padding));
        }
    } catch (error) {
        console.error('Error fitting bounds:', error);
    }
}

function locateUser() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;

                map.setView([lat, lng], 16);

                const markerSize = isMobileDevice ? 20 : 18;

                L.marker([lat, lng], {
                    icon: L.divIcon({
                        html: `<div style="background: #0d6efd; width: ${markerSize}px; height: ${markerSize}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 8px rgba(13,110,253,0.5);"></div>`,
                        iconSize: [markerSize, markerSize],
                        className: 'custom-div-icon'
                    })
                }).addTo(markersLayer)
                  .bindPopup('La tua posizione')
                  .openPopup();

                showToast('Posizione rilevata', 'success');
            },
            function(error) {
                showToast('Errore nella geolocalizzazione: ' + error.message, 'error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000
            }
        );
    } else {
        showToast('Geolocalizzazione non supportata', 'error');
    }
}

function toggleAutoTracking() {
    autoTrackingEnabled = !autoTrackingEnabled;
    const autoRefreshCheckbox = document.getElementById('autoRefresh');

    if (autoTrackingEnabled) {
        document.body.classList.add('tracking-active');
        autoRefreshCheckbox.checked = true;
        startAutoRefresh();
        showToast('Auto-tracking attivato', 'success');
    } else {
        document.body.classList.remove('tracking-active');
        autoRefreshCheckbox.checked = false;
        stopAutoRefresh();
        showToast('Auto-tracking disattivato', 'info');
    }
}

function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    autoRefreshInterval = setInterval(() => {
        console.log('Auto-refreshing map...');

        if (document.getElementById('showAllDevices').checked) {
            updateMapAllDevices();
        } else {
            const deviceId = document.getElementById('deviceSelect').value;
            if (deviceId) {
                updateMap();
            }
        }
    }, 30000); // Aggiorna ogni 30 secondi
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function exportData() {
    if (currentData.length === 0) {
        showToast('Nessun dato da esportare. Carica prima i dati della mappa.', 'warning');
        return;
    }

    let csvContent = 'DateTime,DeviceId,Latitude,Longitude,Speed,Altitude,Accuracy\n';

    currentData.forEach(pos => {
        const deviceId = pos.deviceId || 'N/A';
        const dateTime = new Date(pos.serverTime || pos.deviceTime).toISOString();
        csvContent += `"${dateTime}",${deviceId},${pos.latitude},${pos.longitude},${pos.speed || 0},${pos.altitude || ''},${pos.accuracy || ''}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `positions_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Dati esportati con successo', 'success');
}

function toggleLayerControl() {
    if (window.layerControl._map) {
        map.removeControl(window.layerControl);
    } else {
        map.addControl(window.layerControl);
    }
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    overlay.style.display = show ? 'block' : 'none';
}

function showToast(message, type = 'info') {
    const toastContainer = document.querySelector('.toast-container');

    const toastId = 'toast_' + Date.now();

    // Su mobile, posiziona i toast più in basso per non sovrapporsi ai controlli
    let toastPosition = '';
    if (isMobileDevice) {
        toastPosition = 'style="margin-top: 60px;"';
    }

    const toastHtml = `
        <div class="toast" id="${toastId}" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="3000" ${toastPosition}>
            <div class="toast-header bg-${type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'primary'} text-white">
                <i class="fas fa-${type === 'error' ? 'exclamation-triangle' : type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'info-circle'} me-2"></i>
                <strong class="me-auto">${type === 'error' ? 'Errore' : type === 'success' ? 'Successo' : type === 'warning' ? 'Attenzione' : 'Info'}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast"></button>
            </div>
            <div class="toast-body">${message}</div>
        </div>
    `;

    toastContainer.insertAdjacentHTML('beforeend', toastHtml);

    const toastElement = document.getElementById(toastId);
    const toast = new bootstrap.Toast(toastElement);
    toast.show();

    // Rimuovi il toast dal DOM dopo che si nasconde
    toastElement.addEventListener('hidden.bs.toast', () => {
        toastElement.remove();
    });
}

// Auto-inizializzazione se arriva da un link diretto con parametri
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    const deviceParam = urlParams.get('device');

    if (deviceParam) {
        // Attendi che i dispositivi siano caricati
        setTimeout(() => {
            const deviceSelect = document.getElementById('deviceSelect');
            deviceSelect.value = deviceParam;
            updateMap();
        }, 1000);
    }
});

// Gestione eventi specifici per mobile
if (isMobileDevice) {
    // Prevent zoom on input focus (iOS)
    document.addEventListener('touchstart', function() {
        const inputs = document.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            if (input.style.fontSize !== '16px') {
                input.style.fontSize = '16px';
            }
        });
    });

    // Gestione del back button su Android
    window.addEventListener('popstate', function(event) {
        const panel = document.getElementById('controlsPanel');
        if (!panel.classList.contains('collapsed')) {
            event.preventDefault();
            toggleControlsPanel();
        }
    });

    // Gestione della visibilità della pagina per ottimizzare prestazioni
    document.addEventListener('visibilitychange', function() {
        if (document.hidden) {
            // Pausa auto-refresh quando la pagina non è visibile
            if (autoRefreshInterval) {
                clearInterval(autoRefreshInterval);
            }
        } else {
            // Riavvia auto-refresh quando la pagina torna visibile
            if (autoTrackingEnabled) {
                startAutoRefresh();
            }
            // Ridimensiona la mappa nel caso sia cambiata l'orientazione
            setTimeout(() => {
                if (map) {
                    map.invalidateSize();
                }
            }, 300);
        }
    });
}

// Utility function per gestire performance su dispositivi meno potenti
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

// Applica debounce ai resize events per migliorare performance
const debouncedResize = debounce(() => {
    detectDeviceType();
    handleResponsiveChanges();
    if (map) {
        map.invalidateSize();
    }
}, 250);

window.addEventListener('resize', debouncedResize);

// Gestione eventi touch avanzata per mobile
if (isMobileDevice) {
    let touchStartTime = 0;
    let touchStartY = 0;

    // Gestione dello swipe veloce per chiudere il pannello
    document.addEventListener('touchstart', function(e) {
        touchStartTime = Date.now();
        touchStartY = e.touches[0].clientY;
    });

    document.addEventListener('touchend', function(e) {
        const touchEndTime = Date.now();
        const touchEndY = e.changedTouches[0].clientY;
        const timeDiff = touchEndTime - touchStartTime;
        const yDiff = touchEndY - touchStartY;

        // Swipe rapido verso il basso (< 300ms, > 50px)
        if (timeDiff < 300 && yDiff > 50) {
            const panel = document.getElementById('controlsPanel');
            if (!panel.classList.contains('collapsed')) {
                const target = e.target;
                // Solo se il touch è iniziato sul pannello controlli
                if (panel.contains(target) && panel.scrollTop <= 10) {
                    toggleControlsPanel();
                }
            }
        }
    });
}

// Performance monitor per dispositivi meno potenti
class PerformanceMonitor {
    constructor() {
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        this.avgFPS = 60;
        this.isLowPerformance = false;
    }

    update() {
        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;
        this.lastFrameTime = now;

        this.frameCount++;

        if (this.frameCount % 60 === 0) { // Check every 60 frames
            const currentFPS = 1000 / deltaTime;
            this.avgFPS = (this.avgFPS + currentFPS) / 2;

            // Se FPS scende sotto 30, attiva modalità low performance
            if (this.avgFPS < 30 && !this.isLowPerformance) {
                this.enableLowPerformanceMode();
            } else if (this.avgFPS > 45 && this.isLowPerformance) {
                this.disableLowPerformanceMode();
            }
        }

        requestAnimationFrame(() => this.update());
    }

    enableLowPerformanceMode() {
        this.isLowPerformance = true;
        console.log('Low performance mode enabled');

        // Riduci animazioni
        document.body.classList.add('low-performance');

        // Riduci frequenza auto-refresh
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            if (autoTrackingEnabled) {
                autoRefreshInterval = setInterval(() => {
                    updateMapAction();
                }, 60000); // 60 secondi invece di 30
            }
        }
    }

    disableLowPerformanceMode() {
        this.isLowPerformance = false;
        console.log('Low performance mode disabled');

        document.body.classList.remove('low-performance');

        // Ripristina frequenza normale
        if (autoRefreshInterval) {
            clearInterval(autoRefreshInterval);
            if (autoTrackingEnabled) {
                startAutoRefresh(); // Torna a 30 secondi
            }
        }
    }
}

// Avvia il monitor delle performance su mobile
if (isMobileDevice) {
    const perfMonitor = new PerformanceMonitor();
    perfMonitor.update();
}

// Gestione memoria per prevenire memory leaks
window.addEventListener('beforeunload', function() {
    // Cleanup degli interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }

    // Cleanup dei layer della mappa
    if (map) {
        markersLayer.clearLayers();
        pathLayer.clearLayers();
        map.remove();
    }

    // Cleanup degli event listeners
    window.removeEventListener('resize', debouncedResize);
});

// Aggiunge CSS per low performance mode
const lowPerfStyle = document.createElement('style');
lowPerfStyle.textContent = `
    .low-performance * {
        transition-duration: 0.1s !important;
        animation-duration: 0.1s !important;
    }

    .low-performance .controls-panel {
        backdrop-filter: none !important;
        background: rgba(255, 255, 255, 0.98) !important;
    }

    .low-performance .floating-controls {
        backdrop-filter: none !important;
        background: rgba(255, 255, 255, 0.98) !important;
    }
`;
document.head.appendChild(lowPerfStyle);

// Export delle funzioni principali per debugging
window.MapDebug = {
    map,
    toggleControlsPanel,
    updateMap,
    updateMapAllDevices,
    detectDeviceType,
    isMobileDevice,
    isTabletDevice,
    autoTrackingEnabled,
    currentData,
    allDevices
};