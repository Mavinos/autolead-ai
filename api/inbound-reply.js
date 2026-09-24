// Fonction serverless Vercel — reçoit les RÉPONSES des prospects (webhook Resend "Inbound").
//
// Configuration nécessaire (une seule fois) :
// 1. Resend → Emails → Receiving → note ton adresse de réception (ex: abc123@xyz.resend.app)
// 2. Ajoute cette adresse comme variable Vercel : INBOUND_REPLY_EMAIL
// 3. Resend → Webhooks → Add Webhook → URL : https://<ton-site>.vercel.app/api/inbound-reply
//    → coche l'événement "email.received" → Add
// À partir de ce moment, toute réponse à un email de relance sera automatiquement
// analysée par l'IA et fera passer le prospect dans l'onglet "Réponses" du site.
//
// Note technique : ce endpoint ne vérifie pas encore la signature cryptographique du
// webhook (Svix) — c'est un choix simple pour démarrer vite. À sécuriser avant de
// grandir beaucoup (voir la doc Resend "verify webhooks requests").

const SUPABASE_URL = "https://ssdfycziuiqbcfnkvwsm.supabase.co";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const FROM_EMAIL = "Cadence <onboarding@resend.dev>";

function extractEmail(fromField) {
  const match = (fromField || "").match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : (fromField || "").trim().toLowerCase();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Méthode non autorisée" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (body?.type !== "email.received") return res.status(200).json({ ok: true, skipped: true });

  const data = body.data || {};
  const fromEmail = extractEmail(data.from);

  if (!fromEmail || !data.email_id) return res.status(200).json({ ok: true, skipped: true });

  // Le webhook ne contient que les métadonnées — il faut récupérer le vrai contenu du mail.
  let replyText = "";
  try {
    const contentResp = await fetch(`https://api.resend.com/emails/receiving/${data.email_id}`, {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }
    });
    if (contentResp.ok) {
      const emailContent = await contentResp.json();
      replyText = (emailContent.text || emailContent.html || "").toString().slice(0, 4000);
    }
  } catch (e) {
    return res.status(200).json({ ok: true, skipped: true, reason: "Impossible de récupérer le contenu de l'email." });
  }

  if (!replyText) return res.status(200).json({ ok: true, skipped: true });
  if (!process.env.OWNER_USER_ID || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "OWNER_USER_ID ou SUPABASE_SERVICE_ROLE_KEY manquante." });
  }

  const sbHeaders = {
    "Content-Type": "application/json",
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    // 1) Retrouve le prospect correspondant à cet email, chez ce propriétaire.
    const findResp = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?email=eq.${encodeURIComponent(fromEmail)}&user_id=eq.${process.env.OWNER_USER_ID}&order=updated_at.desc&limit=1&select=id,name,company,notes,reason,last_reply`,
      { headers: sbHeaders }
    );
    const matches = await findResp.json();
    if (!Array.isArray(matches) || !matches.length) {
      return res.status(200).json({ ok: true, skipped: true, reason: "Aucun prospect connu avec cet email." });
    }
    const lead = matches[0];

    // Idempotence simple : si on a déjà enregistré exactement cette réponse, on ne refait rien
    // (les webhooks peuvent être envoyés plusieurs fois par Resend).
    if (lead.last_reply === replyText) return res.status(200).json({ ok: true, skipped: true, reason: "Déjà traité." });

    // 2) L'IA analyse la réponse et rédige une suggestion de suite à donner.
    let suggestion = "Merci pour votre retour, je reviens vers vous très vite.";
    let newScore = null;
    try {
      const prompt = `Un prospect a répondu à un email de relance commerciale. Analyse sa réponse et rédige une suggestion de réponse à lui envoyer.

Prospect : ${lead.name} (${lead.company || "entreprise non précisée"})
Demande initiale du prospect : ${lead.notes || "non précisé"}
Réponse du prospect à notre relance : "${replyText.slice(0, 1000)}"

Réponds UNIQUEMENT avec un objet JSON strictement de cette forme, sans aucun texte ni markdown autour :
{"score": <nombre entier 0-100 reflétant l'intérêt réel montré dans cette réponse>, "suggested_reply": "<un court brouillon de réponse en HTML simple avec des balises <p>, en français, chaleureux et professionnel, qui répond concrètement à ce que le prospect vient d'écrire>"}`;

      const aiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
          })
        }
      );
      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const parts = aiData?.candidates?.[0]?.content?.parts || [];
        const parsed = JSON.parse(parts.map((p) => p.text || "").join("").replace(/```json|```/g, "").trim());
        if (parsed.suggested_reply) suggestion = parsed.suggested_reply;
        if (typeof parsed.score === "number") newScore = Math.max(0, Math.min(100, Math.round(parsed.score)));
      }
    } catch (e) {
      // Si l'IA échoue, on garde la suggestion générique ci-dessus plutôt que de tout bloquer.
    }

    // 3) Met à jour le prospect : statut "A répondu", texte de la réponse, suggestion IA.
    const updatePayload = {
      status: "A répondu",
      follow: "A répondu — action requise",
      last_reply: replyText,
      reply_suggestion: suggestion,
      updated_at: new Date().toISOString()
    };
    if (newScore != null) updatePayload.score = newScore;

    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${lead.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify(updatePayload)
    });

    // 4) Alerte immédiate par email, en plus de la notification dans l'app.
    if (process.env.OWNER_EMAIL && process.env.RESEND_API_KEY) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [process.env.OWNER_EMAIL],
            subject: `💬 ${lead.name} a répondu à votre email`,
            html: `<p><b>${lead.name}</b> (${lead.company || "—"}) a répondu :</p><blockquote style="border-left:3px solid #ccc;padding-left:10px;color:#444">${replyText.slice(0, 500)}</blockquote><p>Va dans l'onglet "Réponses" de Cadence pour voir la suggestion de réponse de l'IA.</p>`
          })
        });
      } catch (notifErr) {}
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
};
