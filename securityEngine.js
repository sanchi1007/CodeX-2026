/**
 * 🛡️ SafeStep Security & Anti-Abuse Engine (securityEngine.js)
 * Implements:
 * 1. Sybil / Brigading Defense with N >= 2 Corroboration Clustering
 * 2. Geo-Fuzzing / Street-Segment Grid Snapping (De-Anonymization Defense)
 * 3. Temporal Generalization (k-Anonymity Time Bucketing)
 * 4. Multi-Tier Rate Limiting with Auto-Pruning & Memory Leak Defense
 * 5. Cryptographic Immutable Audit Ledger (SHA-256 Chained Event Log)
 * 6. Automated Anti-Defamation & XSS Sanitization Filter
 * 7. PII Masking & Reporter Identity Decoupling
 * 8. Zero-Trust Custom HMAC Bearer Auth Tokens (BOLA / IDOR Defense & Revocation)
 * 9. Cryptographic Trip Room Tokens (Stalker Surveillance Defense)
 */

const crypto = require('crypto');

// =========================================================================
// 1. 🌐 GEO-FUZZING & DE-ANONYMIZATION DEFENSE
// Snaps raw coordinates to ~100m–120m street segments (3 decimal places)
// Discards raw pinpoint coordinates immediately to protect victim whereabouts
// =========================================================================
function fuzzCoordinates(coords) {
    if (!coords || !Array.isArray(coords) || coords.length < 2) {
        return [19.188, 77.280];
    }
    const lat = parseFloat(coords[0]);
    const lng = parseFloat(coords[1]);
    if (isNaN(lat) || isNaN(lng)) return [19.188, 77.280];

    // 3 decimal places = ~110m resolution (coarse street block grid)
    const fuzzedLat = Math.round(lat * 1000) / 1000;
    const fuzzedLng = Math.round(lng * 1000) / 1000;
    return [fuzzedLat, fuzzedLng];
}

// =========================================================================
// 2. ⏱️ TEMPORAL GENERALIZATION (TIME BUCKETING)
// Never exposes exact minute timestamps publicly; groups into 2-hour buckets
// =========================================================================
function getTemporalBucket(date = new Date()) {
    const d = (date instanceof Date && !isNaN(date)) ? date : new Date();
    const hour = d.getHours();
    const bucketStart = Math.floor(hour / 2) * 2;
    const bucketEnd = (bucketStart + 2) % 24;

    const formatHour = (h) => {
        const period = h >= 12 ? 'PM' : 'AM';
        const num = h % 12 === 0 ? 12 : h % 12;
        return `${num}:00 ${period}`;
    };

    let timeOfDay = 'Daylight Hours';
    if (bucketStart >= 20 || bucketStart < 5) timeOfDay = 'Night Corridor';
    else if (bucketStart >= 17) timeOfDay = 'Evening Twilight';
    else if (bucketStart < 8) timeOfDay = 'Early Morning';

    const rangeLabel = `${formatHour(bucketStart)} – ${formatHour(bucketEnd)}`;
    const dateStr = d.toISOString().split('T')[0];
    const bucketId = `${dateStr}_h${bucketStart}-${bucketEnd}`;

    return {
        bucketId,
        rangeLabel,
        timeOfDay,
        isNight: (bucketStart >= 20 || bucketStart < 5)
    };
}

// =========================================================================
// 3. 🛡️ ANTI-DEFAMATION & STORED XSS CONTENT FILTER
// Restricts free text to environmental conditions, blocks personal naming/phones
// =========================================================================
function sanitizeAndFilterContent(text) {
    if (!text || typeof text !== 'string') {
        return { isValid: true, sanitizedText: 'General safety condition reported', violation: null };
    }

    const raw = text.trim();

    // 1. Phone number pattern check (anti-doxxing)
    const phonePattern = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/;
    if (phonePattern.test(raw)) {
        return {
            isValid: false,
            sanitizedText: '',
            violation: 'Personal phone numbers cannot be submitted in public safety reports to protect privacy.'
        };
    }

    // 2. Personal naming / defamation detection
    // Revised logic: Allows neutral civic/location landmarks (e.g. "streetlight outside house no 45 is broken",
    // "pothole near flat 3") while blocking personal targeting, doxxing, and defamation.
    const defamationPatterns = [
        // Targeting specific named individuals
        /\b(?:mr|mrs|ms|dr)\.?\s+[A-Za-z]{2,}/i,
        /\b(?:named|name is|person named)\s+[A-Za-z]{2,}/i,
        // Directing private communication or doxxing calls
        /\b(?:call him|call her|reach out to|contact him|contact her)\b/i,
        // Accusatory / defamatory labels targeted at individuals or character attacks
        /\b(?:thief|cheat|fraud|criminal|scammer|harasser|pervert|creep|molester|drunkard)\b/i,
        // Defamation explicitly targeting a residential address
        /\b(?:lives at|residing at|staying at)\s+(?:house|flat|plot|room|apt|apartment)\b/i
    ];

    for (const pattern of defamationPatterns) {
        if (pattern.test(raw)) {
            return {
                isValid: false,
                sanitizedText: '',
                violation: 'Reports must describe physical road or environmental conditions (e.g. broken lights, debris). Naming specific individuals, character allegations, or personal doxxing is prohibited.'
            };
        }
    }

    // 3. Strict HTML entity escaping to neutralize stored XSS
    const sanitized = raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');

    return {
        isValid: true,
        sanitizedText: sanitized.substring(0, 240),
        violation: null
    };
}

// =========================================================================
// 4. 🚦 MULTI-TIER RATE LIMITER & ANOMALY DETECTOR (WITH MEMORY LEAK DEFENSE)
// Thwarts automated flood attacks, Sybil swarms, and geo-brigades
// Includes auto-pruning to eliminate unbounded memory growth DoS
// =========================================================================
class SecurityRateLimiter {
    constructor() {
        this.ipHits = new Map();         // ip -> Array<timestamp>
        this.deviceHits = new Map();     // deviceHash -> Array<timestamp>
        this.geoClusterHits = new Map(); // cellKey -> Array<{ timestamp, deviceHash, ip }>
        this.WINDOW_MS = 10 * 60 * 1000; // 10 minutes
        this.MAX_PER_IP = 5;
        this.MAX_PER_DEVICE = 3;
        this.BURST_THRESHOLD = 4;        // Anomaly threshold for same cell in 3 mins
        this.MAX_ENTRIES = 2000;         // Memory-capping guard against memory exhaustion DoS

        // Memory cleanup interval every 3 minutes
        setInterval(() => this.pruneAll(), 3 * 60 * 1000).unref();
    }

    cleanOldHits(hits, now, windowMs) {
        return hits.filter(t => (now - t) < windowMs);
    }

    pruneAll() {
        const now = Date.now();
        for (const [ip, hits] of this.ipHits.entries()) {
            const clean = this.cleanOldHits(hits, now, this.WINDOW_MS);
            if (clean.length === 0) this.ipHits.delete(ip);
            else this.ipHits.set(ip, clean);
        }
        for (const [dev, hits] of this.deviceHits.entries()) {
            const clean = this.cleanOldHits(hits, now, this.WINDOW_MS);
            if (clean.length === 0) this.deviceHits.delete(dev);
            else this.deviceHits.set(dev, clean);
        }
        for (const [cell, hits] of this.geoClusterHits.entries()) {
            const clean = hits.filter(item => (now - item.timestamp) < (3 * 60 * 1000));
            if (clean.length === 0) this.geoClusterHits.delete(cell);
            else this.geoClusterHits.set(cell, clean);
        }
    }

    checkLimit(ip, deviceHash) {
        const now = Date.now();

        // 1. IP rate limit check
        const rawIpHits = this.ipHits.get(ip) || [];
        const cleanIpHits = this.cleanOldHits(rawIpHits, now, this.WINDOW_MS);
        if (cleanIpHits.length >= this.MAX_PER_IP) {
            return {
                allowed: false,
                reason: 'Rate limit reached: Maximum 5 reports per 10 minutes from this network.',
                retryAfterSec: Math.ceil((cleanIpHits[0] + this.WINDOW_MS - now) / 1000)
            };
        }

        // 2. Device token rate limit check
        if (deviceHash) {
            const rawDevHits = this.deviceHits.get(deviceHash) || [];
            const cleanDevHits = this.cleanOldHits(rawDevHits, now, this.WINDOW_MS);
            if (cleanDevHits.length >= this.MAX_PER_DEVICE) {
                return {
                    allowed: false,
                    reason: 'Device rate limit reached: Maximum 3 reports per 10 minutes per device.',
                    retryAfterSec: Math.ceil((cleanDevHits[0] + this.WINDOW_MS - now) / 1000)
                };
            }
        }

        return { allowed: true };
    }

    recordHit(ip, deviceHash, cellKey) {
        const now = Date.now();

        // Memory cap check
        if (this.ipHits.size > this.MAX_ENTRIES) this.pruneAll();

        // Record IP hit
        const ipList = this.cleanOldHits(this.ipHits.get(ip) || [], now, this.WINDOW_MS);
        ipList.push(now);
        this.ipHits.set(ip, ipList);

        // Record Device hit
        if (deviceHash) {
            const devList = this.cleanOldHits(this.deviceHits.get(deviceHash) || [], now, this.WINDOW_MS);
            devList.push(now);
            this.deviceHits.set(deviceHash, devList);
        }

        // Record Geo-cluster hit for anomaly detection (3-minute burst detection)
        if (cellKey) {
            const geoList = (this.geoClusterHits.get(cellKey) || []).filter(item => (now - item.timestamp) < (3 * 60 * 1000));
            geoList.push({ timestamp: now, deviceHash, ip });
            this.geoClusterHits.set(cellKey, geoList);
        }
    }

    checkGeoAnomaly(cellKey) {
        const now = Date.now();
        const geoList = (this.geoClusterHits.get(cellKey) || []).filter(item => (now - item.timestamp) < (3 * 60 * 1000));
        if (geoList.length >= this.BURST_THRESHOLD) {
            return {
                isAnomaly: true,
                count: geoList.length,
                threshold: this.BURST_THRESHOLD,
                reason: `Suspicious submission burst detected (${geoList.length} reports in spatial cell within 3 minutes). Submission blocked.`
            };
        }
        return { isAnomaly: false, count: geoList.length, threshold: this.BURST_THRESHOLD };
    }
}

// =========================================================================
// 5. 🤝 CORROBORATION & SYBIL BRIGADING DEFENSE ENGINE
// Requires N >= 2 independent verified/corroborated sources before a report
// is allowed to impact public route safety scores or appear as a confirmed hazard
// =========================================================================
class CorroborationEngine {
    constructor() {
        this.clusters = new Map(); // cellKey -> clusterData
        this.CORROBORATION_THRESHOLD = 2; // N = 2 independent sources required
    }

    getCellKey(coords, bucketId) {
        return `${coords[0].toFixed(3)}_${coords[1].toFixed(3)}_${bucketId}`;
    }

    evaluateReportCorroboration({ reportId, coords, bucketId, deviceHash, ipHash, source }) {
        // Pre-verified or municipal demo data is immediately trusted
        if (source === 'verified' || source === 'demo' || source === 'authority') {
            return {
                isCorroborated: true,
                corroborationCount: 2,
                status: 'verified',
                corroborationNotice: 'Verified authoritative safety record'
            };
        }

        const cellKey = this.getCellKey(coords, bucketId);
        let cluster = this.clusters.get(cellKey);

        if (!cluster) {
            cluster = {
                cellKey,
                reportIds: [],
                uniqueDevices: new Set(),
                uniqueIps: new Set(),
                firstSeen: new Date().toISOString(),
                isCorroborated: false
            };
            this.clusters.set(cellKey, cluster);
        }

        cluster.reportIds.push(reportId);
        if (deviceHash) cluster.uniqueDevices.add(deviceHash);
        if (ipHash) cluster.uniqueIps.add(ipHash);

        const independentSources = Math.max(cluster.uniqueDevices.size, cluster.uniqueIps.size);
        const isCorroborated = independentSources >= this.CORROBORATION_THRESHOLD;
        cluster.isCorroborated = isCorroborated;

        return {
            isCorroborated,
            corroborationCount: independentSources,
            status: isCorroborated ? 'corroborated' : 'pending_corroboration',
            cellKey,
            corroborationNotice: isCorroborated
                ? `Confirmed by ${independentSources} independent community reports in this corridor`
                : 'Under community corroboration (1 report; pending independent confirmation)'
        };
    }
}

// =========================================================================
// 6. ⛓️ IMMUTABLE CRYPTOGRAPHIC AUDIT LEDGER (SHA-256 EVENT CHAINING)
// Tamper-evident trail for moderation disputes, audit, and legal transparency
// Bounded to 1000 in-memory blocks to prevent memory exhaustion
// =========================================================================
class AuditLedger {
    constructor() {
        this.chain = [];
        this.MAX_CHAIN_MEMORY = 1000;
        // Genesis block
        const genesis = {
            index: 0,
            timestamp: '2026-01-01T00:00:00.000Z',
            action: 'GENESIS',
            targetType: 'SYSTEM',
            targetId: 'safestep-security-ledger',
            actorHash: 'system',
            details: 'SafeStep Security & Integrity Ledger Initialized',
            previousHash: '0000000000000000000000000000000000000000000000000000000000000000'
        };
        genesis.hash = this.computeHash(genesis);
        this.chain.push(genesis);
    }

    computeHash(block) {
        const payload = `${block.index}|${block.timestamp}|${block.action}|${block.targetType}|${block.targetId}|${block.actorHash}|${JSON.stringify(block.details)}|${block.previousHash}`;
        return crypto.createHash('sha256').update(payload).digest('hex');
    }

    recordEvent({ action, targetType, targetId, actorHash, details }) {
        const lastBlock = this.chain[this.chain.length - 1];
        const newBlock = {
            index: this.chain.length,
            timestamp: new Date().toISOString(),
            action: action || 'EVENT',
            targetType: targetType || 'REPORT',
            targetId: targetId || 'unknown',
            actorHash: actorHash || 'anonymous',
            details: details || {},
            previousHash: lastBlock.hash
        };
        newBlock.hash = this.computeHash(newBlock);
        this.chain.push(newBlock);

        // Memory bound cap: keep genesis + latest blocks
        if (this.chain.length > this.MAX_CHAIN_MEMORY) {
            this.chain = [this.chain[0], ...this.chain.slice(-(this.MAX_CHAIN_MEMORY - 1))];
        }

        return newBlock;
    }

    verifyIntegrity() {
        for (let i = 1; i < this.chain.length; i++) {
            const current = this.chain[i];
            const previous = this.chain[i - 1];

            if (current.previousHash !== previous.hash) {
                return { isValid: false, brokenAt: i, error: 'Previous hash mismatch' };
            }
            if (current.hash !== this.computeHash(current)) {
                return { isValid: false, brokenAt: i, error: 'Block hash payload altered' };
            }
        }
        return { isValid: true, blockCount: this.chain.length, headHash: this.chain[this.chain.length - 1].hash };
    }

    getRecentLogs(limit = 20) {
        return this.chain.slice(-limit).map(b => ({
            index: b.index,
            timestamp: b.timestamp,
            action: b.action,
            targetType: b.targetType,
            targetId: b.targetId,
            details: b.details,
            hash: b.hash
        }));
    }
}

// =========================================================================
// 7. 🔒 PII MASKING & HASHING UTILITIES
// =========================================================================
function maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return '';
    const clean = phone.trim();
    if (clean.length <= 5) return '***';
    return clean.slice(0, 3) + '******' + clean.slice(-4);
}

function hashIdentifier(val, pepper = process.env.PEPPER_KEY) {
    if (!pepper) {
        throw new Error('PEPPER_KEY environment variable is required and missing.');
    }
    if (!val) return 'anon_' + Math.random().toString(36).substring(2, 8);
    return crypto.createHmac('sha256', pepper).update(String(val)).digest('hex').substring(0, 16);
}

// =========================================================================
// 8. 🛡️ ZERO-TRUST HMAC AUTHENTICATION TOKENS (BOLA / IDOR DEFENSE)
// Custom compact authenticated token format: base64url(payload).HMAC-SHA256(payload)
//
// ⚠️ ARCHITECTURAL NOTICE FOR DEVELOPERS:
// This is a lightweight, custom HMAC-signed authorization bearer token format.
// It is NOT a standard RFC 7519 JSON Web Token (JWT), as it purposefully omits
// the JOSE header for minimal byte overhead on cellular networks.
//
// Security guarantees provided:
// - Authenticity & Integrity: Tamper-proof HMAC-SHA256 signature
// - Anti-Timing Attacks: Verified using crypto.timingSafeEqual
// - Token Revocation: Server-side tracking via tokenId blacklisting
// - Expiration: Enforced timestamp expiry
// =========================================================================

// In-memory token revocation cache (tokenId -> expiry timestamp)
const revokedTokens = new Map();

// Periodic pruning of expired revoked tokens to prevent memory growth (every 10 min)
setInterval(() => {
    const now = Date.now();
    for (const [tId, exp] of revokedTokens.entries()) {
        if (exp <= now) {
            revokedTokens.delete(tId);
        }
    }
}, 10 * 60 * 1000).unref();

function revokeToken(tokenIdOrToken, exp) {
    if (!tokenIdOrToken) return;
    let tId = tokenIdOrToken;
    let expiry = exp;
    if (typeof tokenIdOrToken === 'string' && tokenIdOrToken.includes('.')) {
        try {
            const [b64Payload] = tokenIdOrToken.split('.');
            const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
            if (payload.tokenId) tId = payload.tokenId;
            if (payload.exp) expiry = payload.exp;
        } catch (e) {}
    }
    if (tId) {
        revokedTokens.set(tId, expiry || (Date.now() + 30 * 24 * 60 * 60 * 1000));
    }
}

function isTokenRevoked(tokenId) {
    if (!tokenId) return false;
    return revokedTokens.has(tokenId);
}

function generateAuthToken(phone, name, secret = (process.env.AUTH_SECRET || process.env.JWT_SECRET)) {
    if (!secret) {
        throw new Error('JWT_SECRET / AUTH_SECRET environment variable is required and missing.');
    }
    const tokenId = crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const payload = JSON.stringify({
        phone: String(phone).trim(),
        name: String(name || '').trim(),
        tokenId,
        iat: now,
        exp: now + (30 * 24 * 60 * 60 * 1000) // 30-day token
    });
    const b64Payload = Buffer.from(payload).toString('base64url');
    const signature = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');
    return `${b64Payload}.${signature}`;
}

function verifyAuthToken(token, secret = (process.env.AUTH_SECRET || process.env.JWT_SECRET)) {
    if (!secret) {
        return { valid: false, error: 'Authentication secret configuration is missing' };
    }
    if (!token || typeof token !== 'string' || !token.includes('.')) {
        return { valid: false, error: 'Malformed or missing authorization token' };
    }
    const [b64Payload, signature] = token.split('.');
    const expectedSig = crypto.createHmac('sha256', secret).update(b64Payload).digest('base64url');

    // Timing-safe signature verification to thwart timing attacks
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false, error: 'Invalid cryptographic token signature' };
    }

    try {
        const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) {
            return { valid: false, error: 'Authorization token expired' };
        }
        // Enforce token revocation check
        if (payload.tokenId && isTokenRevoked(payload.tokenId)) {
            return { valid: false, error: 'Authorization token has been revoked' };
        }
        return { valid: true, payload };
    } catch (e) {
        return { valid: false, error: 'Invalid token payload' };
    }
}

// =========================================================================
// 9. 📍 CRYPTOGRAPHIC TRIP ROOM TOKEN (STALKER SURVEILLANCE DEFENSE)
// Generates unguessable 128-bit room IDs for 1-to-1 guardian tracking
// =========================================================================
function generateTripRoomToken() {
    return 'trip_' + crypto.randomBytes(16).toString('hex');
}

module.exports = {
    fuzzCoordinates,
    getTemporalBucket,
    sanitizeAndFilterContent,
    SecurityRateLimiter: new SecurityRateLimiter(),
    CorroborationEngine: new CorroborationEngine(),
    AuditLedger: new AuditLedger(),
    maskPhone,
    hashIdentifier,
    generateAuthToken,
    verifyAuthToken,
    generateTripRoomToken,
    revokeToken,
    isTokenRevoked
};
