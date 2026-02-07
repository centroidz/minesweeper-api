const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();

// --- 1. ALLOWED ORIGINS ---
const ALLOWED_ORIGINS = [
    'https://kireitours.asia',        // Your Website
    'https://www.kireitours.asia',    // Your Website (www)
    'http://localhost',               // Android App (Standard Capacitor)
    'https://localhost',              // Android App (Secure Capacitor)
    'capacitor://localhost',          // iOS/Android Hybrid
    'http://localhost:3000'           // Local Testing
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (Mobile apps, Curl, Postman)
        if (!origin) return callback(null, true);
        
        if (ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.kireitours.asia')) {
            callback(null, true);
        } else {
            console.log("Blocked by CORS:", origin); // Helpful for debugging
            callback(new Error('Not allowed by CORS'));
        }
    }
}));
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

const User = mongoose.models.User || mongoose.model('User', userSchema);

// --- DB CONNECTION ---
let isConnected = false; 

async function connectToDatabase() {
    if (isConnected) return;
    if (!MONGO_URI) throw new Error("MONGODB_URI is missing");

    try {
        const db = await mongoose.connect(MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            bufferCommands: false
        });
        isConnected = db.connections[0].readyState;
        console.log("--> MongoDB Connected");
    } catch (error) {
        console.error("--> MongoDB Connection Failed:", error);
        throw error;
    }
}

// --- ENDPOINTS ---

// Note: I removed the 'checkDomain' middleware because it breaks Android apps.
// The CORS check above + Google Token verification below is sufficient security.

app.post('/api/sync-score', async (req, res) => {
    try {
        await connectToDatabase();

        const { token, currentScore } = req.body;
        
        // --- REAL SECURITY CHECK ---
        // This ensures the request comes from a real Google user.
        // Postman cannot fake this!
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
            // Only update if score is higher
            if (currentScore > user.highScore) {
                user.highScore = currentScore;
            }
        }
        await user.save();
        res.json({ success: true, highScore: user.highScore, name: user.name });

    } catch (error) {
        console.error("Sync Error:", error);
        res.status(401).json({ error: "Unauthorized: Invalid Google Token" });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        await connectToDatabase();
        const topPlayers = await User.find({}, 'name picture highScore')
            .sort({ highScore: -1 })
            .limit(10)
            .lean(); 
        res.json(topPlayers);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/', (req, res) => res.send("Minesweeper API Online"));

module.exports = app;
