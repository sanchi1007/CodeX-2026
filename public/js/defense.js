/**
 * 🚨 SafeStep Defense & Deterrent Toolkit (defense.js)
 * Implements:
 * 1. 🔊 Loud Emergency Alarm (synthesized via Web Audio API with safe gain capping, clean oscillator disposal)
 * 2. 📞 Realistic "Fake Call" Deterrent Simulator (SpeechSynthesis with silent fallback, instant dismissal)
 * 3. 🔦 Restrained Emergency Visual Beacon (respects prefers-reduced-motion, one-tap stop)
 */

class DefenseToolkit {
    constructor() {
        this.audioCtx = null;
        this.sirenOsc1 = null;
        this.sirenGain = null;
        this.sirenInterval = null;
        this.isSirenPlaying = false;

        this.ringtoneInterval = null;
        this.isRinging = false;

        this.callDurationInterval = null;
        this.callSeconds = 0;
        this.isCallActive = false;

        this.isStrobeActive = false;

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanupAll());
    }

    getAudioContext() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
        return this.audioCtx;
    }

    // =========================================================================
    // 19, 20. 🔊 LOUD EMERGENCY ALARM (Safe gain capping, clean shutdown)
    // =========================================================================
    toggleSiren() {
        if (this.isSirenPlaying) {
            this.stopSiren();
            return false;
        } else {
            this.startSiren();
            return true;
        }
    }

    startSiren() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) {
                if (window.showToast) window.showToast('Audio is not supported in this browser.');
                return;
            }

            this.isSirenPlaying = true;

            // Safe maximum gain setting (capped at 0.35 to avoid audio distortion/clipping)
            this.sirenGain = ctx.createGain();
            this.sirenGain.gain.setValueAtTime(0.35, ctx.currentTime);
            this.sirenGain.connect(ctx.destination);

            this.sirenOsc1 = ctx.createOscillator();
            this.sirenOsc1.type = 'sawtooth';
            this.sirenOsc1.frequency.setValueAtTime(800, ctx.currentTime);
            this.sirenOsc1.connect(this.sirenGain);
            this.sirenOsc1.start();

            // Frequency sweep between 750Hz and 1250Hz (gentle modulating siren)
            let ascending = true;
            let freq = 800;
            this.sirenInterval = setInterval(() => {
                if (!this.isSirenPlaying || !this.sirenOsc1) return;
                freq = ascending ? freq + 40 : freq - 40;
                if (freq >= 1250) ascending = false;
                if (freq <= 750) ascending = true;
                this.sirenOsc1.frequency.setValueAtTime(freq, ctx.currentTime);
            }, 40);

            // Update UI buttons across the app
            const sirenBtns = document.querySelectorAll('.btn-siren-trigger');
            sirenBtns.forEach(btn => {
                btn.classList.add('active');
                btn.innerHTML = '⏹️ Stop Alarm';
                btn.setAttribute('aria-label', 'Stop Loud Emergency Alarm');
            });

            if (window.showToast) window.showToast('🚨 Loud emergency alarm active');
        } catch (err) {
            console.error('Error starting alarm:', err);
            this.stopSiren();
        }
    }

    stopSiren() {
        this.isSirenPlaying = false;
        if (this.sirenInterval) {
            clearInterval(this.sirenInterval);
            this.sirenInterval = null;
        }
        if (this.sirenOsc1) {
            try {
                this.sirenOsc1.stop();
                this.sirenOsc1.disconnect();
            } catch (e) {}
            this.sirenOsc1 = null;
        }
        if (this.sirenGain) {
            try {
                this.sirenGain.disconnect();
            } catch (e) {}
            this.sirenGain = null;
        }

        const sirenBtns = document.querySelectorAll('.btn-siren-trigger');
        sirenBtns.forEach(btn => {
            btn.classList.remove('active');
            btn.innerHTML = '🚨 Loud Alarm';
            btn.setAttribute('aria-label', 'Activate Loud Emergency Alarm');
        });

        if (window.showToast) window.showToast('Emergency alarm stopped.');
    }

    // =========================================================================
    // 21. 📞 FAKE INCOMING CALL SIMULATOR
    // =========================================================================
    triggerFakeCall(callerName = 'Dad (Home)') {
        const modal = document.getElementById('fakeCallModal');
        const callerNameEl = document.getElementById('fakeCallerName');
        const incomingScreen = document.getElementById('fakeCallIncomingScreen');
        const activeScreen = document.getElementById('fakeCallActiveScreen');

        if (!modal) return;

        if (callerNameEl) callerNameEl.textContent = callerName;
        if (incomingScreen) incomingScreen.style.display = 'flex';
        if (activeScreen) activeScreen.style.display = 'none';

        modal.classList.add('active');
        this.startRingtone();
    }

    startRingtone() {
        try {
            const ctx = this.getAudioContext();
            if (!ctx) return;
            this.isRinging = true;

            const playBeepPair = () => {
                if (!this.isRinging) return;
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'sine';
                osc2.type = 'sine';
                osc1.frequency.setValueAtTime(440, ctx.currentTime);
                osc2.frequency.setValueAtTime(480, ctx.currentTime);

                gain.gain.setValueAtTime(0.2, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.8);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start();
                osc2.start();
                osc1.stop(ctx.currentTime + 1.8);
                osc2.stop(ctx.currentTime + 1.8);
            };

            playBeepPair();
            this.ringtoneInterval = setInterval(playBeepPair, 3000);
        } catch (e) {
            console.error('Ringtone error:', e);
        }
    }

    stopRingtone() {
        this.isRinging = false;
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
    }

    acceptFakeCall() {
        this.stopRingtone();

        const incomingScreen = document.getElementById('fakeCallIncomingScreen');
        const activeScreen = document.getElementById('fakeCallActiveScreen');
        const timerEl = document.getElementById('fakeCallTimer');

        if (incomingScreen) incomingScreen.style.display = 'none';
        if (activeScreen) activeScreen.style.display = 'flex';

        this.isCallActive = true;
        this.callSeconds = 0;
        if (timerEl) timerEl.textContent = '00:00';

        this.callDurationInterval = setInterval(() => {
            this.callSeconds++;
            const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
            const secs = String(this.callSeconds % 60).padStart(2, '0');
            if (timerEl) timerEl.textContent = `${mins}:${secs}`;
        }, 1000);

        // Pre-recorded realistic conversational dialogue via Web Speech API
        setTimeout(() => {
            if (!this.isCallActive) return;
            if (window.voiceNavigator && typeof window.voiceNavigator.speak === 'function') {
                window.voiceNavigator.speak('Hey, where are you right now? Okay great, I am right outside waiting for you. Come straight, see you in two minutes!', true);
            }
        }, 600);
    }

    endFakeCall() {
        this.stopRingtone();
        this.isCallActive = false;

        if (this.callDurationInterval) {
            clearInterval(this.callDurationInterval);
            this.callDurationInterval = null;
        }

        const modal = document.getElementById('fakeCallModal');
        if (modal) modal.classList.remove('active');

        if (window.showToast) window.showToast('Fake call ended.');
    }

    // =========================================================================
    // 22. 🔦 EMERGENCY VISUAL BEACON (Restrained pulsing, respects reduced-motion)
    // =========================================================================
    toggleStrobe() {
        const overlay = document.getElementById('emergencyStrobeOverlay');
        if (!overlay) return;

        this.isStrobeActive = !this.isStrobeActive;
        if (this.isStrobeActive) {
            // Check prefers-reduced-motion
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (prefersReducedMotion) {
                overlay.classList.add('reduced-motion');
            } else {
                overlay.classList.remove('reduced-motion');
            }

            overlay.classList.add('active');
            if (window.showToast) window.showToast('🔦 Visual emergency beacon active. Tap screen to turn off.');
        } else {
            overlay.classList.remove('active');
        }
        return this.isStrobeActive;
    }

    cleanupAll() {
        this.stopSiren();
        this.stopRingtone();
        if (this.callDurationInterval) clearInterval(this.callDurationInterval);
        if (this.audioCtx && this.audioCtx.state !== 'closed') {
            try { this.audioCtx.close(); } catch (e) {}
        }
    }
}

// Global defense instance
window.defenseToolkit = new DefenseToolkit();
