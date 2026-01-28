const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
app.use(cors()); // Allow requests from your game
app.use(express.json());

// --- CONFIG ---
// You will set these in Vercel Settings later
const MONGO_URI = process.env.MONGODB_URI; 
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const client = new OAuth2Client(CLIENT_ID);

// --- DATABASE SCHEMA ---
const userSchema = new mongoose.Schema({
    googleId: { type: String, required: true, unique: true },
    name: String,
    picture: String,
    highScore: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// Connect to DB
if (MONGO_URI) {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("Connected to MongoDB"))
        .catch(err => console.error("Mongo Error:", err));
}

// --- ENDPOINTS ---

// 1. Sync Score (Login & Update)
app.post('/api/sync-score', async (req, res) => {
    const { token, currentScore } = req.body;

    try {
        // Verify Google Token (Security)
        const ticket = await client.verifyIdToken({
            idToken: token,
            audience: CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const { sub: googleId, name, picture } = payload;

        // Find User
        let user = await User.findOne({ googleId });

        if (!user) {
            // New User
            user = new User({ googleId, name, picture, highScore: currentScore || 0 });
        } else {
            // Update User info and check High Score
            user.name = name;
            user.picture = picture;
            if (currentScore > user.highScore) {
                user.highScore = currentScore;
            }
        }
        await user.save();

        res.json({ success: true, highScore: user.highScore, name: user.name });

    } catch (error) {
        console.error(error);
        res.status(401).json({ error: "Invalid Token or Server Error" });
    }
});

// 2. Get Leaderboard (Top 10)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const topPlayers = await User.find({}, 'name picture highScore') // Select specific fields
            .sort({ highScore: -1 }) // Descending order
            .limit(10);
        res.json(topPlayers);
    } catch (error) {
        res.status(500).json({ error: "Fetch failed" });
    }
});

// Default Route
app.get('/', (req, res) => res.send("Minesweeper API is running!"));

// Export for Vercel
module.exports = app;