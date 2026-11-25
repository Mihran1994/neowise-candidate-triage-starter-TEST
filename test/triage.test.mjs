import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("../", import.meta.url));
const port = 3100 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;

test("API handles invalid input, AI failures and successful responses", async (t) => {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: String(port),
    },
    stdio: "ignore",
  });

  t.after(() => server.kill());
  
  // Ждём запуска сервера.
  let started = false;

  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(baseUrl);

      if (response.ok) {
        started = true;
        break;
      }
    } catch {
      await delay(50);
    }
  }

  assert.equal(started, true, "Server should start");

  async function post(text) {
    return fetch(`${baseUrl}/api/triage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  }

  // Проверка пустого ввода.
  const invalid = await post("   ");

  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    status: "invalid_input",
  });

  // Проверка битого JSON.
  const malformed = await fetch(`${baseUrl}/api/triage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: "{invalid json",
  });

  assert.equal(malformed.status, 400);
  assert.deepEqual(await malformed.json(), {
    status: "invalid_input",
  });

  // Проверка всех сценариев сбоя AI.
  const failures = [
    "[timeout]",
    "[error]",
    "[bad-json]",
    "[bad-topic]",
    "[empty-draft]",
  ];

  for (const marker of failures) {
    const response = await post(`Тест ${marker}`);

    assert.equal(response.status, 200);

    assert.deepEqual(await response.json(), {
      status: "manual_review",
      topic: null,
      draft: null,
    });
  }

  // Проверка успешного ответа.
  const success = await post("Где моя доставка?");

  assert.equal(success.status, 200);

  assert.deepEqual(await success.json(), {
    status: "ready",
    topic: "delivery",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});