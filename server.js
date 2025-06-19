import Fastify from "fastify";
import fastifyWs from "@fastify/websocket";
import fastifyFormBody from "@fastify/formbody";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT || 8080;
const DOMAIN = process.env.DOMAIN;

console.log("ENV OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "[SET]" : "[MISSING]");
console.log("ENV DOMAIN:", process.env.DOMAIN || "[MISSING]");

if (!process.env.OPENAI_API_KEY || !DOMAIN) {
  console.error("❌ Missing required environment variables 1");
  process.exit(1);
}

const WS_URL = `wss://${DOMAIN}/ws`;
const WELCOME_GREETING = "Hi! I am a voice assistant powered by Twilio and Open A I. Ask me anything!";
const SYSTEM_PROMPT = "You are a helpful assistant. This conversation is being translated to voice...";

const sessions = new Map();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function aiResponse(messages) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
  });
  return completion.choices[0].message.content;
}

const fastify = Fastify();
fastify.register(fastifyWs);
fastify.register(fastifyFormBody);

// ✅ Register WebSocket BEFORE server starts
fastify.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (ws, req) => {
    ws.on("message", async (data) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case "setup":
          ws.callSid = message.callSid;
          sessions.set(ws.callSid, [{ role: "system", content: SYSTEM_PROMPT }]);
          break;
        case "prompt":
          const convo = sessions.get(ws.callSid);
          convo.push({ role: "user", content: message.voicePrompt });
          const response = await aiResponse(convo);
          convo.push({ role: "assistant", content: response });

          ws.send(JSON.stringify({ type: "text", token: response, last: true }));
          break;
        case "interrupt":
          console.log("Call interrupted");
          break;
      }
    });

    ws.on("close", () => {
      sessions.delete(ws.callSid);
    });
  });
});

// ✅ XML response for Twilio
fastify.all("/twiml", async (request, reply) => {
  reply.type("text/xml").send(`
    <Response>
      <Connect>
        <ConversationRelay url="${WS_URL}" welcomeGreeting="${WELCOME_GREETING}" />
      </Connect>
    </Response>`);
});

// ✅ Listen on 0.0.0.0
(async () => {
  try {
    //await fastify.listen({ port: PORT, host: "0.0.0.0" });
    fastify.listen({ port: process.env.PORT || 8080, host: '0.0.0.0' });

    console.log(`✅ App live at http://localhost:${PORT} and wss://${DOMAIN}/ws`);
  } catch (err) {
    console.error("❌ Error starting server:", err);
    process.exit(1);
  }
})();
