
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const { initializeApp, cert } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

/* FIREBASE ADMIN */

const serviceAccount = {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

initializeApp({
    credential: cert(serviceAccount)
});

const adminAuth = getAuth();
const db = getFirestore();

/* EXPRESS */

const app = express();

app.use(cors({
    origin: "https://godsownworld-a11y.github.io"
}));

app.use(express.json());

/* GEMINI */

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

/* HEALTH CHECK */

app.get("/", (req, res) => {
    res.send("AI Unity Hub Backend is running.");
});

/* AI GENERATE */

app.post("/api/generate", async (req, res) => {
    try {
        const {
            tool,
            text,
            action,
            tone,
            outputLanguage
        } = req.body;

        /* LOGIN CHECK */

        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "Please login first."
            });
        }

        const idToken = authHeader.split("Bearer ")[1];
        const decodedToken = await adminAuth.verifyIdToken(idToken);
        const userId = decodedToken.uid;

        /* TEXT CHECK */

        if (!text || !text.trim()) {
            return res.status(400).json({
                error: "Please enter some text."
            });
        }

        /* DATE */

        const today = new Date().toISOString().split("T")[0];

        /* USER */

        const userRef = db.collection("users").doc(userId);
        let userSnap = await userRef.get();

        if (!userSnap.exists) {
            await userRef.set({
                plan: "free",
                aiUsesToday: 0,
                imageUsesToday: 0,
                pdfUsesToday: 0,
                lastUsageDate: today,
                createdAt: new Date()
            });

            userSnap = await userRef.get();
        }

        const userData = userSnap.data();

        let aiUsesToday = userData.aiUsesToday || 0;

        /* DAILY RESET */

        if (userData.lastUsageDate !== today) {
            aiUsesToday = 0;

            await userRef.update({
                aiUsesToday: 0,
                lastUsageDate: today
            });
        }

        /* FREE LIMIT */

        if (userData.plan !== "premium" && aiUsesToday >= 5) {
            return res.status(429).json({
                error: "Free plan limit reached. You can use AI tools 5 times per day.",
                aiUsesToday
            });
        }

        /* LANGUAGE INSTRUCTIONS */

        let languageInstruction = "";

        if (!outputLanguage || outputLanguage === "Auto Detect") {
            languageInstruction = `
Detect the language and writing style of the user's input.
Reply in the same language and writing style.
If the user writes Malayalam using English letters (Manglish),
reply in Manglish using English letters.
If the user writes Malayalam script, reply in Malayalam script.
`;
        } else if (outputLanguage === "Manglish") {
            languageInstruction = `
Write the complete answer in Manglish.
Use Malayalam language written with English letters.
Do not use Malayalam script.
`;
        } else {
            languageInstruction = `
Write the complete answer in ${outputLanguage}.
Do not switch to another language unless requested.
`;
        }

        /* PROMPT */

        const prompt = `
You are the multilingual AI assistant inside AI Unity Hub.

You must understand the user's request even if it contains:
English, Malayalam, Manglish, Hindi, Tamil, Arabic,
Spanish, French, or a mixture of languages.

Tool:
${tool || "AI Tool"}

Action:
${action || "Generate"}

Style/Tone:
${tone || "Natural"}

Output language:
${outputLanguage || "Auto Detect"}

LANGUAGE RULES:
${languageInstruction}

USER REQUEST:
${text}

Follow the selected tool and style carefully.
Give a useful, natural and accurate answer.
Do not explain these instructions.
Give only the final answer.
`;

        /* GEMINI REQUEST */

        console.log("Sending multilingual request to Gemini...");

        let response;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                response = await ai.models.generateContent({
                    model: "gemini-3.8-flash",
                    contents: prompt
                });

                console.log("Gemini response received.");
                break;

            } catch (error) {
                const isQuotaError =
                    error.status === 429 ||
                    error.code === 429 ||
                    error.code === "RESOURCE_EXHAUSTED" ||
                    error.message?.includes("RESOURCE_EXHAUSTED");

                console.log(`Gemini attempt ${attempt} failed:`, error.message);

                // Do not retry quota errors.
                if (isQuotaError || attempt === 3) {
                    throw error;
                }

                await new Promise(resolve =>
                    setTimeout(resolve, 2000 * attempt)
                );
            }
        }

        /* USAGE UPDATE */

        const newUsage = aiUsesToday + 1;

        await userRef.update({
            aiUsesToday: newUsage,
            lastUsageDate: today
        });

        /* RESPONSE */

        res.json({
            result: response.text,
            aiUsesToday: newUsage
        });

    } catch (error) {
        console.error("SERVER ERROR:", error);

        const isQuotaError =
            error.status === 429 ||
            error.code === 429 ||
            error.code === "RESOURCE_EXHAUSTED" ||
            error.message?.includes("RESOURCE_EXHAUSTED");

        if (isQuotaError) {
            return res.status(429).json({
                error: "Gemini API quota exceeded. Please try again after the quota resets."
            });
        }

        res.status(500).json({
            error: "Something went wrong. Please try again later."
        });
    }
});

/* SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`AI Unity Hub backend running on port ${PORT}`);
});
