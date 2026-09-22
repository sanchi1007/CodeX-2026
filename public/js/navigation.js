/**
 * 🚶 SafeStep Turn-by-Turn Walking Navigation Manager
 * Handles real-time navigation mode, turn instruction cards, distance countdown,
 * step-by-step voice guidance, and route deviation detection.
 */
class NavigationManager {
    constructor() {
        this.isNavigating = false;
        this.currentRoute = null;
        this.currentStepIndex = 0;
        this.userLocation = null;
        this.userHeading = 0;
        this.departureHour = 23;

        this.announcedSteps = new Set();
        this.lastDeviationNoticeTime = 0;
    }

    startNavigation(route, currentHour = 23) {
        if (!route || !route.steps || route.steps.length === 0) {
            console.error('Cannot start navigation: route or steps missing');
            return false;
        }

        this.isNavigating = true;
        this.currentRoute = route;
        this.currentStepIndex = 0;
        this.departureHour = currentHour;
        this.announcedSteps.clear();

        // Reveal Navigation HUD overlay
        this.renderNavHUD(true);
        this.updateHUDDisplay();

        // Initial voice announcement
        const firstStep = route.steps[0];
        window.voiceNavigator.speak(`Starting navigation on ${route.name}. ${firstStep.instruction}.`, true);

        return true;
    }

    stopNavigation() {
        this.isNavigating = false;
        this.currentRoute = null;
        this.currentStepIndex = 0;
        this.announcedSteps.clear();

        this.renderNavHUD(false);
        window.voiceNavigator.speak('Navigation ended.');
    }

    /**
     * Called whenever user's GPS position updates
     */
    updateUserPosition(coord, heading = null) {
        this.userLocation = coord;
        if (heading !== null && heading !== undefined) {
            this.userHeading = heading;
        }

        if (!this.isNavigating || !this.currentRoute) return;

        const steps = this.currentRoute.steps;
        if (this.currentStepIndex >= steps.length) {
            this.onArrival();
            return;
        }

        // 1. Check if user reached or is approaching destination
        const destCoord = this.currentRoute.coordinates[this.currentRoute.coordinates.length - 1];
        const distToDest = getDistanceMeters(coord, destCoord);

        // Dynamically update Guardian remaining journey time
        const remMins = Math.max(1, Math.round(distToDest / 80));
        if (window.guardianSentinel && typeof window.guardianSentinel.updateRemainingRouteTime === 'function') {
            window.guardianSentinel.updateRemainingRouteTime(remMins);
        }

        // Trigger arrival confirmation check-in when approaching destination
        if (distToDest <= 35 && window.guardianSentinel && typeof window.guardianSentinel.triggerArrivalPrompt === 'function') {
            window.guardianSentinel.triggerArrivalPrompt();
        }

        if (distToDest <= 18) {
            this.onArrival();
            return;
        }

        // 2. Check Route Deviation
        const deviationCheck = window.routingEngine.checkDeviation(coord, 38);
        if (deviationCheck.isDeviated) {
            const now = Date.now();
            if (now - this.lastDeviationNoticeTime > 12000) {
                this.lastDeviationNoticeTime = now;
                this.onRouteDeviation(deviationCheck.distanceFromRoute);
            }
            return;
        }

        // 3. Step Progression & Distance to Next Maneuver
        const currentStep = steps[this.currentStepIndex];
        const nextManeuverLoc = currentStep.location || (this.currentStepIndex + 1 < steps.length ? steps[this.currentStepIndex + 1].location : destCoord);

        const distToNextManeuver = nextManeuverLoc ? Math.round(getDistanceMeters(coord, nextManeuverLoc)) : currentStep.distanceMeters;

        // Advance to next step if within 22 meters of the maneuver
        if (distToNextManeuver <= 22 && this.currentStepIndex < steps.length - 1) {
            this.currentStepIndex++;
            const newStep = steps[this.currentStepIndex];
            window.voiceNavigator.announceManeuver(newStep.instruction, newStep.distanceMeters);
        } else {
            // Announce maneuver prompts at 90m threshold
            if (distToNextManeuver <= 90 && !this.announcedSteps.has(this.currentStepIndex)) {
                this.announcedSteps.add(this.currentStepIndex);
                window.voiceNavigator.announceManeuver(currentStep.instruction, distToNextManeuver);
            }
        }

        // 4. Update HUD Display
        this.updateHUDDisplay(distToNextManeuver, distToDest);
    }

    updateHUDDisplay(distToNextTurn = null, totalRemainingMeters = null) {
        if (!this.isNavigating || !this.currentRoute) return;

        const steps = this.currentRoute.steps;
        const curStep = steps[this.currentStepIndex] || steps[0];

        // Next Turn Card
        const turnIconEl = document.getElementById('navTurnIcon');
        const turnTextEl = document.getElementById('navTurnText');
        const turnDistEl = document.getElementById('navTurnDistance');
        const turnStreetEl = document.getElementById('navTurnStreet');

        if (turnIconEl) turnIconEl.textContent = curStep.icon || '⬆️';
        if (turnTextEl) turnTextEl.textContent = curStep.instruction;
        if (turnStreetEl) turnStreetEl.textContent = curStep.streetName;
        if (turnDistEl) {
            const displayDist = (distToNextTurn !== null) ? distToNextTurn : curStep.distanceMeters;
            turnDistEl.textContent = formatDistance(displayDist);
        }

        // Bottom Info Bar
        const remMeters = (totalRemainingMeters !== null) ? totalRemainingMeters : this.currentRoute.distanceMeters;
        const remMins = Math.max(1, Math.round(remMeters / 80));
        const eta = calculateEta(remMins, this.departureHour);

        const hudEtaEl = document.getElementById('hudEta');
        const hudDistEl = document.getElementById('hudRemainingDist');
        const hudTimeEl = document.getElementById('hudRemainingTime');
        const hudStatusPill = document.getElementById('hudSafetyStatus');

        if (hudEtaEl) hudEtaEl.textContent = eta;
        if (hudDistEl) hudDistEl.textContent = formatDistance(remMeters);
        if (hudTimeEl) hudTimeEl.textContent = formatDuration(remMins);

        if (hudStatusPill) {
            hudStatusPill.textContent = this.currentRoute.safetyBadge;
            hudStatusPill.className = `hud-safety-pill ${this.currentRoute.type}`;
        }
    }

    onRouteDeviation(offDistance) {
        console.warn(`⚠️ User is ${offDistance}m away from route. Triggering auto-recalculation.`);
        
        // Show deviation warning in HUD
        const turnTextEl = document.getElementById('navTurnText');
        const turnDistEl = document.getElementById('navTurnDistance');
        if (turnTextEl) turnTextEl.textContent = '⚠️ Off Route - Recalculating path...';
        if (turnDistEl) turnDistEl.textContent = `${offDistance} m off`;

        window.voiceNavigator.announceDeviation();

        // Trigger automatic rerouting in main app
        if (window.app && typeof window.app.handleRouteRecalculation === 'function') {
            window.app.handleRouteRecalculation(this.userLocation);
        }
    }

    onArrival() {
        this.isNavigating = false;

        const turnIconEl = document.getElementById('navTurnIcon');
        const turnTextEl = document.getElementById('navTurnText');
        const turnDistEl = document.getElementById('navTurnDistance');
        if (turnIconEl) turnIconEl.textContent = '🎉';
        if (turnTextEl) turnTextEl.textContent = 'You have arrived safely at your destination!';
        if (turnDistEl) turnDistEl.textContent = '0 m';

        const hudDistEl = document.getElementById('hudRemainingDist');
        const hudTimeEl = document.getElementById('hudRemainingTime');
        if (hudDistEl) hudDistEl.textContent = '0 m';
        if (hudTimeEl) hudTimeEl.textContent = 'Arrived';

        window.voiceNavigator.announceArrival();
        if (window.showToast) window.showToast('🎉 Arrived safely at your destination!');
    }

    renderNavHUD(show) {
        const hudTop = document.getElementById('navigationHUDTop');
        const hudBottom = document.getElementById('navigationHUDBottom');
        const sidebar = document.querySelector('.control-panel');
        const topBanner = document.getElementById('topNavBanner');

        if (hudTop) hudTop.classList.toggle('active', show);
        if (hudBottom) hudBottom.classList.toggle('active', show);
        if (topBanner) topBanner.classList.toggle('nav-hidden', show);
        if (sidebar) sidebar.classList.toggle('nav-docked', show);
    }
}

// Global navigation instance
window.navigationManager = new NavigationManager();
