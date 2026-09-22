/**
 * 🛡️ SafeStep Guardian Sentinel (guardian.js)
 * Implements:
 * 1. Truthful Arrival Safety Timer (Active route duration + 5 min buffer, accounts for journey progress)
 * 2. Staged Overdue Escalation Protocol (Never claims emergency dispatch, requires explicit user action)
 * 3. Formal Guardian States: ACTIVE, NEAR_DEADLINE, OVERDUE, CONFIRMED_SAFE, CANCELLED
 * 4. Battery Sentinel with duplicate alert prevention & truthful browser capability checks
 * 5. Destination Arrival Check-in Prompt ("Are you safe?", records safe arrival truthfully)
 */

class GuardianSentinel {
    constructor() {
        // Formal Safety States
        this.STATES = {
            IDLE: 'IDLE',
            ACTIVE: 'ACTIVE',
            NEAR_DEADLINE: 'NEAR_DEADLINE',
            OVERDUE: 'OVERDUE',
            CONFIRMED_SAFE: 'CONFIRMED_SAFE',
            CANCELLED: 'CANCELLED'
        };

        this.state = this.STATES.IDLE;
        this.deadlineTime = null;
        this.timerInterval = null;
        this.bufferMinutes = 5; // 5-minute safety cushion
        this.remainingRouteMinutes = 0;
        this.hasShownArrivalPrompt = false;

        // Battery Sentinel State
        this.batterySupported = false;
        this.batteryLevel = null;
        this.hasShownLowBatteryAlert = false;

        this.initBatterySentinel();
        this.updateHeaderRibbon();
    }

    /**
     * Starts the arrival timer using the active route duration + 5 min safety cushion
     */
    startArrivalTimer(routeDurationMinutes) {
        this.remainingRouteMinutes = Math.max(1, routeDurationMinutes || 10);
        this.state = this.STATES.ACTIVE;
        this.hasShownArrivalPrompt = false;
        this.hasShownLowBatteryAlert = false;

        this.computeDeadline();

        if (this.timerInterval) clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => this.tick(), 1000);

        this.updateGuardianDisplay();
        this.updateHeaderRibbon();

        console.log(`🛡️ Guardian Sentinel [ACTIVE]: Deadline set to ${this.deadlineTime.toLocaleTimeString()}`);
    }

    /**
     * Recalculates deadline dynamically based on travel progress
     */
    computeDeadline() {
        const now = Date.now();
        const totalAllowanceMs = (this.remainingRouteMinutes + this.bufferMinutes) * 60 * 1000;
        this.deadlineTime = new Date(now + totalAllowanceMs);
    }

    /**
     * Dynamically updates remaining time as user advances along the route
     */
    updateRemainingRouteTime(remainingMinutes) {
        if (this.state !== this.STATES.ACTIVE && this.state !== this.STATES.NEAR_DEADLINE) return;
        this.remainingRouteMinutes = Math.max(1, remainingMinutes);
        this.computeDeadline();
        this.updateGuardianDisplay();
    }

    stopArrivalTimer() {
        this.state = this.STATES.CANCELLED;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.updateHeaderRibbon();
        this.updateGuardianDisplay();
    }

    tick() {
        if (this.state === this.STATES.CONFIRMED_SAFE || this.state === this.STATES.CANCELLED || this.state === this.STATES.IDLE) {
            return;
        }

        const now = Date.now();
        const diffMs = this.deadlineTime ? (this.deadlineTime.getTime() - now) : 0;

        if (diffMs <= 0) {
            this.state = this.STATES.OVERDUE;
            if (this.timerInterval) clearInterval(this.timerInterval);
            this.triggerStagedOverdueProtocol();
            return;
        }

        // Near deadline state (less than 3 minutes left)
        if (diffMs <= 180000 && this.state === this.STATES.ACTIVE) {
            this.state = this.STATES.NEAR_DEADLINE;
            if (window.showToast) window.showToast('⏱️ Approaching arrival check-in deadline. You have 3 minutes.');
        }

        this.updateGuardianDisplay(diffMs);
    }

    updateGuardianDisplay(remainingMs = null) {
        const ribbonTimeEl = document.getElementById('guardianDeadlineText');
        const hudDeadlineEl = document.getElementById('hudDeadlineText');

        if (!this.deadlineTime || this.state === this.STATES.IDLE || this.state === this.STATES.CANCELLED) {
            const idleText = '⏱️ Check-in: Standby';
            if (ribbonTimeEl) ribbonTimeEl.textContent = idleText;
            if (hudDeadlineEl) hudDeadlineEl.textContent = idleText;
            return;
        }

        const timeStr = this.deadlineTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

        let remText = '';
        if (remainingMs !== null && remainingMs > 0) {
            const remMins = Math.floor(remainingMs / 60000);
            const remSecs = Math.floor((remainingMs % 60000) / 1000);
            remText = ` (${remMins}m ${remSecs}s left)`;
        }

        const displayText = `⏱️ Check-in: ${timeStr}${remText}`;
        if (ribbonTimeEl) ribbonTimeEl.textContent = displayText;
        if (hudDeadlineEl) hudDeadlineEl.textContent = displayText;
    }

    /**
     * 13. PROMPT USER ON APPROACHING DESTINATION: "Are you safe?"
     */
    triggerArrivalPrompt() {
        if (this.hasShownArrivalPrompt || this.state === this.STATES.CONFIRMED_SAFE) return;
        this.hasShownArrivalPrompt = true;

        const modal = document.getElementById('checkInModal');
        if (modal) modal.classList.add('active');

        if (window.voiceNavigator) {
            window.voiceNavigator.speak('You are near your destination. Please confirm if you have arrived safely.');
        }
    }

    checkInSafely() {
        this.state = this.STATES.CONFIRMED_SAFE;
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        const modal = document.getElementById('checkInModal');
        if (modal) modal.classList.remove('active');

        // Record arrival in localStorage
        try {
            const arrivalRecord = {
                timestamp: new Date().toISOString(),
                status: 'confirmed_safe',
                tripId: `trip-${Date.now()}`
            };
            localStorage.setItem('safestep_last_arrival', JSON.stringify(arrivalRecord));
        } catch (e) {}

        // Truthful feedback
        if (window.voiceNavigator) window.voiceNavigator.speak('Safe arrival recorded.', true);
        if (window.showToast) window.showToast('✅ Safe arrival recorded.');

        // Broadcast privacy-safe arrival via Socket.IO
        if (window.socket && typeof window.socket.emit === 'function') {
            window.socket.emit('share_trip', {
                status: 'arrived_safe',
                timestamp: new Date().toISOString()
            });
        }

        this.updateHeaderRibbon();
        this.updateGuardianDisplay();
    }

    openCheckInModal() {
        const modal = document.getElementById('checkInModal');
        if (modal) modal.classList.add('active');
    }

    dismissArrivalModal() {
        const modal = document.getElementById('checkInModal');
        if (modal) modal.classList.remove('active');
    }

    /**
     * 14. STAGED OVERDUE ESCALATION PROTOCOL
     * Stage 1: "Your arrival check-in is overdue."
     * Stage 2: 20-second visible countdown.
     * Stage 3: Options: [ I'm Safe ], [ Call 112 ], [ Share Location ], [ Open Emergency Options ].
     * Does NOT silently dispatch emergency services or make false claims.
     */
    triggerStagedOverdueProtocol() {
        console.warn('⚠️ Guardian Sentinel [OVERDUE]: Safe arrival deadline reached without check-in');

        if (window.voiceNavigator) {
            window.voiceNavigator.speak('Your arrival check-in is overdue. Please confirm your safety.', true);
        }

        const overdueModal = document.getElementById('overdueAlertModal');
        const overdueCountEl = document.getElementById('overdueCountdownVal');
        const stage1View = document.getElementById('overdueStageCountdown');
        const stage3View = document.getElementById('overdueStageActions');

        if (stage1View) stage1View.style.display = 'block';
        if (stage3View) stage3View.style.display = 'none';
        if (overdueModal) overdueModal.classList.add('active');

        let graceSeconds = 20;
        if (overdueCountEl) overdueCountEl.textContent = graceSeconds;

        if (window.overdueGraceTimer) clearInterval(window.overdueGraceTimer);

        window.overdueGraceTimer = setInterval(() => {
            graceSeconds--;
            if (overdueCountEl) overdueCountEl.textContent = graceSeconds;

            if (graceSeconds <= 0) {
                clearInterval(window.overdueGraceTimer);
                window.overdueGraceTimer = null;
                // Transition to Stage 3: Explicit Emergency Action Options
                this.showOverdueStage3();
            }
        }, 1000);
    }

    showOverdueStage3() {
        const stage1View = document.getElementById('overdueStageCountdown');
        const stage3View = document.getElementById('overdueStageActions');

        if (stage1View) stage1View.style.display = 'none';
        if (stage3View) stage3View.style.display = 'block';

        if (window.voiceNavigator) {
            window.voiceNavigator.speak('Overdue period ended. Emergency options are now open.', true);
        }
    }

    cancelOverdue() {
        if (window.overdueGraceTimer) {
            clearInterval(window.overdueGraceTimer);
            window.overdueGraceTimer = null;
        }
        const overdueModal = document.getElementById('overdueAlertModal');
        if (overdueModal) overdueModal.classList.remove('active');

        this.checkInSafely();
    }

    // =========================================================================
    // 16, 17, 18. BATTERY SENTINEL & DUPLICATE ALERT PREVENTION
    // =========================================================================
    async initBatterySentinel() {
        const batteryTextEl = document.getElementById('batterySentinelText');

        if (!('getBattery' in navigator)) {
            this.batterySupported = false;
            if (batteryTextEl) batteryTextEl.textContent = '🔋 Battery: Unavailable';
            return;
        }

        try {
            const battery = await navigator.getBattery();
            this.batterySupported = true;

            const updateBatteryStatus = () => {
                this.batteryLevel = Math.round(battery.level * 100);
                if (batteryTextEl) {
                    batteryTextEl.textContent = `🔋 Battery: ${this.batteryLevel}%`;
                }

                // Check for low battery condition (<= 15% and night navigation)
                if (this.batteryLevel <= 15) {
                    if (batteryTextEl) batteryTextEl.classList.add('low-battery');

                    // Check if night navigation is active and prevent duplicate alerts
                    const isNightNav = (this.state === this.STATES.ACTIVE || this.state === this.STATES.NEAR_DEADLINE);
                    if (isNightNav && !this.hasShownLowBatteryAlert) {
                        this.hasShownLowBatteryAlert = true;
                        if (window.showToast) {
                            window.showToast(`⚠️ Low battery: ${this.batteryLevel}%. Consider enabling battery saving or sharing your trip.`);
                        }
                    }
                } else {
                    if (batteryTextEl) batteryTextEl.classList.remove('low-battery');
                    // Reset duplicate flag if battery charges back up
                    this.hasShownLowBatteryAlert = false;
                }
            };

            updateBatteryStatus();
            battery.addEventListener('levelchange', updateBatteryStatus);
        } catch (e) {
            this.batterySupported = false;
            if (batteryTextEl) batteryTextEl.textContent = '🔋 Battery: Unavailable';
        }
    }

    // =========================================================================
    // 23, 24. TRUTHFUL GUARDIAN HEADER STATUS RIBBON
    // =========================================================================
    updateHeaderRibbon() {
        const titleEl = document.getElementById('guardianTitleStatus');
        const contactEl = document.getElementById('guardianContactsStatus');

        if (titleEl) {
            if (this.state === this.STATES.ACTIVE) {
                titleEl.textContent = '🛡️ SAFESTEP GUARDIAN ACTIVE';
                titleEl.className = 'ribbon-title active';
            } else if (this.state === this.STATES.OVERDUE) {
                titleEl.textContent = '⚠️ GUARDIAN: CHECK-IN OVERDUE';
                titleEl.className = 'ribbon-title warning';
            } else {
                titleEl.textContent = '🛡️ SAFESTEP GUARDIAN STANDBY';
                titleEl.className = 'ribbon-title';
            }
        }

        // Truthful trusted contacts count (never fabricate)
        if (contactEl) {
            let savedContacts = [];
            try {
                const stored = localStorage.getItem('safestep_trusted_contacts');
                if (stored) savedContacts = JSON.parse(stored);
            } catch (e) {}

            if (savedContacts && savedContacts.length > 0) {
                contactEl.textContent = `👥 ${savedContacts.length} trusted contact${savedContacts.length > 1 ? 's' : ''} configured`;
            } else {
                contactEl.textContent = '👥 No trusted contact configured';
            }
        }
    }
}

// Global guardian instance
window.guardianSentinel = new GuardianSentinel();
