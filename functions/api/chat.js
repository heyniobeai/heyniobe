// POST /api/chat  — the customer-facing conversation with their own Niobe.
// Verifies the caller's Supabase session, loads THEIR brain, answers as their assistant.
const SUPA = "https://gcryyyfepikdkjkgshcl.supabase.co";

export async function onRequestPost({ request, env }) {
  const json = (o, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

  // --- auth: the bearer token must be a real Supabase session ---
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return json({ error: "Not signed in." }, 401);

  const ures = await fetch(`${SUPA}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_PUBLISHABLE, Authorization: "Bearer " + token },
  });
  if (!ures.ok) return json({ error: "Session expired. Sign in again." }, 401);
  const user = await ures.json();

  const md = user.user_metadata || {};
  const brain = md.niobe_brain;                       // written by the provisioner
  if (!brain) {
    return json({
      error: "Your instance isn't ready yet.",
      detail: "Finish the onboarding audit — your Niobe is built from those answers.",
    }, 409);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const message = (body.message || "").toString().trim();
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];
  if (!message) return json({ error: "Say something first." }, 400);
  if (message.length > 4000) return json({ error: "That's too long — keep it under 4000 characters." }, 400);

  const name = brain.operator || (user.email || "").split("@")[0];
  const system = [
    `You are ${name}'s private AI partner — their Niobe.`,
    `Address them as ${name}.`,
    "Direct and warm, but NO hype, NO therapy-speak, NO fake enthusiasm, no filler. Outcome first.",
    "Every claim backable. If you don't know, say so plainly.",
    "Support-mode is rule #1: when they're struggling, pull them forward with a concrete next step — never a guilt-check.",
    "Honor their own priorities, don't substitute yours.",
    "",
    "WHO THEY ARE — built from their own onboarding answers:",
    brain.synthesis || "",
    brain.rules ? "\nHOW THEY DECIDE:\n" + brain.rules : "",
    brain.prefs ? "\nTHEIR TASTE AND PREFERENCES:\n" + brain.prefs : "",
  ].filter(Boolean).join("\n");

  const messages = [{ role: "system", content: system }];
  for (const h of history) {
    if (h && (h.role === "user" || h.role === "assistant") && h.content)
      messages.push({ role: h.role, content: String(h.content).slice(0, 4000) });
  }
  messages.push({ role: "user", content: message });

  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: "Bearer " + env.OPENROUTER_API_KEY,
      "HTTP-Referer": "https://heyniobe.ai",
      "X-Title": "Niobe",
    },
    body: JSON.stringify({
      model: env.NIOBE_MODEL || "google/gemini-2.5-flash",
      messages,
      temperature: 0.6,
      max_tokens: 900,
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    return json({ error: "Niobe is unreachable right now.", detail: t.slice(0, 160) }, 502);
  }
  const data = await r.json();
  const reply = data?.choices?.[0]?.message?.content?.trim();
  if (!reply) return json({ error: "Empty response. Try again." }, 502);
  return json({ reply });
}
