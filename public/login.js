const form = document.querySelector("#loginForm");
const errorMessage = document.querySelector("#loginError");
const submitButton = form.querySelector('button[type="submit"]');

function destinationAfterLogin() {
  const requested = new URLSearchParams(window.location.search).get("next");
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) {
    return "/";
  }
  return requested;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.textContent = "";
  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Signing in...";

  const formData = new FormData(form);
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: String(formData.get("username") || "").trim(),
        password: String(formData.get("password") || ""),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Sign in failed.");
    }
    window.location.replace(destinationAfterLogin());
  } catch (error) {
    errorMessage.textContent = error.message;
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Sign in";
    document.querySelector("#password").select();
  }
});
