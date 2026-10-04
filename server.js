require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { GoogleGenAI } = require("@google/genai");

const {
    initializeApp,
    cert
} = require("firebase-admin/app");

const {
    getAuth
} = require("firebase-admin/auth");

const {
    getFirestore
} = require("firebase-admin/firestore");


/* =========================
   FIREBASE ADMIN
========================= */

const serviceAccount = {

    type: process.env.FIREBASE_TYPE,

    project_id: process.env.FIREBASE_PROJECT_ID,

    private_key_id:
        process.env.FIREBASE_PRIVATE_KEY_ID,

    private_key:
        process.env.FIREBASE_PRIVATE_KEY.replace(
            /\\n/g,
            "\n"
        ),

    client_email:
        process.env.FIREBASE_CLIENT_EMAIL,

    client_id:
        process.env.FIREBASE_CLIENT_ID,

    auth_uri:
        process.env.FIREBASE_AUTH_URI,

    token_uri:
        process.env.FIREBASE_TOKEN_URI,

    auth_provider_x509_cert_url:
        process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,

    client_x509_cert_url:
        process.env.FIREBASE_CLIENT_CERT_URL

};


initializeApp({

    credential:
        cert(serviceAccount)

});


const adminAuth = getAuth();

const db = getFirestore();


/* =========================
   EXPRESS
========================= */

const app = express();

app.use(cors());

app.use(express.json());


/* =========================
   GEMINI
========================= */

const ai = new GoogleGenAI({

    apiKey:
        process.env.GEMINI_API_KEY

});


/* =========================
   HEALTH CHECK
========================= */

app.get("/", (req, res) => {

    res.send(
        "AI Unity Hub Backend is running."
    );

});


/* =========================
   AI GENERATE
========================= */

app.post(
    "/api/generate",
    async (req, res) => {

        try {

            const {
                tool,
                text,
                action,
                tone
            } = req.body;


            /* LOGIN CHECK */

            const authHeader =
                req.headers.authorization;


            if (
                !authHeader ||
                !authHeader.startsWith(
                    "Bearer "
                )
            ) {

                return res.status(401).json({

                    error:
                        "Please login first."

                });

            }


            const idToken =
                authHeader.split(
                    "Bearer "
                )[1];


            const decodedToken =
                await adminAuth
                    .verifyIdToken(
                        idToken
                    );


            const userId =
                decodedToken.uid;


            /* TEXT CHECK */

            if (!text) {

                return res.status(400).json({

                    error:
                        "Please enter some text."

                });

            }


            /* TODAY */

            const today =
                new Date()
                    .toISOString()
                    .split("T")[0];


            /* USER */

            const userRef =
                db
                    .collection("users")
                    .doc(userId);


            const userSnap =
                await userRef.get();


            /* CREATE USER */

            if (!userSnap.exists) {

                await userRef.set({

                    plan: "free",

                    aiUsesToday: 0,

                    imageUsesToday: 0,

                    pdfUsesToday: 0,

                    lastUsageDate:
                        today,

                    createdAt:
                        new Date()

                });

            }


            /* LATEST USER */

            const latestUserSnap =
                await userRef.get();


            const userData =
                latestUserSnap.data();


            let aiUsesToday =
                userData.aiUsesToday || 0;


            /* DAILY RESET */

            if (
                userData.lastUsageDate
                !== today
            ) {

                aiUsesToday = 0;


                await userRef.update({

                    aiUsesToday: 0,

                    lastUsageDate:
                        today

                });

            }


            /* FREE LIMIT */

            if (
                userData.plan
                !== "premium" &&
                aiUsesToday >= 5
            ) {

                return res.status(429).json({

                    error:
                        "Free plan limit reached. You can use AI tools 5 times per day.",

                    aiUsesToday:
                        aiUsesToday

                });

            }


            /* PROMPT */

            const prompt = `

You are the AI assistant inside AI Unity Hub.

Tool:
${tool || "AI Tool"}

Action:
${action || "Generate"}

Style/Tone:
${tone || "Natural"}

User request:
${text}

Give only the final useful answer.
Do not explain these instructions.

`;


            console.log(
                "Sending request to Gemini..."
            );


            /* GEMINI */

            const response =
                await ai.models.generateContent({

                    model:
                        "gemini-3.8-flash",

                    contents:
                        prompt

                });


            console.log(
                "Gemini response received."
            );


            /* USAGE */

            const newUsage =
                aiUsesToday + 1;


            await userRef.update({

                aiUsesToday:
                    newUsage,

                lastUsageDate:
                    today

            });


            /* RESPONSE */

            res.json({

                result:
                    response.text,

                aiUsesToday:
                    newUsage

            });


        }

        catch (error) {

            console.error(
                "SERVER ERROR:",
                error
            );


            res.status(500).json({

                error:
                    error.message ||
                    "Request failed."

            });

        }

    }
);


/* =========================
   SERVER
========================= */

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `AI Unity Hub backend running on port ${PORT}`
        );

    }
);