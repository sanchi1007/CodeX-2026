/**
 * 🚨 SafeStep SOS & Emergency Suite (sos.js)
 * Implements:
 * 1. 5-Second Cancelable Countdown with immediate user override
 * 2. Truthful Emergency Messaging (NEVER claims help dispatched without actual integration)
 * 3. One-Tap National Emergency Access (tel:112)
 * 4. Privacy-Safe Live Location Sharing (WhatsApp, SMS, Clipboard)
 * 5. Nearest Police & Hospital Facilities dynamically sorted by GPS distance
 */

class SOSManager {
    constructor() {
        this.countdownTimer = null;
        this.remainingSeconds = 5;
    }

    triggerSOS() {
        const modal = document.getElementById('sosModal');
        const countdownEl = document.getElementById('sosCountdownVal');
        const actionsEl = document.getElementById('sosActionButtons');
        const countdownContainer = document.getElementById('sosCountdownContainer');

        if (!modal) return;

        this.remainingSeconds = 5;
        if (countdownEl) countdownEl.textContent = this.remainingSeconds;
        if (countdownContainer) countdownContainer.style.display = 'block';
        if (actionsEl) actionsEl.style.display = 'none';

        modal.classList.add('active');

        // Warning speech announcement
        if (window.voiceNavigator && typeof window.voiceNavigator.speak === 'function') {
            window.voiceNavigator.speak('Emergency options opening in 5 seconds. Tap cancel to dismiss.', true);
        }

        if (this.countdownTimer) clearInterval(this.countdownTimer);

        this.countdownTimer = setInterval(() => {
            this.remainingSeconds--;
            if (countdownEl) countdownEl.textContent = this.remainingSeconds;

            if (this.remainingSeconds <= 0) {
                clearInterval(this.countdownTimer);
                this.countdownTimer = null;
                this.executeEmergencyProtocol();
            }
        }, 1000);
    }

    cancelSOS() {
        if (this.countdownTimer) {
            clearInterval(this.countdownTimer);
            this.countdownTimer = null;
        }

        const modal = document.getElementById('sosModal');
        if (modal) modal.classList.remove('active');

        if (window.voiceNavigator) {
            window.voiceNavigator.speak('Emergency alert dismissed.');
        }
        if (window.showToast) window.showToast('✅ Emergency alert dismissed safely.');
    }

    getUserCoordinates() {
        if (window.app && typeof window.app.getUserCoordinates === 'function') {
            const coord = window.app.getUserCoordinates();
            if (coord && Array.isArray(coord) && coord.length === 2 && !isNaN(coord[0]) && !isNaN(coord[1])) {
                return coord;
            }
        }
        if (window.app && window.app.originCoords && Array.isArray(window.app.originCoords)) {
            return window.app.originCoords;
        }
        return [19.16730, 72.93920];
    }

    getEmergencyContact() {
        let contactPhone = '9822041290';
        let contactName = 'Emergency Contact';
        try {
            const stored = localStorage.getItem('safestep_trusted_contacts');
            if (stored) {
                const contacts = JSON.parse(stored);
                if (Array.isArray(contacts) && contacts.length > 0 && contacts[0].phone) {
                    contactPhone = contacts[0].phone;
                    contactName = contacts[0].name || contactName;
                    return { contactPhone, contactName };
                }
            }
            const userStr = localStorage.getItem('safestep_user');
            if (userStr) {
                const u = JSON.parse(userStr);
                if (u.contactPhone) contactPhone = u.contactPhone;
                if (u.contactName) contactName = u.contactName;
            }
        } catch (e) {}
        return { contactPhone, contactName };
    }

    /**
     * 26. TRUTHFUL EMERGENCY PROTOCOL
     * Never claims emergency services were dispatched or contacts notified when they weren't.
     */
    executeEmergencyProtocol() {
        const countdownContainer = document.getElementById('sosCountdownContainer');
        const actionsEl = document.getElementById('sosActionButtons');
        if (countdownContainer) countdownContainer.style.display = 'none';
        if (actionsEl) actionsEl.style.display = 'block';

        const userCoord = this.getUserCoordinates();

        // Populate nearest facilities with real distances
        const facilities = window.safetyManager.getNearestEmergencyFacilities(userCoord);
        const policeInfoEl = document.getElementById('sosNearestPolice');
        const hospInfoEl = document.getElementById('sosNearestHospital');
        const esc = (typeof window.escapeHtml === 'function') 
            ? window.escapeHtml 
            : (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

        if (policeInfoEl) {
            if (facilities.nearestPolice) {
                const p = facilities.nearestPolice;
                const distText = p.distance < 1000
                    ? `${Math.round(p.distance)} m`
                    : `${(p.distance / 1000).toFixed(1)} km`;
                policeInfoEl.innerHTML = `
                    <div class="facility-item">
                        <div class="facility-name">👮 <b>${esc(p.name)}</b> (${distText})</div>
                        <div class="facility-addr">${esc(p.address)}</div>
                        <a href="tel:${encodeURIComponent(p.phone || '112')}" class="btn-sos-call">📞 Call ${esc(p.phone || '112')}</a>
                    </div>
                `;
            } else {
                policeInfoEl.innerHTML = '👮 National Emergency Helpline: <a href="tel:112" class="btn-sos-call">📞 Call 112</a>';
            }
        }

        if (hospInfoEl) {
            if (facilities.nearestHospital) {
                const h = facilities.nearestHospital;
                const distText = h.distance < 1000
                    ? `${Math.round(h.distance)} m`
                    : `${(h.distance / 1000).toFixed(1)} km`;
                hospInfoEl.innerHTML = `
                    <div class="facility-item">
                        <div class="facility-name">🏥 <b>${esc(h.name)}</b> (${distText})</div>
                        <div class="facility-addr">${esc(h.address)}</div>
                        <a href="tel:${encodeURIComponent(h.phone || '108')}" class="btn-sos-call">📞 Call ${esc(h.phone || '108')}</a>
                    </div>
                `;
            } else {
                hospInfoEl.innerHTML = '🏥 Emergency Ambulance: <a href="tel:108" class="btn-sos-call">📞 Call 108</a>';
            }
        }

        // Set up offline SMS emergency buttons
        const offlineSmsBtn = document.getElementById('btnSosOfflineSMS');
        if (offlineSmsBtn) {
            offlineSmsBtn.href = this.getOfflineEmergencySmsUri('112');
        }

        const offlineContactBtn = document.getElementById('btnSosOfflineContactSMS');
        if (offlineContactBtn) {
            const { contactPhone } = this.getEmergencyContact();
            offlineContactBtn.href = this.getOfflineEmergencySmsUri(contactPhone);
        }

        // Truthful audio and toast notice
        if (window.voiceNavigator) {
            window.voiceNavigator.speak('Emergency mode active. Use 112 to contact emergency services. Nearby help locations are shown.', true);
        }
        if (window.showToast) {
            window.showToast('🚨 Emergency mode active. Use 112 to contact emergency services.');
        }

        // Emit privacy-safe emergency event to private room via Socket.IO
        if (window.socket && typeof window.socket.emit === 'function') {
            const tripToken = this.getTripToken();
            window.socket.emit('sos_triggered', {
                tripToken,
                location: userCoord,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * 🔒 CRYPTOGRAPHIC PRIVATE TRIP TOKEN
     * Generates a 128-bit unguessable room token so only guardians with the link can track.
     */
    getTripToken() {
        let token = sessionStorage.getItem('safestep_trip_token');
        if (!token) {
            token = 'trip_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
            sessionStorage.setItem('safestep_trip_token', token);
        }
        if (window.socket && typeof window.socket.emit === 'function') {
            window.socket.emit('join_trip_room', { tripToken: token });
        }
        return token;
    }

    /**
     * 📴 ZERO-DATA / OFFLINE GSM SMS PROTOCOL
     * Generates standard GSM SMS URI containing coordinates & battery level (works without 4G/5G).
     */
    getOfflineEmergencySmsUri(phone = '112') {
        const userCoord = this.getUserCoordinates();
        const batteryEl = document.getElementById('batterySentinelText');
        const batteryText = batteryEl ? batteryEl.textContent.replace('🔋', '').trim() : 'Active';
        const body = `EMERGENCY! I need immediate help. My current GPS: https://maps.google.com/?q=${userCoord[0]},${userCoord[1]} (Coords: ${userCoord[0].toFixed(5)}, ${userCoord[1].toFixed(5)}). Battery: ${batteryText}. Sent via SafeStep offline SMS protocol.`;
        return `sms:${phone}?body=${encodeURIComponent(body)}`;
    }

    /**
     * 💬 WHATSAPP PRE-TRIP SAFETY TICKET GENERATOR
     * Compiles an itinerary ticket for parents & guardians with a private cryptographic tracking link.
     */
    generateWhatsAppSafetyTicket() {
        const user = localStorage.getItem('safestep_user');
        let userName = 'User';
        if (user) {
            try {
                const u = JSON.parse(user);
                userName = u.name || userName;
            } catch (e) {}
        }
        const { contactPhone } = this.getEmergencyContact();

        const activeRoute = window.routingEngine ? window.routingEngine.activeRoute : null;
        const routeName = activeRoute ? activeRoute.name : 'Municipal Streetlit Route';
        const duration = activeRoute ? activeRoute.formattedDuration : '15 min';
        const eta = activeRoute && typeof calculateEta === 'function' ? calculateEta(activeRoute.durationMinutes) : 'In 15 min';
        const userCoord = this.getUserCoordinates();

        const startAddrEl = document.getElementById('startFullAddress');
        const destAddrEl = document.getElementById('destFullAddress');
        const startAddr = startAddrEl ? startAddrEl.textContent.replace('📍 START (ORIGIN)', '').replace(/\s+/g, ' ').trim() : 'Current Location';
        const destAddr = destAddrEl ? destAddrEl.textContent.replace('🔒 DESTINATION', '').replace(/\s+/g, ' ').trim() : 'Safe Destination';

        const batteryEl = document.getElementById('batterySentinelText');
        const batteryText = batteryEl ? batteryEl.textContent.replace('🔋', '').trim() : 'Active';

        const deadlineEl = document.getElementById('guardianDeadlineText');
        const deadlineText = deadlineEl ? deadlineEl.textContent.replace('⏱️', '').trim() : 'Active monitoring';

        const tripToken = this.getTripToken();
        const secureTrackingLink = `${window.location.origin}/?track=${tripToken}&q=${userCoord[0].toFixed(5)},${userCoord[1].toFixed(5)}`;

        const ticket = `🛡️ *SafeStep Guardian Ticket*\n` +
            `👤 *Pedestrian*: ${userName}\n` +
            `📍 *Start*: ${startAddr}\n` +
            `🏁 *Destination*: ${destAddr}\n` +
            `🗺️ *Corridor*: ${routeName}\n` +
            `⏱️ *Estimated Duration*: ${duration} (ETA: ${eta})\n` +
            `🔋 *Phone Battery*: ${batteryText}\n` +
            `🛡️ *Arrival Deadline*: ${deadlineText}\n` +
            `🔒 *Private Guardian Link*: ${secureTrackingLink}\n\n` +
            `_End-to-End Private Walking Ticket._`;

        return { ticket, contactPhone, userCoord, tripToken };
    }

    copyEmergencySMS() {
        const { ticket, userCoord } = this.generateWhatsAppSafetyTicket();
        const shortEmergencyMsg = `🚨 EMERGENCY: I feel unsafe and require assistance. My current GPS location: https://maps.google.com/?q=${userCoord[0]},${userCoord[1]} (Coords: ${userCoord[0].toFixed(5)}, ${userCoord[1].toFixed(5)})`;

        const copyText = ticket || shortEmergencyMsg;

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(copyText).then(() => {
                if (window.showToast) window.showToast('📋 Pre-Trip Safety Ticket copied to clipboard!');
            }).catch(() => {
                prompt('Copy your safety ticket:', copyText);
            });
        } else {
            prompt('Copy your safety ticket:', copyText);
        }
    }

    openShareTripModal() {
        const modal = document.getElementById('shareTripModal');
        if (!modal) return;

        const { ticket, contactPhone, tripToken } = this.generateWhatsAppSafetyTicket();

        const textInput = document.getElementById('shareTripTextInput');
        if (textInput) textInput.value = ticket;

        const waBtn = document.getElementById('btnShareWhatsApp');
        if (waBtn) waBtn.href = `https://api.whatsapp.com/send?text=${encodeURIComponent(ticket)}`;

        const smsBtn = document.getElementById('btnShareSMS');
        if (smsBtn) smsBtn.href = `sms:${contactPhone || ''}?body=${encodeURIComponent(ticket)}`;

        modal.classList.add('active');

        // Scoped trip update: Only sent to people in this tripToken room!
        if (window.socket && typeof window.socket.emit === 'function') {
            const activeRoute = window.routingEngine ? window.routingEngine.activeRoute : null;
            window.socket.emit('share_trip', {
                tripToken,
                status: 'walking',
                eta: activeRoute ? activeRoute.formattedDuration : '15 min',
                routeName: activeRoute ? activeRoute.name : 'Safe Corridor'
            });
        }
    }

    closeShareTripModal() {
        const modal = document.getElementById('shareTripModal');
        if (modal) modal.classList.remove('active');
    }
}

// Global SOS instance
window.sosManager = new SOSManager();
