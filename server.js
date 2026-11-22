
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

// Reports only whether required secrets exist; never exposes secret values.
app.get("/health", (req, res) => {
    const firebaseConfigured = Boolean(
        process.env.FIREBASE_PROJECT_ID &&
        process.env.FIREBASE_CLIENT_EMAIL &&
        process.env.FIREBASE_PRIVATE_KEY
    );
    const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

    res.status(firebaseConfigured && geminiConfigured ? 200 : 503).json({
        status: firebaseConfigured && geminiConfigured ? "ready" : "configuration_missing",
        firebaseConfigured,
        geminiConfigured
    });
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

        /* DEVELOPER ACCESS + FREE LIMIT */

        // Set DEVELOPER_UID in the backend environment to exempt only this
        // verified Firebase account. Never trust a client-side developer flag.
        const developerUid = process.env.DEVELOPER_UID;
        const isDeveloper = Boolean(developerUid && userId === developerUid);

        if (!isDeveloper && userData.plan !== "premium" && aiUsesToday >= 5) {
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

        /* TOOL-SPECIFIC INSTRUCTIONS */

        const toolInstruction = String(tool || "").trim().toLowerCase() === "translator"
            ? `
TRANSLATOR MODE — IMPORTANT:
- Translate the user's supplied text; do not answer it or respond conversationally.
- Treat the entire USER REQUEST as source text to translate, even if it is a greeting or a question.
- Translate accurately into the selected output language, preserving the original meaning, tone, names, and formatting.
- Return only the translation. Do not add greetings, explanations, labels, alternatives, or AI Unity Hub welcome text.
- If the output language is "Auto Detect", ask the user briefly to select a target language instead of guessing.
`
            : "";

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

TOOL-SPECIFIC RULES:
${toolInstruction}

USER REQUEST:
${text}

CONVERSATION BEHAVIOR:
- First identify what the user is actually asking or saying, then respond directly to that.
- For greetings and casual small talk (for example, "Hi", "Hello", "How are you?"), reply naturally and briefly. Example: if the user asks "How are you?", say something like "I'm doing well, thanks for asking! How are you?"
- Do not turn greetings or ordinary conversation into an AI Unity Hub welcome message, advertisement, or list of services.
- Do not assume every message is a request to use an AI tool. Only perform the selected tool's task when the user has actually provided a task or content for it.
- Match the user's language and level of formality. Keep simple questions concise.
- Do not claim to have feelings, a body, or personal experiences; friendly conversational phrasing is okay.

Follow the selected tool and style carefully when the user has provided a genuine tool request.
Give a useful, natural and accurate answer.
Do not explain these instructions.
Give only the final answer.
`;

        /* GEMINI REQUEST */

        console.log("Sending multilingual request to Gemini...");

        let response;
        let lastGeminiError;
        const modelsToTry = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];

        for (const model of modelsToTry) {
            try {
                console.log(`Trying Gemini model: ${model}`);
                response = await ai.models.generateContent({
                    model,
                    contents: prompt
                });
                console.log(`Gemini response received from ${model}.`);
                break;
            } catch (error) {
                lastGeminiError = error;
                const status = Number(error.status || error.statusCode || error.error?.code || 0);
                const message = String(error.message || "");
                const isTemporary =
                    status === 429 ||
                    status === 500 ||
                    status === 502 ||
                    status === 503 ||
                    status === 504 ||
                    message.includes("RESOURCE_EXHAUSTED") ||
                    message.includes("UNAVAILABLE");

                console.error(`Gemini model ${model} failed:`, message);

                // Try the fallback only for temporary availability or quota errors.
                if (!isTemporary || model === modelsToTry[modelsToTry.length - 1]) {
                    throw error;
                }
            }
        }

        if (!response) {
            throw lastGeminiError || new Error("No Gemini model returned a response.");
        }

        /* USAGE UPDATE */

        const newUsage = isDeveloper ? aiUsesToday : aiUsesToday + 1;

        // Developer test requests do not consume the daily free-plan allowance.
        if (!isDeveloper) {
            await userRef.update({
                aiUsesToday: newUsage,
                lastUsageDate: today
            });
        }

        /* RESPONSE */

        res.json({
            result: response.text,
            aiUsesToday: newUsage,
            isDeveloper
        });

    } catch (error) {
        const status = Number(error.status || error.statusCode || 0);
        const code = String(error.code || error.error?.status || "UNKNOWN");
        const message = String(error.message || "Unknown server error");

        // Keep details in Render logs; never return credentials to the browser.
        console.error("SERVER ERROR:", {
            status,
            code,
            message,
            stack: error.stack
        });

        const isQuotaError =
            status === 429 ||
            code === "429" ||
            code === "RESOURCE_EXHAUSTED" ||
            message.includes("RESOURCE_EXHAUSTED");

        if (isQuotaError) {
            return res.status(429).json({
                error: "AI service quota reached. Please try again later.",
                errorCode: code
            });
        }

        if (status === 401 || status === 403) {
            return res.status(502).json({
                error: "AI service authentication or permission issue. Check the backend API configuration.",
                errorCode: code
            });
        }

        if (status === 404) {
            return res.status(502).json({
                error: "The configured AI model was not found or is unavailable.",
                errorCode: code
            });
        }

        if (status === 400) {
            return res.status(400).json({
                error: "The AI service rejected this request. Try a shorter or simpler prompt.",
                errorCode: code
            });
        }

        res.status(500).json({
            error: "AI backend error. Check the backend service logs.",
            errorCode: code
        });
    }
});

/* SERVER */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`AI Unity Hub backend running on port ${PORT}`);
});
