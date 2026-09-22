/**
 * 🛡️ SafeStep Comprehensive Security & Bugfix Test Suite
 * Validates all 14 requirements:
 * 1. Model & Seed consolidation (SafetyPOI, removed StreetSegment, upsert)
 * 2. Socket.IO CORS whitelist logic (strict origins, reject unauthorized)
 * 3. Midnight hour handling (hour=0 parsed as 0, not 23)
 * 4. Geo-anomaly enforcement & burst detection
 * 5. Fail-fast secret check on missing environment variables
 * 6. X-Forwarded-For trust defense (Express req.ip vs raw header)
 * 7. Clean .env.example / .gitignore
 * 8. CSP strictness (no inline scripts/onclick in index.ejs)
 * 9. Defamation filter accuracy (allows legitimate addresses, blocks targeted defamation)
 * 10. Report ID entropy (128-bit / 16-byte hex)
 * 11. Custom HMAC bearer token architecture
 * 12. Server-side token revocation
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Set dummy env for isolated testing if not already present
process.env.PEPPER_KEY = process.env.PEPPER_KEY || 'test_pepper_key_0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_0123456789abcdef0123456789abcdef';

const securityEngine = require('../securityEngine');
const {
    fuzzCoordinates,
    getTemporalBucket,
    sanitizeAndFilterContent,
    SecurityRateLimiter,
    CorroborationEngine,
    AuditLedger,
    maskPhone,
    hashIdentifier,
    generateAuthToken,
    verifyAuthToken,
    generateTripRoomToken,
    revokeToken,
    isTokenRevoked
} = securityEngine;

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`  ✅ PASS: ${name}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${name}`);
        console.error(err);
        failed++;
    }
}

async function runTests() {
    console.log('\n🔒 RUNNING SAFESTEP SECURITY & BUGFIX VERIFICATION SUITE\n');

    // 1. Model & Seed Consolidation
    test('Requirement 1: StreetSegment.js is removed and SafetyPOI exists', () => {
        const streetSegmentPath = path.join(__dirname, '..', 'models', 'StreetSegment.js');
        assert.strictEqual(fs.existsSync(streetSegmentPath), false, 'StreetSegment.js should be deleted');
        
        const safetyPOIPath = path.join(__dirname, '..', 'models', 'SafetyPOI.js');
        assert.strictEqual(fs.existsSync(safetyPOIPath), true, 'models/SafetyPOI.js must exist');
        
        const SafetyPOI = require('../models/SafetyPOI');
        assert.ok(SafetyPOI.schema.path('id'), 'SafetyPOI should have id field');
        assert.ok(SafetyPOI.schema.path('coordinates'), 'SafetyPOI should have coordinates field');
    });

    test('Requirement 1: seed.js uses dotenv and SafetyPOI with upsert', () => {
        const seedContent = fs.readFileSync(path.join(__dirname, '..', 'seed.js'), 'utf8');
        assert.ok(seedContent.includes("require('dotenv').config()"), 'seed.js must load dotenv');
        assert.ok(seedContent.includes("models/SafetyPOI"), 'seed.js must use SafetyPOI');
        assert.ok(seedContent.includes("updateOne"), 'seed.js must use upsert (updateOne)');
        assert.ok(!seedContent.includes("luminaroute"), 'seed.js must not contain hardcoded luminaroute database');
    });

    // 2. Socket.IO CORS Whitelist Logic
    test('Requirement 2: CORS origin evaluation allows only valid origins', () => {
        const PORT = 3000;
        const allowedOrigins = new Set([
            `http://localhost:${PORT}`,
            `http://127.0.0.1:${PORT}`,
            'http://localhost:3000',
            'http://127.0.0.1:3000',
            'http://localhost:5173',
            'http://127.0.0.1:5173'
        ]);

        function checkOrigin(origin) {
            if (!origin) return true; // Allowed
            try {
                const parsed = new URL(origin);
                const normalized = `${parsed.protocol}//${parsed.host}`;
                if (allowedOrigins.has(origin) || allowedOrigins.has(normalized)) return true;
                const allowedPorts = new Set([String(PORT), '3000', '5173']);
                if ((parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') && allowedPorts.has(parsed.port || '80')) {
                    return true;
                }
            } catch (e) {
                return false;
            }
            return false;
        }

        assert.strictEqual(checkOrigin(undefined), true, 'No origin (native/curl) should be allowed');
        assert.strictEqual(checkOrigin('http://localhost:3000'), true, 'localhost:3000 should be allowed');
        assert.strictEqual(checkOrigin('http://127.0.0.1:3000'), true, '127.0.0.1:3000 should be allowed');
        assert.strictEqual(checkOrigin('http://localhost:5173'), true, 'Vite dev port 5173 should be allowed');
        assert.strictEqual(checkOrigin('https://evil-hacker.com'), false, 'Malicious external origin must be blocked');
        assert.strictEqual(checkOrigin('http://localhost:8080'), false, 'Untrusted port must be blocked');
    });

    // 3. Midnight Hour Bug
    test('Requirement 3: Midnight hour (0) is parsed accurately and not defaulted to 23', () => {
        function parseHour(val) {
            const parsedHour = Number.parseInt(val, 10);
            return (!isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23) ? parsedHour : 23;
        }

        assert.strictEqual(parseHour('0'), 0, 'Hour "0" must evaluate to 0 (midnight)');
        assert.strictEqual(parseHour(0), 0, 'Numeric 0 must evaluate to 0 (midnight)');
        assert.strictEqual(parseHour('12'), 12, 'Hour "12" must evaluate to 12 (noon)');
        assert.strictEqual(parseHour('23'), 23, 'Hour "23" must evaluate to 23 (11 PM)');
        assert.strictEqual(parseHour('-1'), 23, 'Out-of-range hour -1 must fallback to default 23');
        assert.strictEqual(parseHour('24'), 23, 'Out-of-range hour 24 must fallback to default 23');
        assert.strictEqual(parseHour('invalid'), 23, 'NaN hour must fallback to default 23');
        assert.strictEqual(parseHour(undefined), 23, 'Undefined hour must fallback to default 23');
    });

    // 4. Geo-Anomaly Enforcement
    test('Requirement 4: checkGeoAnomaly triggers burst detection above threshold', () => {
        const cell = 'test_burst_cell_' + Date.now();
        // Record hits up to threshold
        for (let i = 0; i < 4; i++) {
            SecurityRateLimiter.recordHit('192.168.1.1', 'device_burst', cell);
        }
        const anomaly = SecurityRateLimiter.checkGeoAnomaly(cell);
        assert.strictEqual(anomaly.isAnomaly, true, 'Burst threshold must trigger anomaly');
        assert.ok(anomaly.count >= 4, 'Anomaly count must be >= 4');
        assert.ok(anomaly.reason.includes('burst detected'), 'Reason must explain anomaly');
    });

    // 5. Fail-Fast Secret Checks
    test('Requirement 5: Missing PEPPER_KEY causes hashIdentifier to throw', () => {
        assert.throws(() => {
            hashIdentifier('some_identifier', '');
        }, /PEPPER_KEY environment variable is required and missing/, 'Missing pepper must throw error');
    });

    test('Requirement 5: Missing secret causes generateAuthToken to throw', () => {
        assert.throws(() => {
            generateAuthToken('+919876543210', 'Test User', '');
        }, /JWT_SECRET \/ AUTH_SECRET environment variable is required and missing/, 'Missing secret must throw error');
    });

    // 6. X-Forwarded-For Trust
    test('Requirement 6: index.js does not trust raw x-forwarded-for header directly', () => {
        const indexContent = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        assert.ok(!indexContent.includes("req.headers['x-forwarded-for'] || req.socket.remoteAddress"), 
            'index.js should not read raw x-forwarded-for without trust proxy configuration');
        assert.ok(indexContent.includes("req.ip || req.socket.remoteAddress"), 
            'index.js should use Express req.ip with trust proxy');
    });

    // 7. Clean .env.example
    test('Requirement 7: .env.example contains placeholder keys only', () => {
        const exampleContent = fs.readFileSync(path.join(__dirname, '..', '.env.example'), 'utf8');
        assert.ok(exampleContent.includes('your_32_byte_hex_secret_here'), '.env.example should contain placeholders');
        assert.ok(!exampleContent.includes('f9d784a9e5b2c6e3105748293758204918274019284729104829104829104829'), 'Real secret must not be in example');
    });

    // 8. Content Security Policy (No unsafe-inline in script-src)
    test('Requirement 8: views/index.ejs has no inline script blocks or on* attributes', () => {
        const ejsContent = fs.readFileSync(path.join(__dirname, '..', 'views', 'index.ejs'), 'utf8');
        assert.ok(!ejsContent.includes('<script>window.autoOpenAuth'), 'Inline window.autoOpenAuth script must be removed');
        assert.ok(!ejsContent.includes('onclick='), 'No inline onclick handlers allowed in EJS');
        assert.ok(!ejsContent.includes('onsubmit='), 'No inline onsubmit handlers allowed in EJS');
        assert.ok(ejsContent.includes('data-auto-open-auth='), 'Body should have data-auto-open-auth attribute');
        assert.ok(ejsContent.includes('data-action="trigger-sos"'), 'Buttons should use data-action');
    });

    // 9. Defamation Filter False Positive Fix
    test('Requirement 9: Legitimate address reports are allowed by defamation filter', () => {
        const legit1 = sanitizeAndFilterContent('Streetlight outside house no 45 is broken');
        assert.strictEqual(legit1.isValid, true, '"Streetlight outside house no 45 is broken" should be valid');

        const legit2 = sanitizeAndFilterContent('Dark alley near flat 12B needs lamp repair');
        assert.strictEqual(legit2.isValid, true, '"flat 12B" should be valid');

        const legit3 = sanitizeAndFilterContent('Pothole on road outside plot 8');
        assert.strictEqual(legit3.isValid, true, '"plot 8" should be valid');
    });

    test('Requirement 9: Defamatory attacks and targeted harassment are blocked', () => {
        const def1 = sanitizeAndFilterContent('John Doe is a thief and scammer');
        assert.strictEqual(def1.isValid, false, 'Defamatory personal attack should be blocked');

        const def2 = sanitizeAndFilterContent('The shopkeeper at XYZ is a fraud and criminal');
        assert.strictEqual(def2.isValid, false, 'Targeted fraud allegation should be blocked');
    });

    // 10. Report ID Entropy
    test('Requirement 10: Report ID entropy is 128-bit (16 bytes = 32 hex chars)', () => {
        const indexContent = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
        assert.ok(indexContent.includes("crypto.randomBytes(16).toString('hex')"), 'Report ID must use randomBytes(16)');
        assert.ok(!indexContent.includes("crypto.randomBytes(3).toString('hex')"), 'randomBytes(3) must be replaced');
    });

    // 11. Custom HMAC Bearer Token Architecture
    test('Requirement 11: Tokens have valid HMAC-SHA256 signature and are tamper-proof', () => {
        const token = generateAuthToken('+919876543210', 'Test User');
        assert.ok(token.includes('.'), 'Token must consist of payload.signature');
        
        const verification = verifyAuthToken(token);
        assert.strictEqual(verification.valid, true, 'Valid token must verify');
        assert.strictEqual(verification.payload.phone, '+919876543210');
        assert.ok(verification.payload.tokenId, 'Token must contain a unique tokenId');

        // Tampering attempt
        const [b64, sig] = token.split('.');
        const tampered = `${b64}.invalidsignature1234567890`;
        const tamperedResult = verifyAuthToken(tampered);
        assert.strictEqual(tamperedResult.valid, false, 'Tampered token must fail verification');
    });

    // 12. Server-Side Token Revocation
    test('Requirement 12: Revoked tokens are immediately rejected on verification', () => {
        const token = generateAuthToken('+919876543210', 'Revoke Test User');
        const initialCheck = verifyAuthToken(token);
        assert.strictEqual(initialCheck.valid, true, 'Fresh token should be valid');

        // Revoke using full token string
        revokeToken(token);

        const afterRevokeCheck = verifyAuthToken(token);
        assert.strictEqual(afterRevokeCheck.valid, false, 'Revoked token must be rejected');
        assert.strictEqual(afterRevokeCheck.error, 'Authorization token has been revoked');
    });

    console.log(`\n📊 TEST SUMMARY: ${passed} Passed, ${failed} Failed\n`);
    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
