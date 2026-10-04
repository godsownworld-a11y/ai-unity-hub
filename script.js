// AI Unity Hub

const exploreButton = document.querySelector(".start-btn");
const loginButton = document.querySelector(".login-btn");

if (exploreButton) {
    exploreButton.addEventListener("click", function () {
        window.location.href = "login.html";
    });
}

if (loginButton) {
    loginButton.addEventListener("click", function () {
        window.location.href = "login.html";
    });
}