const auth = require("../auth");
const database = require("../database");

const ROLES = new Set(["ADMIN", "OPERATOR", "VIEWER"]);

function readArgument(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : "";
}

function promptHidden(label) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
    throw new Error("Interactive password prompt requires a TTY. Set RPA_USER_PASSWORD instead.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const input = process.stdin;
    const output = process.stdout;

    function cleanup() {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
    }

    function onData(chunk) {
      for (const character of String(chunk)) {
        if (character === "\u0003") {
          cleanup();
          output.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          output.write("\n");
          resolve(value);
          return;
        }
        if (character === "\u0008" || character === "\u007f") {
          if (value.length) {
            value = value.slice(0, -1);
            output.write("\b \b");
          }
          continue;
        }
        if (character === "\u001b" || character < " ") {
          continue;
        }
        if (value.length < auth.PASSWORD_MAX_LENGTH) {
          value += character;
          output.write("*");
        }
      }
    }

    output.write(label);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function getPassword() {
  if (process.env.RPA_USER_PASSWORD) {
    return process.env.RPA_USER_PASSWORD;
  }
  const password = await promptHidden("Password: ");
  const confirmation = await promptHidden("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match.");
  }
  return password;
}

async function main() {
  const username = readArgument("username").trim().toLowerCase();
  const displayName = (readArgument("display-name") || username).trim();
  const role = (readArgument("role") || "VIEWER").trim().toUpperCase();

  if (!/^[a-z0-9][a-z0-9._-]{2,99}$/.test(username)) {
    throw new Error(
      "--username must be 3-100 lowercase letters, numbers, dots, underscores, or hyphens.",
    );
  }
  if (!displayName || displayName.length > 200) {
    throw new Error("--display-name must be 1-200 characters.");
  }
  if (!ROLES.has(role)) {
    throw new Error("--role must be ADMIN, OPERATOR, or VIEWER.");
  }

  const password = await getPassword();
  auth.validatePassword(password);
  const passwordHash = await auth.hashPassword(password);

  await database.initializeSchema();
  const user = await database.createOrUpdateUser({
    username,
    displayName,
    passwordHash,
    role,
    isActive: true,
  });
  console.log(`User ready: ${user.username} (${user.role})`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => database.close());
