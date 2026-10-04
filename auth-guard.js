import {
    getAuth,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";

const firebaseConfig = {
    apiKey: "AIzaSyA4aQj8bxLOmIdxJai3LEt6I1jV8BF0zJc",
    authDomain: "ai-unity-hub.firebaseapp.com",
    projectId: "ai-unity-hub",
    storageBucket: "ai-unity-hub.firebasestorage.app",
    messagingSenderId: "499702999885",
    appId: "1:499702999885:web:8f599c540741c39c4aa504",
    measurementId: "G-W3GGBB7VYX"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {

    if (!user) {
        window.location.replace("login.html");
    }

});