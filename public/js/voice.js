/**
 * 🔊 SafeStep Hands-Free Voice Navigation Engine
 * Uses the Web Speech API (SpeechSynthesis) to announce turn instructions,
 * safety alerts, deviation notifications, and arrival safely aloud.
 */
class VoiceNavigator {
    constructor() {
        this.synth = window.speechSynthesis;
        this.isEnabled = true; // Voice ON by default
        this.isMuted = false;
        this.voice = null;
        this.rate = 1.0;
        this.pitch = 1.0;
        this.lastSpokenText = '';
        this.lastSpokenTime = 0;

        this.initVoice();
    }

    initVoice() {
        if (!('speechSynthesis' in window)) {
            console.warn('SpeechSynthesis API not supported in this browser.');
            this.isEnabled = false;
            return;
        }

        const setVoice = () => {
            const voices = this.synth.getVoices();
            // Prefer a clear English voice (Google US/UK, Samantha, or natural English)
            this.voice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural') || v.name.includes('Samantha') || v.name.includes('Female'))) 
                         || voices.find(v => v.lang.startsWith('en')) 
                         || voices[0];
        };

        setVoice();
        if (this.synth.onvoiceschanged !== undefined) {
            this.synth.onvoiceschanged = setVoice;
        }
    }

    speak(text, priority = false) {
        if (!this.isEnabled || this.isMuted || !this.synth) return;
        if (!text || text.trim() === '') return;

        const now = Date.now();
        // Prevent repeating the same instruction within 7 seconds unless it's high priority
        if (!priority && text === this.lastSpokenText && (now - this.lastSpokenTime < 7000)) {
            return;
        }

        // Cancel previous speech if priority (e.g. immediate turn or safety warning)
        if (priority) {
            this.synth.cancel();
        }

        const utterance = new SpeechSynthesisUtterance(text);
        if (this.voice) utterance.voice = this.voice;
        utterance.rate = this.rate;
        utterance.pitch = this.pitch;

        this.lastSpokenText = text;
        this.lastSpokenTime = now;

        this.synth.speak(utterance);
    }

    announceManeuver(instruction, distanceMeters) {
        if (distanceMeters <= 25) {
            this.speak(`${instruction} now.`, true);
        } else if (distanceMeters <= 120) {
            this.speak(`In ${distanceMeters} meters, ${instruction}.`);
        } else {
            this.speak(`${instruction}. Continue for ${distanceMeters} meters.`);
        }
    }

    announceSafetyAlert(message) {
        this.speak(`Safety Notice: ${message}`, true);
    }

    announceDeviation() {
        this.speak('You have moved away from the safe route. Recalculating path.', true);
    }

    announceArrival() {
        this.speak('You have safely arrived at your destination.', true);
    }

    toggle() {
        this.isEnabled = !this.isEnabled;
        if (!this.isEnabled) {
            this.synth.cancel();
        }
        return this.isEnabled;
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.synth.cancel();
        }
        return this.isMuted;
    }
}

// Global voice instance
window.voiceNavigator = new VoiceNavigator();
