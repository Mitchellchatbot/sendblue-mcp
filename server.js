import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = process.env.PORT || 3000;
const SENDBLUE_BASE_URL = "https://api.sendblue.co/api";

function getSendblueHeaders() {
  const apiKey = process.env.SENDBLUE_API_KEY;
  const apiSecret = process.env.SENDBLUE_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error(
      "SENDBLUE_API_KEY and SENDBLUE_API_SECRET environment variables are required"
    );
  }
  return {
    "sb-api-key-id": apiKey,
    "sb-api-secret-key": apiSecret,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function sendblueRequest(path, method = "GET", body = null) {
  const url = `${SENDBLUE_BASE_URL}${path}`;
  const options = {
    method,
    headers: getSendblueHeaders(),
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Sendblue API error ${res.status}: ${text}`);
  }
  return res.json();
}

function buildQuery(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// --- MCP Server ---

function createMcpServer() {
  const server = new McpServer({
    name: "sendblue",
    version: "1.0.0",
    description:
      "Sendblue API — send iMessages and SMS, manage conversations and contacts.",
  });

  // ── Send Messages ──────────────────────────────────────────────────────────

  server.tool(
    "send_message",
    "Send an iMessage or SMS to a single phone number via Sendblue",
    {
      number: z
        .string()
        .describe("Recipient phone number in E.164 format (e.g. +15551234567)"),
      content: z.string().optional().describe("Text content of the message"),
      media_url: z
        .string()
        .optional()
        .describe("Publicly accessible URL of media to attach (image, video, etc.)"),
      send_style: z
        .enum(["invisible", "slam", "loud", "gentle"])
        .optional()
        .describe("iMessage bubble or screen send effect"),
      status_callback: z
        .string()
        .optional()
        .describe("Webhook URL to receive delivery status updates"),
    },
    async ({ number, content, media_url, send_style, status_callback }) => {
      if (!content && !media_url) {
        return {
          content: [
            {
              type: "text",
              text: "Error: either content or media_url must be provided",
            },
          ],
        };
      }
      const body = { number };
      if (content) body.content = content;
      if (media_url) body.media_url = media_url;
      if (send_style) body.send_style = send_style;
      if (status_callback) body.status_callback = status_callback;

      const data = await sendblueRequest("/send-message", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "send_group_message",
    "Send an iMessage or SMS to a group of phone numbers",
    {
      numbers: z
        .array(z.string())
        .describe("Array of recipient phone numbers in E.164 format"),
      content: z.string().optional().describe("Text content of the message"),
      media_url: z
        .string()
        .optional()
        .describe("Publicly accessible URL of media to attach"),
      group_id: z
        .string()
        .optional()
        .describe("Existing group ID to send into (omit to create a new group)"),
      send_style: z
        .enum(["invisible", "slam", "loud", "gentle"])
        .optional()
        .describe("iMessage send style effect"),
      status_callback: z
        .string()
        .optional()
        .describe("Webhook URL to receive delivery status updates"),
    },
    async ({ numbers, content, media_url, group_id, send_style, status_callback }) => {
      if (!content && !media_url) {
        return {
          content: [
            {
              type: "text",
              text: "Error: either content or media_url must be provided",
            },
          ],
        };
      }
      const body = { numbers };
      if (content) body.content = content;
      if (media_url) body.media_url = media_url;
      if (group_id) body.group_id = group_id;
      if (send_style) body.send_style = send_style;
      if (status_callback) body.status_callback = status_callback;

      const data = await sendblueRequest("/send-group-message", "POST", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Message History ────────────────────────────────────────────────────────

  server.tool(
    "get_messages",
    "Get message history with a specific contact (paginated)",
    {
      number: z
        .string()
        .describe("Contact phone number in E.164 format"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe("Number of messages to return (default 25, max 100)"),
      before_date: z
        .string()
        .optional()
        .describe("Return messages sent before this ISO 8601 datetime"),
      after_date: z
        .string()
        .optional()
        .describe("Return messages sent after this ISO 8601 datetime"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Number of messages to skip for pagination"),
    },
    async ({ number, limit, before_date, after_date, offset }) => {
      const params = { number };
      if (limit) params.limit = limit;
      if (before_date) params.before_date = before_date;
      if (after_date) params.after_date = after_date;
      if (offset !== undefined) params.offset = offset;

      const data = await sendblueRequest(`/message-history${buildQuery(params)}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    "get_message",
    "Get details for a specific message by its ID",
    {
      message_id: z.string().describe("The Sendblue message ID"),
    },
    async ({ message_id }) => {
      const data = await sendblueRequest(`/messages/${message_id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Number Lookup ──────────────────────────────────────────────────────────

  server.tool(
    "check_number",
    "Check whether a phone number supports iMessage (registered with Apple) or will fall back to SMS",
    {
      number: z
        .string()
        .describe("Phone number to check in E.164 format (e.g. +15551234567)"),
    },
    async ({ number }) => {
      const data = await sendblueRequest(
        `/evaluate-service${buildQuery({ number })}`
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Typing Indicator ───────────────────────────────────────────────────────

  server.tool(
    "send_typing_indicator",
    "Send a typing indicator (... bubble) to a contact in iMessage",
    {
      number: z
        .string()
        .describe("Contact phone number in E.164 format"),
    },
    async ({ number }) => {
      const data = await sendblueRequest("/send-typing-indicator", "POST", {
        number,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ── Tapbacks / Reactions ───────────────────────────────────────────────────

  server.tool(
    "react_to_message",
    "React to a message with an iMessage tapback (like, love, dislike, laugh, emphasize, question)",
    {
      message_id: z.string().describe("The Sendblue message ID to react to"),
      reaction: z
        .enum(["love", "like", "dislike", "laugh", "emphasize", "question", "-love", "-like", "-dislike", "-laugh", "-emphasize", "-question"])
        .describe(
          "Tapback reaction to send. Prefix with '-' to remove an existing reaction (e.g. '-love')"
        ),
    },
    async ({ message_id, reaction }) => {
      const data = await sendblueRequest("/react", "POST", {
        message_id,
        reaction,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

// --- Express App ---

const app = express();
app.use(cors());
app.use(express.json());

// Session store: sessionId -> transport
const sessions = new Map();

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "sendblue-mcp" });
});

// Ensure Accept header includes text/event-stream (required by StreamableHTTP transport)
app.use("/mcp", (req, _res, next) => {
  const accept = req.headers["accept"] || "";
  if (!accept.includes("text/event-stream")) {
    req.headers["accept"] = accept
      ? `${accept}, text/event-stream`
      : "text/event-stream";
  }
  next();
});

// GET /mcp — client opens SSE stream to receive server messages
app.get("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
  });
  const server = createMcpServer();

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
    server.close();
  };

  await server.connect(transport);
  if (transport.sessionId) sessions.set(transport.sessionId, transport);

  await transport.handleRequest(req, res);
});

// POST /mcp — client sends JSON-RPC messages
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];

  if (sessionId && sessions.has(sessionId)) {
    await sessions.get(sessionId).handleRequest(req, res, req.body);
    return;
  }

  // No existing session — stateless single-request mode
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const server = createMcpServer();
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// DELETE /mcp — client closes session
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId);
    await transport.handleRequest(req, res);
    sessions.delete(sessionId);
  } else {
    res.status(404).json({ error: "Session not found" });
  }
});

app.listen(PORT, () => {
  console.log(`Sendblue MCP server running on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
});
