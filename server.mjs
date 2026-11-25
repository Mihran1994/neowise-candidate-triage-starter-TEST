import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));

const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);
const AI_TIMEOUT = 300;

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function classifyWithTimeout(text) {
  const controller = new AbortController();

  let timer;

  try {
    return await Promise.race([
      classify(text, { signal: controller.signal }),

      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("AI timeout"));
        }, AI_TIMEOUT);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function handleTriage(request, response) {
  let payload;

  // Проверяем входные данные.
  try {
    payload = await readBody(request);
  } catch {
    return json(response, 400, {
      status: "invalid_input",
    });
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    typeof payload.text !== "string" ||
    payload.text.trim().length === 0
  ) {
    return json(response, 400, {
      status: "invalid_input",
    });
  }

  // Обращаемся к AI и проверяем его ответ.
  try {
    const raw = await classifyWithTimeout(payload.text);
    const result = JSON.parse(raw);

    const valid =
      result &&
      typeof result === "object" &&
      ALLOWED_TOPICS.has(result.topic) &&
      typeof result.draft === "string" &&
      result.draft.trim().length > 0;

    if (!valid) {
      throw new Error("Invalid AI response");
    }

    return json(response, 200, {
      status: "ready",
      topic: result.topic,
      draft: result.draft.trim(),
    });
  } catch {
    // При любой ошибке передаём заявку на ручную обработку.
    return json(response, 200, {
      status: "manual_review",
      topic: null,
      draft: null,
    });
  }
}

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(html);
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, {
      status: "not_found",
    });
  }

  await handleTriage(request, response);
}).listen(Number(process.env.PORT || 3000), "127.0.0.1");