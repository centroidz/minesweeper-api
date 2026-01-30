const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIG ---
const MONGO_URI = process.env.MONGODB_URI;
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    name: String,
    picture: String,
    highScore: { type: Number, default: 0 }
});

// PREVENT OVERWRITE ERROR: Check if model exists before defining
const User = mongoose.models.User || mongoose.model('User', userSchema);

// --- ROBUST DB CONNECTION (The Fix) ---
let isConnected = false; // Track connection status

async function connectToDatabase() {
    if (isConnected) {
        return; // Already connected, skip logic
    }

    if (!MONGO_URI) {
        throw new Error("MONGODB_URI is missing in Environment Variables");
    }

    try {
        // Prepare connection options
        const db = await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Fail fast if IP is blocked
            bufferCommands: false // Disable buffering to see real errors immediately
        });

        isConnected = db.connections[0].readyState;
        console.log("--> MongoDB Connected Successfully");
    } catch (error) {
        console.error("--> MongoDB Connection Failed:", error);
        throw error; // Stop execution if DB fails
    }
}

// --- MIDDLEWARE ---

// Domain security middleware for kireitours.asia
function checkDomain(req, res, next) {
    const origin = req.get('origin');
    const referer = req.get('referer');
    
    const allowedDomain = 'kireitours.asia';
    
    // Check origin header first (preferred for CORS)
    if (origin) {
        const originDomain = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
        if (originDomain === allowedDomain || originDomain.endsWith('.' + allowedDomain)) {
            return next();
        }
    }
    
    // Fallback to referer header
    if (referer) {
        const refererDomain = referer.replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
        if (refererDomain === allowedDomain || refererDomain.endsWith('.' + allowedDomain)) {
            return next();
        }
    }
    
    // Reject if neither header matches
    return res.status(403).json({ error: 'Access denied: Invalid domain' });
}

// --- ENDPOINTS ---

app.post('/api/sync-score', checkDomain, async (req, res) => {
    try {
        await connectToDatabase(); // <--- CALL THIS inside every route

        const { token, currentScore } = req.body;
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID,
        });
        const { sub: googleId, name, picture } = ticket.getPayload();

        let user = await User.findOne({ googleId });

        if (!user) {
            user = new User({ googleId, name, picture, highScore: currentScore || 0 });
        } else {
            user.name = name;
            user.picture = picture;
            if (currentScore > user.highScore) {
                user.highScore = currentScore;
            }
        }
        await user.save();
        res.json({ success: true, highScore: user.highScore, name: user.name });

    } catch (error) {
        console.error("Sync Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        await connectToDatabase(); // <--- CALL THIS inside every route

        const topPlayers = await User.find({}, 'name picture highScore')
            .sort({ highScore: -1 })
            .limit(10)
            .lean(); // .lean() makes it faster
            
        res.json(topPlayers);
    } catch (error) {
        console.error("Leaderboard Error:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send("Minesweeper API Online"));

module.exports = app;