/**
 * 🛡️ SafeStep Offline Fallback Routing Unit Test
 * Verifies that when OSRM external routing is unreachable:
 * - Route calculation falls back gracefully to offline Manhattan grid routing
 * - Full road coordinates are synthesized (> 20 coordinates)
 * - Turn-by-turn road steps (> 3 steps) are generated with real maneuvers
 * - Zero live network dependency (fetch failure is mocked)
 */

const assert = require('assert');
const http = require('http');

// Set required environment variables
process.env.PORT = 0;
process.env.PEPPER_KEY = 'test_pepper_key_0123456789abcdef0123456789abcdef';
process.env.JWT_SECRET = 'test_jwt_secret_0123456789abcdef0123456789abcdef';

// Mock global.fetch to simulate complete network outage for OSRM
const originalFetch = global.fetch;
global.fetch = async (url) => {
    // Simulate network error for any external router URL
    throw new Error(`[Mock Fetch] Simulated offline network error for ${url}`);
};

const { app } = require('../index');

function makeRequest(server, options) {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        const reqOptions = {
            hostname: '127.0.0.1',
            port: addr.port,
            ...options
        };

        const req = http.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(data);
                } catch (e) {
                    parsed = data;
                }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });

        req.on('error', reject);
        req.end();
    });
}

async function runOfflineRoutingTests() {
    console.log('\n🧭 RUNNING OFFLINE FALLBACK ROUTING UNIT TESTS (MOCKED FETCH)\n');
    let passed = 0;
    let failed = 0;

    const testServer = http.createServer(app);
    await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));

    try {
        const res = await makeRequest(testServer, {
            path: '/api/route/road?originLat=19.1673&originLng=72.9392&destLat=19.1764&destLng=72.9463&hour=23&destName=Offline%20Sanctuary&originName=Offline%20Start',
            method: 'GET'
        });

        assert.strictEqual(res.status, 200, 'Offline fallback route calculation must return HTTP 200');
        assert.strictEqual(res.body.success, true, 'Response success must be true');
        assert.ok(Array.isArray(res.body.routes), 'Routes must be an array');
        assert.ok(res.body.routes.length >= 2, 'At least safest and fastest fallback routes must exist');

        const safest = res.body.routes.find(r => r.routeId === 'safest');
        const fastest = res.body.routes.find(r => r.routeId === 'fastest');
        const normal = res.body.routes.find(r => r.routeId === 'normal');

        assert.ok(safest, 'Safest fallback route must exist');
        assert.ok(fastest, 'Fastest fallback route must exist');
        assert.ok(normal, 'Normal fallback route must exist');

        // Check coordinates length (> 20 points)
        assert.ok(safest.coordinates.length > 20, `Safest route coordinates (${safest.coordinates.length}) must be > 20 points`);
        assert.ok(fastest.coordinates.length > 20, `Fastest route coordinates (${fastest.coordinates.length}) must be > 20 points`);

        // Check turn-by-turn steps length (> 3 steps)
        assert.ok(safest.steps.length > 3, `Safest route steps (${safest.steps.length}) must be > 3 steps`);
        assert.ok(fastest.steps.length > 3, `Fastest route steps (${fastest.steps.length}) must be > 3 steps`);

        // Validate step structure format
        [safest, fastest].forEach(route => {
            route.steps.forEach((step, idx) => {
                assert.strictEqual(typeof step.stepIndex, 'number', `Step ${idx} must have numeric stepIndex`);
                assert.ok(step.instruction && step.instruction.length > 0, `Step ${idx} must have an instruction`);
                assert.ok(step.streetName && step.streetName.length > 0, `Step ${idx} must have a streetName`);
                assert.strictEqual(typeof step.distanceMeters, 'number', `Step ${idx} must have numeric distanceMeters`);
                assert.ok(step.formattedDistance, `Step ${idx} must have formattedDistance`);
                assert.ok(step.icon, `Step ${idx} must have an icon`);
                assert.ok(Array.isArray(step.location) && step.location.length === 2, `Step ${idx} must have valid [lat, lng] location`);
            });

            // First step must be departure
            assert.strictEqual(route.steps[0].icon, '🚶', 'First step must have pedestrian icon');
            assert.ok(route.steps[0].instruction.startsWith('Head'), 'First step must be a Head/Depart instruction');

            // Final step must be arrival
            const lastStep = route.steps[route.steps.length - 1];
            assert.strictEqual(lastStep.icon, '🏁', 'Final step must have destination flag icon');
            assert.ok(lastStep.instruction.startsWith('Arrive at'), 'Final step must be an Arrive instruction');
        });

        console.log('  ✅ PASS: Offline fallback synthesizes > 20 coordinates and > 3 turn-by-turn road steps without network');
        passed++;
    } catch (e) {
        console.error('  ❌ FAIL: Offline fallback routing test failed', e);
        failed++;
    } finally {
        global.fetch = originalFetch;
        await new Promise((resolve) => testServer.close(resolve));
    }

    console.log(`\n📊 OFFLINE ROUTING SUMMARY: ${passed} Passed, ${failed} Failed\n`);
    if (failed > 0) process.exit(1);
    process.exit(0);
}

runOfflineRoutingTests();
