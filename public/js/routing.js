/**
 * 🗺️ SafeStep Road Routing Engine & Math Utilities
 * Fetches real road-based walking routes, parses steps, and computes route deviation.
 */

// 📏 Haversine Formula for Accurate Distance (Meters)
function getDistanceMeters(coord1, coord2) {
    if (!coord1 || !coord2) return 0;
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

function formatDistance(meters) {
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(minutes) {
    if (minutes <= 0) return '0 min';
    if (minutes < 1) return '< 1 min';
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem === 0 ? `${hrs} hr` : `${hrs} hr ${rem} min`;
}

// 🕒 Arrival ETA Calculator
function calculateEta(durationMinutes, departureHour = null) {
    const depDate = new Date();
    if (departureHour !== null && departureHour !== undefined) {
        depDate.setHours(departureHour, 0, 0, 0);
    }
    const arrDate = new Date(depDate.getTime() + durationMinutes * 60000);
    return arrDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * 📐 Point-to-Line-Segment Perpendicular Distance (Meters)
 * Used to detect if the user has moved off the road polyline.
 */
function distancePointToSegment(p, v, w) {
    // Project point p onto segment vw
    const l2 = (w[0] - v[0]) ** 2 + (w[1] - v[1]) ** 2;
    if (l2 === 0) return getDistanceMeters(p, v);

    let t = ((p[0] - v[0]) * (w[0] - v[0]) + (p[1] - v[1]) * (w[1] - v[1])) / l2;
    t = Math.max(0, Math.min(1, t));
    const projection = [v[0] + t * (w[0] - v[0]), v[1] + t * (w[1] - v[1])];
    return getDistanceMeters(p, projection);
}

/**
 * Calculates minimum distance from user position to any segment on the active route
 */
function getDistanceFromRoute(userCoord, routeCoords) {
    if (!userCoord || !routeCoords || routeCoords.length < 2) return 0;
    let minDistance = Infinity;

    for (let i = 0; i < routeCoords.length - 1; i++) {
        const d = distancePointToSegment(userCoord, routeCoords[i], routeCoords[i + 1]);
        if (d < minDistance) {
            minDistance = d;
        }
    }
    return minDistance;
}

/**
 * 🛣️ Routing Manager Class
 */
class RoutingEngine {
    constructor() {
        this.currentRoutes = [];
        this.activeRoute = null;
        this.selectedRouteId = 'safest'; // default to Safest Route
    }

    async fetchRoadRoutes(origin, dest, hour = 23, destName = '', originName = '') {
        try {
            let url = `/api/route/road?originLat=${origin[0]}&originLng=${origin[1]}&destLat=${dest[0]}&destLng=${dest[1]}&hour=${hour}`;
            if (destName) url += `&destName=${encodeURIComponent(destName)}`;
            if (originName) url += `&originName=${encodeURIComponent(originName)}`;
            const response = await fetch(url);
            const data = await response.json();

            if (!data.success || !data.routes || data.routes.length === 0) {
                throw new Error('No road routes returned by server');
            }

            this.currentRoutes = data.routes;
            
            // Set active route based on selected ID or fallback to first
            this.activeRoute = this.currentRoutes.find(r => r.routeId === this.selectedRouteId) || this.currentRoutes[0];
            this.selectedRouteId = this.activeRoute.routeId;

            return {
                routes: this.currentRoutes,
                activeRoute: this.activeRoute,
                timeNotice: data.timeNotice,
                isNight: data.isNight
            };
        } catch (err) {
            console.error('Error fetching road routes:', err);
            throw err;
        }
    }

    selectRoute(routeId) {
        const found = this.currentRoutes.find(r => r.routeId === routeId);
        if (found) {
            this.activeRoute = found;
            this.selectedRouteId = routeId;
            return this.activeRoute;
        }
        return null;
    }

    checkDeviation(userCoord, thresholdMeters = 35) {
        if (!this.activeRoute || !this.activeRoute.coordinates) return false;
        const dist = getDistanceFromRoute(userCoord, this.activeRoute.coordinates);
        return {
            isDeviated: dist > thresholdMeters,
            distanceFromRoute: Math.round(dist)
        };
    }
}

// Global routing instance
window.routingEngine = new RoutingEngine();
