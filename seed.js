require('dotenv').config();
const mongoose = require('mongoose');
const SafetyPOI = require('./models/SafetyPOI');
const initialSafetyPOIs = require('./data/safetyPOIs.json');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/safestep';

async function seedDatabase() {
    try {
        console.log(`📡 Connecting to MongoDB at ${MONGO_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')} for seeding...`);
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        console.log('✅ Connected to MongoDB for seeding.');

        // Seed Safety POIs using upsert by unique 'id' to prevent duplicate entries
        const bulkOps = initialSafetyPOIs.map(poi => ({
            updateOne: {
                filter: { id: poi.id },
                update: { $set: poi },
                upsert: true
            }
        }));

        const result = await SafetyPOI.bulkWrite(bulkOps);
        const totalCount = await SafetyPOI.countDocuments();

        console.log(`✅ Seeded / Synchronized ${initialSafetyPOIs.length} Safety POIs in MongoDB.`);
        console.log(`   Upserted: ${result.upsertedCount}, Modified: ${result.modifiedCount}, Matched: ${result.matchedCount}`);
        console.log(`   Total Safety POIs currently in database: ${totalCount}`);

        await mongoose.disconnect();
        console.log('🍃 Disconnected from MongoDB cleanly.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seeding error:', err.message);
        process.exit(1);
    }
}

seedDatabase();
