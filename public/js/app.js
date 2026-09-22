/**
 * 🛡️ SafeStep Main Coordinator Application (app.js)
 * Coordinates Leaflet mapping, road routing, navigation HUD,
 * illumination underlay, route safety milestones, guardian sentinel,
 * realtime Socket.IO reports, and truthful safety data rendering.
 */

// Socket.IO Client Connection
const socket = (typeof io === 'function') ? io() : null;
window.socket = socket;

// Global Toast Helper
window.showToast = function(message) {
    const toast = document.getElementById('liveToast');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.remove('hidden');

    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => {
        toast.classList.add('hidden');
    }, 4500);
};

class SafeStepApp {
    constructor() {
        // Default coordinates: Mumbai corridor (Goregaon Mulund Link Road to Guru Gobind Singh Marg)
        this.originCoords = [19.16730, 72.93920];
        this.destCoords = [19.17640, 72.94630];
        this.userLocation = [...this.originCoords];

        this.currentHour = 23; // Default 11 PM
        this.isDemoMode = false;
        this.demoInterval = null;
        this.hasManualOrigin = false;
        this.originPlaceName = '';
        this.destPlaceName = '';
        this.bestAccuracy = null;
        this.hasAcquiredGPS = false;

        // Leaflet layers
        this.map = null;
        this.originMarker = null;
        this.destMarker = null;
        this.userMarker = null;
        this.routeLayers = {};
        this.routeBadgeMarker = null;

        this.init();
    }

    /**
     * Request real user location on initial load with a fast timeout (3.5s).
     * Falls back to null if denied, unavailable, or timed out.
     */
    acquireInitialPosition(timeoutMs = 3500) {
        if (!navigator.geolocation) return Promise.resolve(null);
        return new Promise((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve(null);
                }
            }, timeoutMs);

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve([pos.coords.latitude, pos.coords.longitude]);
                    }
                },
                (err) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(null);
                    }
                },
                { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 }
            );
        });
    }

    async init() {
        this.loadSavedLocations();

        // 1. Request real GPS location on load as default map center & route origin
        try {
            const initialPos = await this.acquireInitialPosition(3500);
            if (initialPos) {
                this.originCoords = initialPos;
                this.userLocation = [...initialPos];
                this.hasAcquiredGPS = true;

                // Adjust destination near origin if user hasn't set a custom destination
                const savedDest = localStorage.getItem('safestep_dest');
                const isDefaultOldDest = !savedDest || (Math.abs(this.destCoords[0] - 19.18445) < 0.05 && Math.abs(this.destCoords[1] - 77.27500) < 0.05);
                const isFar = (typeof getDistanceMeters === 'function') && getDistanceMeters(initialPos, this.destCoords) > 5000;
                if (isDefaultOldDest || isFar) {
                    this.destCoords = [initialPos[0] + 0.004, initialPos[1] + 0.004];
                }
                localStorage.setItem('safestep_origin', JSON.stringify(this.originCoords));
                localStorage.setItem('safestep_dest', JSON.stringify(this.destCoords));
                console.log('[SafeStep Init] Map initialized with real user GPS coordinates:', initialPos);
            }
        } catch (err) {
            console.warn('[SafeStep Init] Initial GPS acquisition skipped, falling back to demo coords:', err);
        }

        this.initMap();
        this.initEventListeners();
        this.setupSocketListeners();

        // 2. Start GPS watch early so location acquisition runs continuously
        this.startGPSWatcher();

        try {
            // 2. Load Safety Data (POIs and active reports)
            await window.safetyManager.loadSafetyData(this.map);
        } catch (err) {
            console.warn('[SafeStep Init] Safety data load fallback:', err);
        }

        try {
            // 3. Reverse geocode default start & destination
            await this.updateAddressCard('start', this.originCoords, this.originMarker);
            await this.updateAddressCard('dest', this.destCoords, this.destMarker);
        } catch (err) {
            console.warn('[SafeStep Init] Geocoding reverse fallback:', err);
        }

        try {
            // 4. Calculate initial road routes and render illumination underlay & milestones
            await this.calculateRoadRoutes(false);
        } catch (err) {
            console.warn('[SafeStep Init] Road route calculation fallback:', err);
        }

        // 5. Check anonymous presence (truthful: hides if < 5)
        this.checkPresence();

        // 6. Check user auth status & handle deep links (e.g. /login or ?login=1)
        this.checkAuthState();
        this.checkLoginDeepLink();

        // 7. Dismiss loading splash screen (under 1.5s)
        this.hideLoadingSplash();
    }

    checkLoginDeepLink() {
        const urlParams = new URLSearchParams(window.location.search);
        const hasLoginParam = urlParams.get('login') !== null;
        const isLoginPath = window.location.pathname === '/login';
        const serverFlag = (typeof window.autoOpenAuth !== 'undefined' && window.autoOpenAuth === true) ||
                           (document.body && document.body.dataset && document.body.dataset.autoOpenAuth === 'true');

        if (hasLoginParam || isLoginPath || serverFlag) {
            this.openAuthModal();
            if (isLoginPath) {
                // Keep URL clean in address bar
                try {
                    window.history.replaceState({}, document.title, '/');
                } catch (e) {}
            }
        }
    }

    hideLoadingSplash() {
        const splash = document.getElementById('appLoadingSplash');
        if (splash) {
            splash.classList.add('fade-out');
            setTimeout(() => {
                try { splash.remove(); } catch (e) {}
            }, 400);
        }
    }

    setupSocketListeners() {
        if (!window.socket) return;

        // 31, 43. Two-Browser Realtime Safety Update Handling
        window.socket.on('safety_report_broadcast', (report) => {
            console.log('📢 Realtime safety alert received via WebSocket:', report);
            const activeRoute = window.routingEngine ? window.routingEngine.activeRoute : null;

            if (activeRoute && activeRoute.coordinates && report && report.coordinates) {
                const distToRoute = getDistanceFromRoute(report.coordinates, activeRoute.coordinates);

                // If condition is within 250m of user's active route:
                if (distToRoute <= 250) {
                    window.showToast(`⚠️ Realtime safety alert on your route: ${report.title}`);
                    if (window.voiceNavigator) {
                        window.voiceNavigator.announceSafetyAlert(`Notice: ${report.title}`);
                    }

                    // Reload safety data and re-evaluate routes
                    window.safetyManager.loadSafetyData(this.map).then(() => {
                        this.calculateRoadRoutes(false);
                    });
                } else {
                    // Silently register report without interrupting user
                    if (window.safetyManager && window.safetyManager.activeReports) {
                        window.safetyManager.activeReports.push(report);
                    }
                }
            }
        });

        // 🔒 Private Guardian Room Listeners (Stalker Defense)
        const urlParams = new URLSearchParams(window.location.search);
        const trackToken = urlParams.get('track');
        if (trackToken && trackToken.startsWith('trip_')) {
            window.socket.emit('join_trip_room', { tripToken: trackToken });
            window.showToast('🛡️ Connected to Private Guardian Tracking Room.');

            window.socket.on('live_trip_update', (data) => {
                window.showToast(`📍 Walker Update: ${data.status.toUpperCase()} on ${data.routeName} (ETA: ${data.eta || 'Calculating'})`);
            });

            window.socket.on('emergency_sos_broadcast', (data) => {
                window.showToast(`🚨 URGENT: Pedestrian triggered Emergency SOS in this trip!`);
                if (window.voiceNavigator) {
                    window.voiceNavigator.speak('Emergency alert received for tracked pedestrian!', true);
                }
            });
        }
    }

    async checkPresence() {
        const presenceEl = document.getElementById('crowdPresenceIndicator');
        if (!presenceEl) return;

        try {
            const res = await fetch('/api/presence');
            const data = await res.json();
            // Requirement 5: Only expose aggregated presence when count >= 5
            if (data.available && data.activeUsers >= 5) {
                presenceEl.style.display = 'flex';
                presenceEl.textContent = `👥 ${data.activeUsers} active SafeStep users nearby`;
            } else {
                presenceEl.style.display = 'none';
            }
        } catch (e) {
            presenceEl.style.display = 'none';
        }
    }

    loadSavedLocations() {
        const savedOrigin = localStorage.getItem('safestep_origin');
        const savedDest = localStorage.getItem('safestep_dest');

        if (savedOrigin) {
            try {
                const p = JSON.parse(savedOrigin);
                const isOldNanded = (Math.abs(p[0] - 19.19107) < 0.05 && Math.abs(p[1] - 77.28395) < 0.05);
                if (Array.isArray(p) && p[0] > 10.0 && !isOldNanded) {
                    this.originCoords = p;
                    this.hasManualOrigin = true;
                }
            } catch (e) {}
        }

        if (savedDest) {
            try {
                const p = JSON.parse(savedDest);
                const isOldNanded = (Math.abs(p[0] - 19.18445) < 0.05 && Math.abs(p[1] - 77.27500) < 0.05);
                if (Array.isArray(p) && p[0] > 10.0 && !isOldNanded) {
                    this.destCoords = p;
                }
            } catch (e) {}
        }
    }

    initMap() {
        this.map = L.map('map', { zoomControl: false }).setView(this.originCoords, 15);

        L.control.zoom({ position: 'bottomright' }).addTo(this.map);

        // OpenStreetMap Free Cartography Tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors',
            subdomains: ['a', 'b', 'c'],
            maxZoom: 19
        }).addTo(this.map);

        const originIcon = L.divIcon({
            className: 'custom-pin origin-pin',
            html: '<div style="background:#38bdf8;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 14px #38bdf8;cursor:grab;display:flex;align-items:center;justify-content:center;font-size:11px;">📍</div>',
            iconSize: [22, 22]
        });

        const destIcon = L.divIcon({
            className: 'custom-pin dest-pin',
            html: '<div style="background:#10b981;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 14px #10b981;cursor:grab;display:flex;align-items:center;justify-content:center;font-size:11px;">🏁</div>',
            iconSize: [22, 22]
        });

        const userIcon = L.divIcon({
            className: 'user-gps-pin',
            html: '<div class="user-pulse-ring"></div><div class="user-center-dot">🚶</div>',
            iconSize: [26, 26]
        });

        this.originMarker = L.marker(this.originCoords, { icon: originIcon, draggable: true, autoPan: true }).addTo(this.map);
        this.destMarker = L.marker(this.destCoords, { icon: destIcon, draggable: true, autoPan: true }).addTo(this.map);
        this.userMarker = L.marker(this.originCoords, { icon: userIcon }).addTo(this.map);

        // Marker drag listeners
        this.originMarker.on('dragend', async (e) => {
            const latlng = e.target.getLatLng();
            this.originCoords = [latlng.lat, latlng.lng];
            this.userLocation = [latlng.lat, latlng.lng];
            this.hasManualOrigin = true;
            if (this.userMarker) this.userMarker.setLatLng(this.originCoords);
            localStorage.setItem('safestep_origin', JSON.stringify(this.originCoords));
            window.showToast('📍 Start point updated.');
            await this.updateAddressCard('start', this.originCoords, this.originMarker);
            await this.calculateRoadRoutes(false);
        });

        this.destMarker.on('dragend', async (e) => {
            const latlng = e.target.getLatLng();
            this.destCoords = [latlng.lat, latlng.lng];
            localStorage.setItem('safestep_dest', JSON.stringify(this.destCoords));
            window.showToast('🏁 Destination updated.');
            await this.updateAddressCard('dest', this.destCoords, this.destMarker);
            await this.calculateRoadRoutes(false);
        });

        // Click map to set destination
        this.map.on('click', async (e) => {
            if (window.navigationManager.isNavigating) return;
            this.destCoords = [e.latlng.lat, e.latlng.lng];
            this.destMarker.setLatLng(this.destCoords);
            localStorage.setItem('safestep_dest', JSON.stringify(this.destCoords));
            window.showToast('📍 Destination pinned on map.');
            await this.updateAddressCard('dest', this.destCoords, this.destMarker);
            await this.calculateRoadRoutes(false);
        });
    }

    async updateAddressCard(type, coords, marker) {
        const isStart = (type === 'start');
        try {
            const res = await fetch(`/api/geocode/reverse?lat=${coords[0]}&lng=${coords[1]}`);
            const data = await res.json();

            const fullAddr = data.fullAddress || `${coords[0].toFixed(4)}, ${coords[1].toFixed(4)}`;
            const placeName = data.placeName || (isStart ? 'Start Point' : 'Destination Point');

            if (isStart) {
                this.originPlaceName = placeName;
                this.originAddress = fullAddr;
            } else {
                this.destPlaceName = placeName;
                this.destAddress = fullAddr;
            }

            const cardId = isStart ? 'startFullAddress' : 'destFullAddress';
            const cardEl = document.getElementById(cardId);
            if (cardEl) {
                cardEl.innerHTML = `<b>${placeName}</b><br><span style="color:#cbd5e1;font-size:0.75rem;">${fullAddr}</span>`;
            }

            const inputId = isStart ? 'startInput' : 'destInput';
            const inputEl = document.getElementById(inputId);
            if (inputEl) inputEl.value = fullAddr;

            const tipColor = isStart ? '#38bdf8' : '#10b981';
            const tipText = `
                <div style="font-weight:700;color:${tipColor};font-size:0.75rem;">${isStart ? '📍 START' : '🏁 DESTINATION'}</div>
                <div style="font-size:0.9rem;font-weight:700;color:#fff;">${placeName}</div>
                <div style="font-size:0.75rem;color:#cbd5e1;">${fullAddr}</div>
            `;
            marker.bindTooltip(tipText, { direction: 'top', offset: [0, -12], sticky: true });
        } catch (e) {
            console.error('Reverse geocode error:', e);
        }
    }

    async calculateRoadRoutes(autoFit = false) {
        try {
            const destName = this.destPlaceName || '';
            const originName = this.originPlaceName || '';
            const data = await window.routingEngine.fetchRoadRoutes(this.originCoords, this.destCoords, this.currentHour, destName, originName);
            const routes = data.routes;
            const activeRoute = data.activeRoute;

            // 1. Render Polylines
            this.renderRoutePolylines(routes, activeRoute, autoFit);

            // 2. Render Illumination Corridor Underlay (Requirement 1)
            window.safetyManager.renderIlluminationUnderlay(this.map, activeRoute);

            // 3. Render Route Safety Milestones & Refresh Route-Adjacent POI Markers
            window.safetyManager.renderRouteMilestones(this.map, activeRoute);
            window.safetyManager.renderPOIMarkers(this.map);

            // 4. Update Pre-Trip Safety Audit (Requirement 6, 7, 8, 9, 10)
            window.safetyManager.updatePreTripSafetyAudit(activeRoute);

            // 5. Update Comparison Cards & Top Banner
            this.renderRouteComparisonCards(routes, activeRoute);
            this.updateTopNavigationBanner(activeRoute);

            // 6. Update Sidebar Stats
            const titleEl = document.getElementById('routeTitle');
            const descEl = document.getElementById('routeDescription');
            const timeEl = document.getElementById('statTime');
            const safetyEl = document.getElementById('statSafety');
            const havenEl = document.getElementById('statHavenCount');

            if (titleEl) titleEl.textContent = activeRoute.name;
            if (descEl) descEl.textContent = activeRoute.safetyDesc;
            if (timeEl) timeEl.textContent = activeRoute.formattedDuration;
            if (safetyEl) safetyEl.textContent = `${activeRoute.safetyScore}/100`;
            if (havenEl) havenEl.textContent = `${activeRoute.safeHavenCount || 0} Nearby`;

            const statusTextEl = document.getElementById('routeStatusText');
            const statusBadgeWrapper = document.querySelector('#routeInfoCard .card-status');
            if (statusTextEl && statusBadgeWrapper) {
                if (activeRoute.type === 'safest') {
                    statusTextEl.textContent = 'Recommended Safe Road Corridor';
                    statusBadgeWrapper.className = 'card-status safe';
                } else if (activeRoute.type === 'fastest') {
                    statusTextEl.textContent = activeRoute.safetyScore < 60 ? 'Alternative Unsafe Road Corridor' : 'Direct Fastest Road Corridor';
                    statusBadgeWrapper.className = 'card-status warning';
                } else {
                    statusTextEl.textContent = 'Standard Road Corridor';
                    statusBadgeWrapper.className = 'card-status normal';
                }
            }

        } catch (err) {
            console.error('Route calculation error:', err);
            window.showToast('⚠️ Could not calculate road routes. Check network connection.');
        }
    }

    renderRoutePolylines(routes, activeRoute, autoFit) {
        // Clear previous polylines
        Object.values(this.routeLayers).forEach(layer => this.map.removeLayer(layer));
        this.routeLayers = {};
        if (this.routeBadgeMarker) {
            this.map.removeLayer(this.routeBadgeMarker);
            this.routeBadgeMarker = null;
        }

        // Draw alternative routes (dashed, background)
        routes.forEach(r => {
            if (r.routeId !== activeRoute.routeId && r.coordinates && r.coordinates.length > 0) {
                const color = (r.routeId === 'fastest' && (r.isNight || r.safetyScore < 60)) ? '#ef4444' : '#64748b';
                const layer = L.polyline(r.coordinates, {
                    color,
                    weight: 5,
                    opacity: 0.55,
                    dashArray: '6, 8'
                }).addTo(this.map);

                layer.on('click', () => this.switchActiveRoute(r.routeId));
                this.routeLayers[r.routeId] = layer;
            }
        });

        // Draw active route on top
        if (activeRoute && activeRoute.coordinates && activeRoute.coordinates.length > 0) {
            const activeColor = activeRoute.type === 'safest' ? '#10b981' : (activeRoute.type === 'fastest' ? (activeRoute.safetyScore < 60 ? '#f87171' : '#f59e0b') : '#38bdf8');

            const mainLayer = L.polyline(activeRoute.coordinates, {
                color: activeColor,
                weight: 6,
                opacity: 0.95
            }).addTo(this.map);

            this.routeLayers[activeRoute.routeId] = mainLayer;

            if (autoFit) {
                this.map.fitBounds(mainLayer.getBounds(), { padding: [60, 60] });
            }

            // Floating badge on route midpoint
            const midIdx = Math.floor(activeRoute.coordinates.length / 2);
            const midCoord = activeRoute.coordinates[midIdx];
            const badgeIcon = L.divIcon({
                className: 'route-badge-container',
                html: `<div class="route-badge-marker">🚶 <b>${activeRoute.formattedDuration}</b> (${activeRoute.formattedDistance}) &bull; ${activeRoute.safetyBadge}</div>`,
                iconSize: [220, 24],
                iconAnchor: [110, 12]
            });
            this.routeBadgeMarker = L.marker(midCoord, { icon: badgeIcon, interactive: false }).addTo(this.map);
        }
    }

    renderRouteComparisonCards(routes, activeRoute) {
        const container = document.getElementById('routeComparisonContainer');
        if (!container) return;

        let html = '';
        routes.forEach(r => {
            const isSelected = (r.routeId === activeRoute.routeId);
            const icon = r.type === 'safest' ? '🛡️' : (r.type === 'fastest' ? '⚡' : '🚶');
            const scoreClass = r.safetyScore >= 85 ? 'text-green' : (r.safetyScore >= 65 ? 'text-amber' : 'text-red');

            html += `
                <div class="route-option-card ${isSelected ? 'active' : ''} ${r.type}" onclick="window.app.switchActiveRoute('${r.routeId}')">
                    <div class="route-opt-header">
                        <span class="route-opt-title">${icon} ${r.name.split('(')[0].trim()}</span>
                        <span class="route-opt-score ${scoreClass}">${r.safetyScore}/100</span>
                    </div>
                    <div class="route-opt-metrics">
                        <span class="metric-val"><b>${r.formattedDuration}</b></span>
                        <span class="metric-sep">&bull;</span>
                        <span class="metric-val">${r.formattedDistance}</span>
                        <span class="metric-sep">&bull;</span>
                        <span class="route-opt-badge ${r.type}">${r.safetyBadge}</span>
                    </div>
                    <div class="route-opt-desc">${r.safetyDesc}</div>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    switchActiveRoute(routeId) {
        const route = window.routingEngine.selectRoute(routeId);
        if (route) {
            this.renderRoutePolylines(window.routingEngine.currentRoutes, route, false);
            window.safetyManager.renderIlluminationUnderlay(this.map, route);
            window.safetyManager.renderRouteMilestones(this.map, route);
            window.safetyManager.updatePreTripSafetyAudit(route);
            this.renderRouteComparisonCards(window.routingEngine.currentRoutes, route);
            this.updateTopNavigationBanner(route);

            document.getElementById('routeTitle').textContent = route.name;
            document.getElementById('routeDescription').textContent = route.safetyDesc;
            document.getElementById('statTime').textContent = route.formattedDuration;
            document.getElementById('statSafety').textContent = `${route.safetyScore}/100`;
            const havenEl = document.getElementById('statHavenCount');
            if (havenEl) havenEl.textContent = `${route.safeHavenCount || 0} Nearby`;

            const statusTextEl = document.getElementById('routeStatusText');
            const statusBadgeWrapper = document.querySelector('#routeInfoCard .card-status');
            if (statusTextEl && statusBadgeWrapper) {
                if (route.type === 'safest') {
                    statusTextEl.textContent = 'Recommended Safe Road Corridor';
                    statusBadgeWrapper.className = 'card-status safe';
                } else if (route.type === 'fastest') {
                    statusTextEl.textContent = 'Direct Fastest Road Corridor';
                    statusBadgeWrapper.className = 'card-status warning';
                } else {
                    statusTextEl.textContent = 'Standard Road Corridor';
                    statusBadgeWrapper.className = 'card-status normal';
                }
            }

            window.showToast(`Selected: ${route.name}`);
        }
    }

    updateTopNavigationBanner(route) {
        const routeNameEl = document.getElementById('navRouteName');
        const badgeEl = document.getElementById('navStatusBadge');
        const timeEl = document.getElementById('navTime');
        const distEl = document.getElementById('navDistance');
        const descEl = document.getElementById('navSafetyDesc');

        if (routeNameEl) routeNameEl.textContent = route.name;
        if (distEl) distEl.textContent = route.formattedDistance;
        if (timeEl && typeof calculateEta === 'function') {
            timeEl.textContent = `${route.formattedDuration} (ETA ${calculateEta(route.durationMinutes, this.currentHour)})`;
        }

        if (badgeEl) {
            badgeEl.className = `nav-badge ${route.type === 'safest' ? 'safe' : (route.type === 'fastest' && route.isNight ? 'warning' : 'safe')}`;
            badgeEl.textContent = route.safetyBadge;
        }

        if (descEl) {
            descEl.textContent = `${route.lightingStatus} • ${route.safeHavenCount || 0} Safe Havens Nearby`;
        }
    }

    startGPSWatcher() {
        const gpsBadge = document.getElementById('gpsStatusBadge');

        // Confirm map and userMarker readiness
        if (!this.map || !this.userMarker) {
            console.warn('[SafeStep GPS] startGPSWatcher called before map or userMarker initialized.');
        }

        // Check for Secure Context (HTTPS or localhost) - required by modern browsers
        const isLocalhost = Boolean(
            window.location.hostname === 'localhost' ||
            window.location.hostname === '127.0.0.1' ||
            window.location.hostname === '[::1]'
        );
        const isSecure = (typeof window.isSecureContext === 'boolean')
            ? window.isSecureContext
            : (window.location.protocol === 'https:' || isLocalhost);

        if (!isSecure) {
            const insecureMsg = `Geolocation requires HTTPS or localhost. Browsers block GPS access on plain HTTP (${window.location.origin}).`;
            console.error('[SafeStep GPS Error] Insecure Context:', insecureMsg);
            if (gpsBadge) {
                gpsBadge.className = 'gps-badge offline';
                gpsBadge.textContent = '🔴 GPS Blocked (Needs HTTPS)';
            }
            window.showToast('⚠️ GPS blocked: Browsers require HTTPS or localhost for Geolocation.');
            return;
        }

        if (!navigator.geolocation) {
            console.error('[SafeStep GPS Error] navigator.geolocation is not supported by this browser.');
            if (gpsBadge) {
                gpsBadge.className = 'gps-badge offline';
                gpsBadge.textContent = '🔴 GPS Unsupported';
            }
            window.showToast('⚠️ Geolocation is not supported by your browser.');
            return;
        }

        if (gpsBadge) {
            gpsBadge.className = 'gps-badge acquiring';
            gpsBadge.textContent = '🟡 Acquiring GPS...';
        }

        navigator.geolocation.watchPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                const accuracy = Math.round(pos.coords.accuracy);
                this.userLocation = [lat, lng];

                if (this.userMarker) {
                    this.userMarker.setLatLng(this.userLocation);
                }

                // Check if user set origin manually (e.g. typed street or dragged pin)
                // If manual origin is set and this GPS fix is coarse (> 500m), do NOT override user's origin!
                const shouldUpdateOrigin = !this.hasManualOrigin || accuracy <= 50;

                // Check if this fix is more accurate or if previous fix was coarse (> 1000m)
                const isSignificantImprovement = (!this.bestAccuracy || (this.bestAccuracy > 1000 && accuracy <= 500) || (accuracy < this.bestAccuracy - 50));

                if (shouldUpdateOrigin && (!this.hasAcquiredGPS || isSignificantImprovement)) {
                    this.hasAcquiredGPS = true;
                    this.bestAccuracy = accuracy;
                    console.log(`[SafeStep GPS] Position fix acquired: [${lat.toFixed(5)}, ${lng.toFixed(5)}] ±${accuracy}m`);

                    // Check if origin was still set to the hardcoded default Nanded corridor
                    const isDefaultNanded = (Math.abs(this.originCoords[0] - 19.19107) < 0.05 && Math.abs(this.originCoords[1] - 77.28395) < 0.05);

                    // Automatically center map and relocate Start (Origin) to user's real GPS position
                    this.originCoords = [lat, lng];
                    if (this.originMarker) {
                        this.originMarker.setLatLng(this.originCoords);
                    }
                    if (this.map) {
                        this.map.flyTo(this.originCoords, 16, { duration: 1.0 });
                    }
                    localStorage.setItem('safestep_origin', JSON.stringify(this.originCoords));
                    await this.updateAddressCard('start', this.originCoords, this.originMarker);

                    // If destination was still set to default Nanded or is far away (> 5km), relocate destination nearby (~500m away)
                    const distToDest = (typeof getDistanceMeters === 'function') ? getDistanceMeters(this.originCoords, this.destCoords) : 999999;
                    if (distToDest > 5000 || isDefaultNanded) {
                        this.destCoords = [lat + 0.004, lng + 0.004];
                        if (this.destMarker) {
                            this.destMarker.setLatLng(this.destCoords);
                        }
                        localStorage.setItem('safestep_dest', JSON.stringify(this.destCoords));
                        await this.updateAddressCard('dest', this.destCoords, this.destMarker);
                    }

                    // Recalculate routes for the user's real location
                    await this.calculateRoadRoutes(true);
                    if (accuracy <= 100) {
                        window.showToast(`🟢 High-precision GPS locked (±${accuracy}m).`);
                    } else if (accuracy <= 1000) {
                        window.showToast(`📍 Located at your GPS position (±${accuracy}m).`);
                    } else {
                        window.showToast(`📍 Device reported coarse location (±${Math.round(accuracy / 1000)}km). Type your exact street in Start Location or drag 📍 pin.`);
                    }
                }

                if (gpsBadge) {
                    if (accuracy <= 100) {
                        gpsBadge.className = 'gps-badge online';
                        gpsBadge.textContent = `🟢 Exact GPS (±${accuracy}m)`;
                    } else if (accuracy <= 1000) {
                        gpsBadge.className = 'gps-badge online';
                        gpsBadge.textContent = `🟢 GPS Active (±${accuracy}m)`;
                    } else {
                        gpsBadge.className = 'gps-badge warning';
                        gpsBadge.textContent = `🟡 Coarse GPS (±${Math.round(accuracy / 1000)}km)`;
                    }
                }

                // If navigating, forward coordinates to turn manager
                if (window.navigationManager && window.navigationManager.isNavigating) {
                    window.navigationManager.updateUserPosition(this.userLocation, pos.coords.heading);
                    if (window.safetyManager) {
                        window.safetyManager.checkProximityAlerts(this.userLocation);
                    }
                }
            },
            (err) => {
                const errorNames = {
                    1: 'PERMISSION_DENIED',
                    2: 'POSITION_UNAVAILABLE',
                    3: 'TIMEOUT'
                };
                const errName = errorNames[err.code] || 'UNKNOWN_ERROR';
                console.error(`[SafeStep GPS Error] Code ${err.code} (${errName}): ${err.message}`);

                if (err.code === 1) { // PERMISSION_DENIED
                    if (gpsBadge) {
                        gpsBadge.className = 'gps-badge offline';
                        gpsBadge.textContent = '🔴 GPS Permission Denied';
                    }
                    window.showToast('🚫 Location permission denied. Please allow location access in your browser settings.');
                } else if (err.code === 2) { // POSITION_UNAVAILABLE
                    if (gpsBadge) {
                        gpsBadge.className = 'gps-badge offline';
                        gpsBadge.textContent = '🔴 GPS Unavailable (No Signal)';
                    }
                    window.showToast('📡 GPS position unavailable. Check device GPS / location signal.');
                } else if (err.code === 3) { // TIMEOUT
                    if (gpsBadge) {
                        gpsBadge.className = 'gps-badge offline';
                        gpsBadge.textContent = '🟡 GPS Search Timed Out';
                    }
                    console.warn('[SafeStep GPS] Request timed out (15s). Still listening for location update...');
                } else {
                    if (gpsBadge) {
                        gpsBadge.className = 'gps-badge offline';
                        gpsBadge.textContent = '🔴 GPS Standby';
                    }
                    window.showToast(`⚠️ GPS error: ${err.message}`);
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 0
            }
        );
    }

    startNavigationMode() {
        const activeRoute = window.routingEngine.activeRoute;
        if (!activeRoute) return;

        window.navigationManager.startNavigation(activeRoute, this.currentHour);
        if (window.guardianSentinel) {
            window.guardianSentinel.startArrivalTimer(activeRoute.durationMinutes || 15);
        }
        this.map.flyTo(activeRoute.coordinates[0], 17, { duration: 1.0 });
    }

    stopNavigationMode() {
        window.navigationManager.stopNavigation();
        if (window.guardianSentinel) {
            window.guardianSentinel.stopArrivalTimer();
        }
        if (this.demoInterval) {
            clearInterval(this.demoInterval);
            this.demoInterval = null;
        }
    }

    handleRouteRecalculation(newOrigin) {
        window.showToast('🔄 Recalculating road walking route...');
        this.originCoords = newOrigin;
        this.originMarker.setLatLng(newOrigin);

        this.calculateRoadRoutes(false).then(() => {
            const newActiveRoute = window.routingEngine.activeRoute;
            if (newActiveRoute) {
                window.navigationManager.startNavigation(newActiveRoute, this.currentHour);
                if (window.voiceNavigator) {
                    window.voiceNavigator.speak('New safe route recalculated. Continue along road.');
                }
            }
        });
    }

    async setOrigin(coords, name = '') {
        this.originCoords = coords;
        this.userLocation = [...coords];
        this.hasManualOrigin = true;
        if (this.originMarker) this.originMarker.setLatLng(coords);
        if (this.userMarker) this.userMarker.setLatLng(coords);
        if (this.map) this.map.flyTo(coords, 16, { duration: 1.0 });
        localStorage.setItem('safestep_origin', JSON.stringify(coords));
        if (name) this.originPlaceName = name.split(',')[0].trim();
        window.showToast(`📍 Start set to: ${this.originPlaceName || 'Selected Location'}`);

        await this.updateAddressCard('start', coords, this.originMarker);
        await this.calculateRoadRoutes(true);
    }

    async setDestination(coords, name = '') {
        this.destCoords = coords;
        if (this.destMarker) this.destMarker.setLatLng(coords);
        localStorage.setItem('safestep_dest', JSON.stringify(coords));
        if (name) this.destPlaceName = name.split(',')[0].trim();
        window.showToast(`🎯 Destination set to: ${this.destPlaceName || 'Selected Place'}`);

        await this.updateAddressCard('dest', coords, this.destMarker);
        await this.calculateRoadRoutes(true);
    }

    getUserCoordinates() {
        return this.userLocation || this.originCoords;
    }

    focusNearestFacility(type) {
        const userCoord = this.getUserCoordinates();
        const facilities = window.safetyManager.pois.filter(p => p.type === type);
        if (facilities.length === 0) {
            window.showToast(`No nearby ${type} facility found on record.`);
            return;
        }

        let nearest = null;
        let minDist = Infinity;
        facilities.forEach(f => {
            const d = getDistanceMeters(userCoord, f.coordinates);
            if (d < minDist) {
                minDist = d;
                nearest = f;
            }
        });

        if (nearest) {
            this.map.flyTo(nearest.coordinates, 17, { duration: 0.8 });
            window.showToast(`📍 Centered on nearest ${type}: ${nearest.name} (${Math.round(minDist)} m)`);
        }
    }

    // 👤 User Authentication & Safety Profile
    checkAuthState() {
        const btnAuth = document.getElementById('btnUserAuth');
        const userStr = localStorage.getItem('safestep_user');
        if (userStr && btnAuth) {
            try {
                const user = JSON.parse(userStr);
                if (user && user.name) {
                    btnAuth.textContent = `👤 ${user.name.split(' ')[0]}`;
                    btnAuth.classList.add('logged-in');
                    return user;
                }
            } catch (e) {}
        }
        if (btnAuth) {
            btnAuth.textContent = '👤 Safety Profile';
            btnAuth.classList.remove('logged-in');
        }
        return null;
    }

    openAuthModal() {
        const modal = document.getElementById('authModal');
        const nameInput = document.getElementById('authUserName');
        const phoneInput = document.getElementById('authUserPhone');
        const contactInput = document.getElementById('authContactPhone');
        const contactNameInput = document.getElementById('authContactName');
        const profileDetails = document.getElementById('authProfileDetails');
        const modalTitle = document.getElementById('authModalTitle');

        const userStr = localStorage.getItem('safestep_user');
        const contactsStr = localStorage.getItem('safestep_trusted_contacts');

        if (userStr) {
            try {
                const user = JSON.parse(userStr);
                if (nameInput) nameInput.value = user.name || '';
                if (phoneInput) phoneInput.value = user.phone || '';
                if (profileDetails) profileDetails.style.display = 'block';
                if (modalTitle) modalTitle.textContent = '👤 Your Safety Profile';
            } catch (e) {}
        } else {
            if (profileDetails) profileDetails.style.display = 'none';
            if (modalTitle) modalTitle.textContent = '👤 Set Up Profile';
        }

        if (contactsStr) {
            try {
                const contacts = JSON.parse(contactsStr);
                if (Array.isArray(contacts) && contacts[0]) {
                    if (contactInput) contactInput.value = contacts[0].phone || '';
                    if (contactNameInput) contactNameInput.value = contacts[0].name || '';
                }
            } catch (e) {}
        }

        if (modal) modal.classList.add('active');
    }

    closeAuthModal() {
        const modal = document.getElementById('authModal');
        if (modal) modal.classList.remove('active');
    }

    handleAuthSubmit(e) {
        if (e) e.preventDefault();
        const nameInput = document.getElementById('authUserName');
        const phoneInput = document.getElementById('authUserPhone');
        const contactInput = document.getElementById('authContactPhone');
        const contactNameInput = document.getElementById('authContactName');

        const name = nameInput ? nameInput.value.trim() : '';
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const contactPhone = contactInput ? contactInput.value.trim() : '';
        const contactName = (contactNameInput && contactNameInput.value.trim()) ? contactNameInput.value.trim() : 'Emergency Contact';

        if (!name || !phone) return;

        const user = { name, phone };
        localStorage.setItem('safestep_user', JSON.stringify(user));

        const contacts = contactPhone ? [{ name: contactName, phone: contactPhone }] : [];
        if (contacts.length > 0) {
            localStorage.setItem('safestep_trusted_contacts', JSON.stringify(contacts));
        }

        // Cryptographic BOLA Defense: Authenticate and store signed HMAC token
        fetch('/api/user/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, phone, contacts })
        })
        .then(res => res.json())
        .then(data => {
            if (data.token) {
                localStorage.setItem('safestep_auth_token', data.token);
            }
        })
        .catch(err => console.warn('Auth token sync failed (offline fallback active):', err));

        this.checkAuthState();
        if (window.guardianSentinel) window.guardianSentinel.updateHeaderRibbon();
        this.closeAuthModal();

        window.showToast(`✅ Welcome, ${name}! Emergency contacts saved securely.`);
    }

    async handleLogout() {
        const token = localStorage.getItem('safestep_auth_token');
        if (token) {
            try {
                await fetch('/api/user/logout', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            } catch (err) {
                console.warn('[SafeStep Auth] Token revocation failed during logout:', err);
            }
        }
        localStorage.removeItem('safestep_user');
        localStorage.removeItem('safestep_trusted_contacts');
        localStorage.removeItem('safestep_auth_token');
        this.checkAuthState();
        if (window.guardianSentinel) window.guardianSentinel.updateHeaderRibbon();
        this.closeAuthModal();
        window.showToast('Profile reset successfully.');
    }

    // Live Hazard / Safety Condition Reporting
    openReportModal() {
        const modal = document.getElementById('reportHazardModal');
        if (modal) modal.classList.add('active');
    }

    closeReportModal() {
        const modal = document.getElementById('reportHazardModal');
        if (modal) modal.classList.remove('active');
    }

    async submitLiveReport() {
        const typeSelect = document.getElementById('reportTypeSelect');
        const descInput = document.getElementById('reportDescInput');
        const userCoord = this.getUserCoordinates();

        const type = typeSelect ? typeSelect.value : 'hazard';
        const description = descInput ? descInput.value.trim() : '';

        try {
            const res = await fetch('/api/safety/report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type,
                    lat: userCoord[0],
                    lng: userCoord[1],
                    description: description || 'Local safety report'
                })
            });
            const data = await res.json();
            if (data.success) {
                this.closeReportModal();
                if (descInput) descInput.value = '';
                window.showToast('📢 Safety report broadcasted to local network.');

                // Refresh route safety with new report
                await window.safetyManager.loadSafetyData(this.map);
                await this.calculateRoadRoutes(false);
            }
        } catch (e) {
            console.error('Report submission error:', e);
            window.showToast('Could not submit report. Check connection.');
        }
    }

    // Demo Mode Walking Simulation
    toggleDemoMode() {
        this.isDemoMode = !this.isDemoMode;
        const demoToggleBtn = document.getElementById('btnToggleDemoMode');
        const demoControls = document.getElementById('demoControlsPanel');

        if (this.isDemoMode) {
            demoToggleBtn.classList.add('active');
            demoToggleBtn.textContent = '🎮 DEMO ON';
            if (demoControls) demoControls.style.display = 'flex';
            window.showToast('🎮 Demo mode active.');
        } else {
            demoToggleBtn.classList.remove('active');
            demoToggleBtn.textContent = '🎮 DEMO';
            if (demoControls) demoControls.style.display = 'none';
            this.stopNavigationMode();
            window.showToast('Demo mode exited.');
        }
    }

    startDemoWalking() {
        const activeRoute = window.routingEngine.activeRoute;
        if (!activeRoute || !activeRoute.coordinates || activeRoute.coordinates.length === 0) return;

        this.startNavigationMode();
        window.showToast('🚶 Simulating road walking...');

        const path = activeRoute.coordinates;
        const subSteps = [];
        for (let i = 0; i < path.length - 1; i++) {
            const p1 = path[i];
            const p2 = path[i + 1];
            const segments = 10;
            for (let j = 0; j <= segments; j++) {
                subSteps.push([
                    p1[0] + (p2[0] - p1[0]) * (j / segments),
                    p1[1] + (p2[1] - p1[1]) * (j / segments)
                ]);
            }
        }

        let idx = 0;
        if (this.demoInterval) clearInterval(this.demoInterval);

        this.demoInterval = setInterval(() => {
            if (idx >= subSteps.length || !window.navigationManager.isNavigating) {
                clearInterval(this.demoInterval);
                this.demoInterval = null;
                return;
            }

            const currentPos = subSteps[idx];
            this.userLocation = currentPos;
            this.userMarker.setLatLng(currentPos);
            this.map.panTo(currentPos, { animate: true, duration: 0.3 });

            window.navigationManager.updateUserPosition(currentPos);
            window.safetyManager.checkProximityAlerts(currentPos);

            idx++;
        }, 500);
    }

    simulateDemoDeviation() {
        if (!this.userLocation) return;
        window.showToast('⚠️ Simulating sudden alley deviation...');

        const deviatedCoord = [this.userLocation[0] + 0.0006, this.userLocation[1] + 0.0007];
        this.userLocation = deviatedCoord;
        this.userMarker.setLatLng(deviatedCoord);
        this.map.panTo(deviatedCoord, { animate: true });

        window.navigationManager.updateUserPosition(deviatedCoord);
    }

    dispatchAction(action, param, e) {
        if (!action) return;
        switch (action) {
            case 'trigger-sos':
                if (window.sosManager) window.sosManager.triggerSOS();
                break;
            case 'cancel-sos':
                if (window.sosManager) window.sosManager.cancelSOS();
                break;
            case 'escape-haven':
                if (window.safetyManager) window.safetyManager.escapeToNearestSafeHaven();
                break;
            case 'escape-haven-and-cancel-sos':
                if (window.safetyManager) window.safetyManager.escapeToNearestSafeHaven();
                if (window.sosManager) window.sosManager.cancelSOS();
                break;
            case 'toggle-siren':
                if (window.defenseToolkit) window.defenseToolkit.toggleSiren();
                break;
            case 'trigger-fake-call':
                if (window.defenseToolkit) window.defenseToolkit.triggerFakeCall(param || 'Dad (Home)');
                break;
            case 'end-fake-call':
                if (window.defenseToolkit) window.defenseToolkit.endFakeCall();
                break;
            case 'accept-fake-call':
                if (window.defenseToolkit) window.defenseToolkit.acceptFakeCall();
                break;
            case 'toggle-strobe':
                if (window.defenseToolkit) window.defenseToolkit.toggleStrobe();
                break;
            case 'open-checkin':
                if (window.guardianSentinel) window.guardianSentinel.openCheckInModal();
                break;
            case 'cancel-overdue':
                if (window.guardianSentinel) window.guardianSentinel.cancelOverdue();
                break;
            case 'overdue-stage3':
                if (window.guardianSentinel) window.guardianSentinel.showOverdueStage3();
                break;
            case 'dismiss-arrival':
                if (window.guardianSentinel) window.guardianSentinel.dismissArrivalModal();
                break;
            case 'checkin-safely':
                if (window.guardianSentinel) window.guardianSentinel.checkInSafely();
                break;
            case 'open-share-trip':
                if (window.sosManager) window.sosManager.openShareTripModal();
                break;
            case 'close-share-trip':
                if (window.sosManager) window.sosManager.closeShareTripModal();
                break;
            case 'copy-emergency-sms':
                if (window.sosManager) window.sosManager.copyEmergencySMS();
                break;
            case 'execute-emergency-protocol':
                if (window.sosManager) window.sosManager.executeEmergencyProtocol();
                break;
            case 'stop-nav':
                this.stopNavigationMode();
                break;
            case 'open-auth':
                this.openAuthModal();
                break;
            case 'close-auth':
                this.closeAuthModal();
                break;
            case 'logout':
                this.handleLogout();
                break;
            case 'open-report':
                this.openReportModal();
                break;
            case 'close-report':
                this.closeReportModal();
                break;
            case 'submit-report':
                this.submitLiveReport();
                break;
            default:
                console.warn('[SafeStep Action] Unrecognized action:', action);
        }
    }

    initEventListeners() {
        // Form submissions (CSP compliant)
        const authForm = document.getElementById('authForm');
        if (authForm) {
            authForm.addEventListener('submit', (e) => this.handleAuthSubmit(e));
        }

        // Global Event Delegation for [data-action] elements (CSP compliant)
        document.addEventListener('click', (e) => {
            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.getAttribute('data-action');
            const param = actionEl.getAttribute('data-action-param');
            this.dispatchAction(action, param, e);
        });

        // Time slider
        const timeSlider = document.getElementById('timeSlider');
        const timeDisplay = document.getElementById('timeDisplay');
        if (timeSlider) {
            timeSlider.addEventListener('input', (e) => {
                const hour = parseInt(e.target.value);
                this.currentHour = hour;
                const period = hour >= 12 ? 'PM' : 'AM';
                const displayHour = hour % 12 === 0 ? 12 : hour % 12;
                timeDisplay.textContent = `${displayHour}:00 ${period}`;
                this.calculateRoadRoutes(false);
            });
        }

        // Start Location Search
        const startInput = document.getElementById('startInput');
        const btnSearchStart = document.getElementById('btnSearchStart');

        const doSearchStart = async (query) => {
            if (!query || query.trim().length === 0) return;
            window.showToast(`🔍 Searching start: "${query}"...`);
            try {
                const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
                const results = await res.json();
                if (results && results.length > 0) {
                    const first = results[0];
                    await this.setOrigin([parseFloat(first.lat), parseFloat(first.lon)], first.display_name);
                } else {
                    window.showToast('Start location not found. Try entering a nearby street or landmark.');
                }
            } catch (e) {
                console.error('Start search error:', e);
            }
        };

        if (startInput) {
            startInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doSearchStart(e.target.value);
                }
            });
        }
        if (btnSearchStart) {
            btnSearchStart.addEventListener('click', () => doSearchStart(startInput ? startInput.value : ''));
        }

        // Destination Search
        const destInput = document.getElementById('destInput');
        const btnSearch = document.getElementById('btnSearchDest');

        const doSearch = async (query) => {
            if (!query || query.trim().length === 0) return;
            window.showToast(`🔍 Searching destination: "${query}"...`);
            try {
                const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`);
                const results = await res.json();
                if (results && results.length > 0) {
                    const first = results[0];
                    await this.setDestination([parseFloat(first.lat), parseFloat(first.lon)], first.display_name);
                } else {
                    window.showToast('Destination not found. Try entering a landmark.');
                }
            } catch (e) {
                console.error('Search error:', e);
            }
        };

        if (destInput) {
            destInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    doSearch(e.target.value);
                }
            });
        }
        if (btnSearch) btnSearch.addEventListener('click', () => doSearch(destInput ? destInput.value : ''));

        // Start Walking
        const btnStartWalk = document.getElementById('btnSimulateWalk');
        if (btnStartWalk) {
            btnStartWalk.addEventListener('click', () => {
                if (window.navigationManager.isNavigating) {
                    this.stopNavigationMode();
                } else {
                    if (this.isDemoMode) this.startDemoWalking();
                    else this.startNavigationMode();
                }
            });
        }

        // Voice toggle
        const btnVoiceToggle = document.getElementById('btnVoiceToggle');
        if (btnVoiceToggle) {
            btnVoiceToggle.addEventListener('click', () => {
                const isMuted = window.voiceNavigator.toggleMute();
                btnVoiceToggle.textContent = isMuted ? '🔇 Voice OFF' : '🔊 Voice ON';
                btnVoiceToggle.classList.toggle('muted', isMuted);
                window.showToast(isMuted ? 'Voice guidance muted.' : 'Voice guidance active.');
            });
        }

        // GPS center
        const btnGps = document.getElementById('btnGps');
        if (btnGps) {
            btnGps.addEventListener('click', () => {
                window.showToast('📡 Locating real GPS position...');
                if (!navigator.geolocation) {
                    window.showToast('⚠️ Geolocation is not supported by your browser.');
                    return;
                }
                navigator.geolocation.getCurrentPosition(
                    async (pos) => {
                        const lat = pos.coords.latitude;
                        const lng = pos.coords.longitude;
                        const accuracy = Math.round(pos.coords.accuracy);

                        this.hasManualOrigin = false; // User explicitly requested GPS center
                        this.hasAcquiredGPS = true;
                        this.bestAccuracy = accuracy;
                        this.originCoords = [lat, lng];
                        this.userLocation = [lat, lng];
                        if (this.originMarker) this.originMarker.setLatLng(this.originCoords);
                        if (this.userMarker) this.userMarker.setLatLng(this.userLocation);
                        if (this.map) this.map.flyTo(this.originCoords, 16, { duration: 1.0 });
                        localStorage.setItem('safestep_origin', JSON.stringify(this.originCoords));
                        await this.updateAddressCard('start', this.originCoords, this.originMarker);

                        const distToDest = (typeof getDistanceMeters === 'function') ? getDistanceMeters(this.originCoords, this.destCoords) : 999999;
                        if (distToDest > 5000) {
                            this.destCoords = [lat + 0.004, lng + 0.004];
                            if (this.destMarker) this.destMarker.setLatLng(this.destCoords);
                            localStorage.setItem('safestep_dest', JSON.stringify(this.destCoords));
                            await this.updateAddressCard('dest', this.destCoords, this.destMarker);
                        }

                        await this.calculateRoadRoutes(true);

                        const gpsBadge = document.getElementById('gpsStatusBadge');
                        if (gpsBadge) {
                            if (accuracy <= 100) {
                                gpsBadge.className = 'gps-badge online';
                                gpsBadge.textContent = `🟢 Exact GPS (±${accuracy}m)`;
                            } else if (accuracy <= 1000) {
                                gpsBadge.className = 'gps-badge online';
                                gpsBadge.textContent = `🟢 GPS Active (±${accuracy}m)`;
                            } else {
                                gpsBadge.className = 'gps-badge warning';
                                gpsBadge.textContent = `🟡 Coarse GPS (±${Math.round(accuracy / 1000)}km)`;
                            }
                        }

                        if (accuracy <= 100) {
                            window.showToast(`🟢 Exact GPS location locked (±${accuracy}m).`);
                        } else if (accuracy <= 1000) {
                            window.showToast(`📍 Location locked (±${accuracy}m).`);
                        } else {
                            window.showToast(`📍 Approximate IP Location (±${Math.round(accuracy / 1000)}km). You can type your exact street above or drag 📍 for pin-point accuracy.`);
                        }
                    },
                    (err) => {
                        const errorNames = { 1: 'PERMISSION_DENIED', 2: 'POSITION_UNAVAILABLE', 3: 'TIMEOUT' };
                        console.error(`[SafeStep Locate Error] Code ${err.code} (${errorNames[err.code] || 'UNKNOWN'}): ${err.message}`);
                        if (err.code === 1) {
                            window.showToast('🚫 Location permission denied. Please allow location access.');
                        } else if (err.code === 2) {
                            window.showToast('📡 GPS position unavailable. Check device location services.');
                        } else if (err.code === 3) {
                            window.showToast('⏱️ GPS request timed out. Please try again.');
                        } else {
                            window.showToast(`⚠️ Could not acquire GPS coordinates: ${err.message}`);
                        }
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            });
        }

        // SOS Button
        const btnSos = document.getElementById('btnFloatingSOS');
        if (btnSos) {
            btnSos.addEventListener('click', () => window.sosManager.triggerSOS());
        }

        // Demo Mode Buttons
        const btnDemoMode = document.getElementById('btnToggleDemoMode');
        if (btnDemoMode) btnDemoMode.addEventListener('click', () => this.toggleDemoMode());

        const btnSimWalk = document.getElementById('btnDemoWalk');
        if (btnSimWalk) btnSimWalk.addEventListener('click', () => this.startDemoWalking());

        const btnSimDev = document.getElementById('btnDemoDeviate');
        if (btnSimDev) btnSimDev.addEventListener('click', () => this.simulateDemoDeviation());
    }
}

// Instantiate on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new SafeStepApp();
});
