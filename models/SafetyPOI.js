const mongoose = require('mongoose');

const SafetyPOISchema = new mongoose.Schema({
    id: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true },
    coordinates: { type: [Number], required: true },
    address: { type: String, default: '' },
    phone: { type: String, default: '112' },
    isOpen24x7: { type: Boolean, default: false },
    description: { type: String, default: '' },
    source: { type: String, default: 'demo' }
}, { timestamps: true });

module.exports = mongoose.models.SafetyPOI || mongoose.model('SafetyPOI', SafetyPOISchema);
