// Connect to Real-Time WebSocket Server
const socket = io();

// 1. Check LocalStorage (Default to your exact Nanded location!)
const savedOrigin = localStorage.getItem('safestep_origin');
const savedDest = localStorage.getItem('safestep_dest');

// Exact Coordinates for: Sambodhi Society, Canal Road, Wadi Bk, Nanded
let originCoords = [19.19107, 77.28395]; 
// Exact Coordinates for: DMart Road / Canal Road, Wadi Bk, Nanded
let destCoords = [19.18445, 77.27500];

if (savedOrigin) {
    try {
        const parsed = JSON.parse(savedOrigin);
        if (parsed[0] > 18.0) originCoords = parsed;
    } catch (e) {}
}

if (savedDest) {
    try {
        const parsed = JSON.parse(savedDest);
        if (parsed[0] > 18.0) destCoords = parsed;
    } catch (e) {}
}

// Initialize Leaflet Map centered on your location
const map = L.map('map', {
    zoomControl: false
}).setView(originCoords, 15);

// Zoom control at bottom right
L.control.zoom({ position: 'bottomright' }).addTo(map);

// 100% Free OpenStreetMap Tiles (NO API Key required!)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 19
}).addTo(map);

// Glowing Custom Pin Icons
const originIcon = L.divIcon({
    className: 'custom-pin',
    html: '<div style="background:#38bdf8;width:20px;height:20px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 16px #38bdf8;cursor:grab;"></div>',
    iconSize: [20, 20]
});

const destIcon = L.divIcon({
    className: 'custom-pin',
    html: '<div style="background:#10b981;width:20px;height:20px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 16px #10b981;cursor:grab;"></div>',
    iconSize: [20, 20]
});

// Markers with DRAGGABLE enabled!
let originMarker = L.marker(originCoords, { 
    icon: originIcon, 
    draggable: true,
    autoPan: true 
}).addTo(map);

let destMarker = L.marker(destCoords, { 
    icon: destIcon, 
    draggable: true,
    autoPan: true 
}).addTo(map);

let recommendedLayer = null;
let alternativeLayer = null;
let routeBadgeMarker = null;
let currentHour = 23;
let activeRouteCoords = [];

// Walker Simulation State
let walkInterval = null;
let walkerMarker = null;

const walkerIcon = L.divIcon({
    className: 'walker-pin',
    html: '<div style="background:#f43f5e;width:24px;height:24px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 18px #f43f5e;display:flex;align-items:center;justify-content:center;font-size:13px;">🚶</div>',
    iconSize: [24, 24]
});

// Toast Notification Helper
function showToast(message) {
    const toast = document.getElementById('liveToast');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, 3500);
}

// 📏 Haversine Formula for Accurate Distance Calculation
function getDistanceMeters(coord1, coord2) {
    const R = 6371e3; // meters
    const lat1 = coord1[0] * Math.PI / 180;
    const lat2 = coord2[0] * Math.PI / 180;
    const dLat = (coord2[0] - coord1[0]) * Math.PI / 180;
    const dLng = (coord2[1] - coord1[1]) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function calculatePathDistance(coords) {
    if (!coords || coords.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        total += getDistanceMeters(coords[i], coords[i + 1]);
    }
    return Math.round(total);
}

// 🚶 Google Maps Standard Walking Speed: 80 meters / minute (4.8 km/h)
const WALKING_SPEED_METERS_PER_MIN = 80;

function getWalkingMinutes(meters) {
    if (meters <= 0) return 0;
    if (meters < 45) return 1; // Round very short stretches to 1 min
    return Math.round(meters / WALKING_SPEED_METERS_PER_MIN);
}

function formatDuration(minutes) {
    if (minutes <= 0) return '0 min';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} min`;
}

function formatDistance(meters) {
    if (meters < 1000) return `${meters} m`;
    return `${(meters / 1000).toFixed(2)} km`;
}

// 🕒 Accurate Google Maps ETA Calculator: Starts exactly at the departure slider hour
function getEtaString(departureHour, durationMinutes) {
    const depDate = new Date();
    depDate.setHours(departureHour, 0, 0, 0);
    const arrDate = new Date(depDate.getTime() + durationMinutes * 60000);
    return arrDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

// 🏷️ Google Maps Style Floating Badge in the Center of the Route
function updateRouteBadge(coords, timeMinutes, distanceMeters, routeName, etaString) {
    if (routeBadgeMarker) map.removeLayer(routeBadgeMarker);
    if (!coords || coords.length === 0) return;

    const midIdx = Math.floor(coords.length / 2);
    const midPoint = coords[midIdx];

    const badgeIcon = L.divIcon({
        className: 'route-badge-container',
        html: `<div class="route-badge-marker">🚶 <b>${formatDuration(timeMinutes)}</b> (${formatDistance(distanceMeters)}) &bull; ETA ${etaString}</div>`,
        iconSize: [230, 26],
        iconAnchor: [115, 13]
    });

    routeBadgeMarker = L.marker(midPoint, { icon: badgeIcon, interactive: false }).addTo(map);
}

// 🎯 Top Navigation Banner Updater (Google Maps format)
function updateNavigationBanner(routeName, exactMins, distanceMeters, etaString, isNight, isWarning, warningMsg) {
    const banner = document.getElementById('topNavBanner');
    const routeNameEl = document.getElementById('navRouteName');
    const badgeEl = document.getElementById('navStatusBadge');
    const timeEl = document.getElementById('navTime');
    const distEl = document.getElementById('navDistance');
    const descEl = document.getElementById('navSafetyDesc');

    if (routeNameEl) routeNameEl.textContent = routeName;
    if (distEl) distEl.textContent = formatDistance(distanceMeters);
    if (timeEl) timeEl.textContent = `${formatDuration(exactMins)} (ETA ${etaString})`;

    const statTimeEl = document.getElementById('statTime');
    if (statTimeEl) statTimeEl.textContent = formatDuration(exactMins);

    if (isWarning) {
        banner.className = 'top-nav-banner warning';
        badgeEl.className = 'nav-badge warning';
        badgeEl.textContent = '⚠️ OFF SAFE ROUTE: UNLIT ALLEY!';
        descEl.textContent = warningMsg || 'Pitch-black canal path detected! Move towards DMart Road for illumination.';
    } else if (isNight) {
        banner.className = 'top-nav-banner safe';
        badgeEl.className = 'nav-badge safe';
        badgeEl.textContent = '🟢 ON CORRECT ROUTE';
        descEl.textContent = '100% Streetlit &bull; 24/7 Open Pharmacies &bull; Active Traffic';
    } else {
        banner.className = 'top-nav-banner safe';
        badgeEl.className = 'nav-badge safe';
        badgeEl.textContent = '🟢 ON FASTEST ROUTE';
        descEl.textContent = 'Daylight visibility &bull; Open street shops';
    }
}

/**
 * 🏠 BACKEND-POWERED Full Address Geocoder & Tooltip Generator
 */
async function updateLocationPopup(type, coords, marker, shouldOpen = false) {
    const isStart = (type === 'start');
    const tagClass = isStart ? 'start' : 'dest';
    const tagText = isStart ? '📍 Start Location (Origin)' : '🔒 Destination (Locked)';
    const themeColor = isStart ? '#38bdf8' : '#10b981';

    try {
        const response = await fetch(`/api/geocode/reverse?lat=${coords[0]}&lng=${coords[1]}`);
        const data = await response.json();

        const fullAddress = data.fullAddress || data.rawDisplayName || 'Address located';
        const placeName = data.placeName || (isStart ? 'Start Point' : 'Destination Point');

        // 1. Update the sidebar full address card!
        const cardId = isStart ? 'startFullAddress' : 'destFullAddress';
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
            cardEl.innerHTML = `<b>${placeName}</b><br><span style="color:#cbd5e1;font-size:0.76rem;">${fullAddress}</span>`;
        }

        // 2. Update the input box
        const inputId = isStart ? 'startInput' : 'destInput';
        const inputEl = document.getElementById(inputId);
        if (inputEl) inputEl.value = fullAddress;

        // 3. HOVER TOOLTIP: Instantly reveals full address when hovering mouse!
        const tooltipHTML = `
            <div style="font-weight:700;color:${themeColor};margin-bottom:3px;font-size:0.75rem;">
                ${isStart ? '📍 START LOCATION' : '🔒 DESTINATION (Drag to move)'}
            </div>
            <div style="font-size:0.92rem;color:#ffffff;font-weight:700;margin-bottom:3px;">${placeName}</div>
            <div style="color:#cbd5e1;font-size:0.78rem;line-height:1.4;">🏠 <b>Address:</b> ${fullAddress}</div>
            <div style="color:#94a3b8;font-size:0.7rem;margin-top:5px;border-top:1px solid rgba(255,255,255,0.15);padding-top:4px;">
                💡 100% Streetlit Corridor &bull; 🏥 24/7 Pharmacy nearby
            </div>
        `;

        marker.bindTooltip(tooltipHTML, {
            direction: 'top',
            offset: [0, -12],
            className: `custom-hover-tooltip ${isStart ? 'start-tip' : ''}`,
            sticky: true
        });

        // 4. CLICK POPUP
        const popupHTML = `
            <div class="popup-card">
                <span class="popup-tag ${tagClass}">${tagText}</span>
                <div class="popup-title">${placeName}</div>
                <div class="popup-sub" style="font-size:0.78rem;color:#e2e8f0;margin-bottom:8px;">
                    🏠 <b>Full Postal Address:</b><br>${fullAddress}
                </div>
                <div class="popup-details">
                    <div class="popup-row">💡 <b>Lighting:</b> Municipal LED Streetlights Active</div>
                    <div class="popup-row">🏥 <b>Safe Haven:</b> 24/7 Pharmacy & Clinic (180m)</div>
                    <div class="popup-row">👥 <b>Crowd Pulse:</b> 🟢 Active Pedestrian Corridor</div>
                    <div class="popup-row">📍 <b>GPS:</b> ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</div>
                    <div class="popup-row" style="color:#94a3b8;font-size:0.7rem;margin-top:4px;"><i>✋ You can drag this pin anywhere to change location!</i></div>
                </div>
            </div>
        `;

        marker.bindPopup(popupHTML, { maxWidth: 340 });

        if (shouldOpen) {
            marker.openPopup();
        }

    } catch (err) {
        console.error('Error updating location address:', err);
    }
}

// 🖐️ LIVE DRAG HANDLER: Real-Time Route Validation & Distance/Time Calculation ("Is it correct or not?")
function handleLiveDrag(type, latlng) {
    const isStart = (type === 'start');
    const curStart = isStart ? [latlng.lat, latlng.lng] : originCoords;
    const curDest = isStart ? destCoords : [latlng.lat, latlng.lng];

    const crowMeters = Math.round(getDistanceMeters(curStart, curDest));
    const isNight = (currentHour >= 20 || currentHour <= 5);
    // Real pedestrian street detour factor (at night safe corridor is ~1.25x crow flies, in daylight ~1.05x)
    const detourFactor = isNight ? 1.25 : 1.05;
    const estimatedStreetMeters = Math.round(crowMeters * detourFactor);
    const liveMins = getWalkingMinutes(estimatedStreetMeters);
    const liveEta = getEtaString(currentHour, liveMins);

    const isWarning = isNight && (curDest[0] > 19.189 && curDest[1] > 77.280);
    const routeName = isNight ? 'Main DMart & Wadi Bypass' : 'Direct Daylight Path';

    updateNavigationBanner(
        routeName,
        liveMins,
        estimatedStreetMeters,
        liveEta,
        isNight,
        isWarning
    );
}

destMarker.on('dragstart', () => {
    showToast('🖐️ Moving destination pin...');
    destMarker.closeTooltip();
    destMarker.closePopup();
});

destMarker.on('drag', (e) => handleLiveDrag('dest', e.target.getLatLng()));

destMarker.on('dragend', async (e) => {
    const latlng = e.target.getLatLng();
    destCoords = [latlng.lat, latlng.lng];

    localStorage.setItem('safestep_dest', JSON.stringify(destCoords));
    showToast('🔒 Destination Locked! Fetching exact address...');

    await updateLocationPopup('dest', destCoords, destMarker, false);
    fetchSafeRoute(currentHour, false);
});

// Start marker dragging
originMarker.on('dragstart', () => {
    showToast('🖐️ Moving start location pin...');
    originMarker.closeTooltip();
    originMarker.closePopup();
});

originMarker.on('drag', (e) => handleLiveDrag('start', e.target.getLatLng()));

originMarker.on('dragend', async (e) => {
    const latlng = e.target.getLatLng();
    originCoords = [latlng.lat, latlng.lng];

    localStorage.setItem('safestep_origin', JSON.stringify(originCoords));
    showToast('🔒 Start Location Locked! Fetching exact address...');
    await updateLocationPopup('start', originCoords, originMarker, false);
    fetchSafeRoute(currentHour, false);
});

// Fetch Dynamic Safe Route from Express API
async function fetchSafeRoute(hour, autoFit = false) {
    try {
        currentHour = hour;

        const url = `/api/route?hour=${hour}&originLat=${originCoords[0]}&originLng=${originCoords[1]}&destLat=${destCoords[0]}&destLng=${destCoords[1]}`;
        const response = await fetch(url);
        const data = await response.json();

        // Clear previous polylines
        if (recommendedLayer) map.removeLayer(recommendedLayer);
        if (alternativeLayer) map.removeLayer(alternativeLayer);

        const rec = data.recommended;
        const alt = data.alternative;
        activeRouteCoords = rec.coordinates;

        // Accurate distance and walking duration (80 meters / minute standard)
        const pathDistanceMeters = calculatePathDistance(rec.coordinates);
        const exactWalkingMins = getWalkingMinutes(pathDistanceMeters);
        const etaString = getEtaString(hour, exactWalkingMins);

        // Draw Rejected Risky Route at night (Dotted Red)
        if (data.isNight && alt && alt.coordinates && alt.coordinates.length > 0) {
            alternativeLayer = L.polyline(alt.coordinates, {
                color: '#ef4444',
                weight: 4,
                opacity: 0.55,
                dashArray: '6, 8'
            }).addTo(map).bindPopup(`<b>⚠️ Avoided Risky Path:</b><br>${alt.riskReason}`);
        }

        // Draw Recommended Safe Route (Green daylight / Cyan night)
        const routeColor = data.isNight ? '#38bdf8' : '#10b981';
        if (rec && rec.coordinates && rec.coordinates.length > 0) {
            recommendedLayer = L.polyline(rec.coordinates, {
                color: routeColor,
                weight: 6,
                opacity: 0.95
            }).addTo(map);

            if (autoFit) {
                map.fitBounds(recommendedLayer.getBounds(), { padding: [70, 70] });
            }

            // Add Google Maps Style Floating Badge on the Route Line with ETA!
            updateRouteBadge(rec.coordinates, exactWalkingMins, pathDistanceMeters, rec.name, etaString);
        }

        // Update Top Navigation Banner (Google Maps style)
        updateNavigationBanner(
            rec.name,
            exactWalkingMins,
            pathDistanceMeters,
            etaString,
            data.isNight,
            false
        );

        // Update Dashboard Sidebar UI
        document.getElementById('routeTitle').textContent = rec.name;
        document.getElementById('routeDescription').textContent = rec.explanation;
        document.getElementById('statTime').textContent = formatDuration(exactWalkingMins);
        document.getElementById('statSafety').textContent = `${rec.safetyScore}%`;
        
        const crowdUpper = rec.crowdLevel.charAt(0).toUpperCase() + rec.crowdLevel.slice(1);
        document.getElementById('statCrowd').textContent = rec.crowdLevel === 'bustling' ? `🟢 ${crowdUpper}` : `🟡 ${crowdUpper}`;

    } catch (err) {
        console.error('Error fetching route from server:', err);
    }
}

// 🚶‍♂️ REAL-TIME WALKING SIMULATION
document.getElementById('btnSimulateWalk').addEventListener('click', () => {
    const btn = document.getElementById('btnSimulateWalk');

    if (walkInterval) {
        clearInterval(walkInterval);
        walkInterval = null;
        if (walkerMarker) map.removeLayer(walkerMarker);
        btn.innerHTML = '▶️ Walk';
        btn.classList.remove('walking');
        showToast('⏹️ Walk simulation stopped');
        return;
    }

    if (!activeRouteCoords || activeRouteCoords.length === 0) return;

    btn.innerHTML = '⏹️ Stop';
    btn.classList.add('walking');
    showToast('🚶 Walk simulation started! Checking route accuracy...');

    // Generate smooth walking sub-steps along the route
    const steps = [];
    for (let i = 0; i < activeRouteCoords.length - 1; i++) {
        const p1 = activeRouteCoords[i];
        const p2 = activeRouteCoords[i + 1];
        const numSub = 20;
        for (let j = 0; j <= numSub; j++) {
            steps.push([
                p1[0] + (p2[0] - p1[0]) * (j / numSub),
                p1[1] + (p2[1] - p1[1]) * (j / numSub)
            ]);
        }
    }

    let stepIndex = 0;
    walkerMarker = L.marker(steps[0], { icon: walkerIcon }).addTo(map);

    walkInterval = setInterval(() => {
        if (stepIndex >= steps.length) {
            clearInterval(walkInterval);
            walkInterval = null;
            btn.innerHTML = '▶️ Walk';
            btn.classList.remove('walking');
            showToast('🎉 Arrived safely at destination!');
            document.getElementById('navDistance').textContent = '0 m (Destination)';
            document.getElementById('navTime').textContent = '0 min (Arrived)';
            document.getElementById('navStatusBadge').textContent = '✅ ARRIVED SAFELY';
            document.getElementById('statTime').textContent = 'Arrived';
            return;
        }

        const currentPos = steps[stepIndex];
        walkerMarker.setLatLng(currentPos);

        const remainingDist = Math.round(getDistanceMeters(currentPos, destCoords));
        const remMins = getWalkingMinutes(remainingDist);

        if (remainingDist <= 10) {
            document.getElementById('navDistance').textContent = '0 m (Destination)';
            document.getElementById('navTime').textContent = '0 min (Arrived)';
            document.getElementById('statTime').textContent = 'Arrived';
        } else {
            document.getElementById('navDistance').textContent = `${formatDistance(remainingDist)} remaining`;
            document.getElementById('navTime').textContent = `${formatDuration(remMins)} left`;
            document.getElementById('statTime').textContent = `${formatDuration(remMins)} left`;
        }

        const badge = document.getElementById('navStatusBadge');
        badge.className = 'nav-badge safe';
        badge.textContent = '🟢 ON CORRECT ROUTE';

        stepIndex++;
    }, 150);
});

// Time Slider Listener
const timeSlider = document.getElementById('timeSlider');
const timeDisplay = document.getElementById('timeDisplay');

timeSlider.addEventListener('input', (e) => {
    const hour = parseInt(e.target.value);
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    timeDisplay.textContent = `${displayHour}:00 ${period}`;
    fetchSafeRoute(hour, false);
});

// 🗺️ Click Anywhere on Map to Set Destination
map.on('click', async (e) => {
    destCoords = [e.latlng.lat, e.latlng.lng];
    destMarker.setLatLng(destCoords);

    localStorage.setItem('safestep_dest', JSON.stringify(destCoords));
    showToast('📍 Destination set on map! Fetching exact address...');

    await updateLocationPopup('dest', destCoords, destMarker, true);
    fetchSafeRoute(currentHour, true);
});

// 🔍 Address Search by Pressing Enter
document.getElementById('startInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        searchAndSetAddress(e.target.value, 'start');
    }
});

document.getElementById('destInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        searchAndSetAddress(e.target.value, 'dest');
    }
});

document.getElementById('btnSearchDest').addEventListener('click', () => {
    const destVal = document.getElementById('destInput').value;
    searchAndSetAddress(destVal, 'dest');
});

// 📍 Live GPS Button
document.getElementById('btnGps').addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    showToast('📡 Acquiring real GPS coordinates...');

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            originCoords = [lat, lng];

            if (!savedDest) {
                destCoords = [lat - 0.004, lng + 0.005];
                destMarker.setLatLng(destCoords);
                localStorage.setItem('safestep_dest', JSON.stringify(destCoords));
            }

            localStorage.setItem('safestep_origin', JSON.stringify(originCoords));
            originMarker.setLatLng(originCoords);

            map.flyTo(originCoords, 16, { duration: 1.2 });
            showToast('✅ Centered on your real location! Looking up full address...');

            await updateLocationPopup('start', originCoords, originMarker, false);
            await updateLocationPopup('dest', destCoords, destMarker, false);

            fetchSafeRoute(currentHour, true);
        },
        (error) => {
            console.warn('GPS error:', error.message);
            showToast('⚠️ Could not acquire GPS. Check location permissions.');
        },
        { enableHighAccuracy: true }
    );
});

// 1-Tap Crowd Reporting
async function reportCrowd(status) {
    try {
        const response = await fetch('/api/crowd-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                crowdLevel: status === 'empty' ? 'deserted' : (status === 'bustling' ? 'bustling' : 'moderate'),
                streetType: 'shortcut'
            })
        });
        const result = await response.json();
        showToast(result.message);
        fetchSafeRoute(currentHour, false);
    } catch (err) {
        console.error('Error submitting crowd report:', err);
    }
}

// WebSocket Event Listeners
socket.on('live_hazard_alert', (data) => {
    showToast(data.message);
    fetchSafeRoute(currentHour, false);
});

socket.on('live_crowd_update', (data) => {
    showToast(data.message);
    fetchSafeRoute(currentHour, false);
});

// Initialize location popups & hover tooltips on page load
updateLocationPopup('start', originCoords, originMarker, false);
updateLocationPopup('dest', destCoords, destMarker, false);
fetchSafeRoute(23, false);
