// Fonction serverless Vercel — envoie un vrai email de relance via Resend.
// La clé RESEND_API_KEY doit être ajoutée dans Vercel → Settings → Environment Variables.
// Clé gratuite sur https://resend.com (aucune carte requise pour créer le compte).
//
// IMPORTANT — tant que tu n'as pas vérifié un nom de domaine sur resend.com/domains,
// Resend n'autorise l'envoi QUE vers l'adresse email avec laquelle tu t'es inscrit sur Resend.
// C'est normal, pas un bug : ça te permet de tester tout le circuit avant de payer/configurer un domaine.
// Une fois prêt à envoyer à de vrais prospects, vérifie un domaine sur Resend et remplace
// FROM_EMAIL ci-dessous par une adresse de ce domaine (ex: relances@tondomaine.fr).
// Fonction serverless Vercel — envoie un email de relance PERSONNALISÉ (rédigé par l'IA
// à partir du message réel du prospect), via Resend.
// Variables nécessaires dans Vercel : RESEND_API_KEY, GEMINI_API_KEY (déjà configurées).
 // Fonction serverless Vercel — envoie un email de relance PERSONNALISÉ (rédigé par l'IA
// à partir du message réel du prospect), via Resend.
// Variables nécessaires dans Vercel : RESEND_API_KEY, GEMINI_API_KEY (déjà configurées).

const SUPABASE_URL = "https://ssdfycziuiqbcfnkvwsm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uJBQEjTN0LKw4-nyW3_Nag_sVlLIvFF";
const FROM_EMAIL = "Cadence <onboarding@resend.dev>";
const GEMINI_MODEL = "gemini-3.1-flash-lite";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ error: "Non authentifié" });

  try {
    const userCheck = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY }
    });
    if (!userCheck.ok) return res.status(401).json({ error: "Session invalide, reconnecte-toi." });
  } catch (e) {
    return res.status(401).json({ error: "Impossible de vérifier la session." });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { name, email, company, notes, category, reason } = body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "Nom et email du prospect requis." });
  }

  // 1) Rédaction de l'email par l'IA, personnalisée avec ce qu'on sait du prospect.
  let subject = `Toujours intéressé, ${name.split(" ")[0]} ?`;
  let htmlBody = `<p>Bonjour ${name},</p><p>Je reviens vers vous concernant votre demande${company ? ` pour <b>${company}</b>` : ""}.</p><p>Est-ce toujours d'actualité ?</p><p>À très vite,<br>L'équipe Cadence</p>`;

  try {
    const prompt = `Tu rédiges un court email de relance commerciale en français, chaleureux et professionnel, jamais insistant, pour une petite entreprise.

Informations sur le prospect :
- Prénom/nom : ${name}
- Entreprise : ${company || "non précisé"}
- Message original du prospect : ${notes || "non précisé"}
- Catégorie IA : ${category || "non précisé"}
- Raison de la qualification : ${reason || "non précisé"}

Rédige un email court (4 à 6 phrases maximum) qui fait référence concrètement à ce que le prospect a demandé (s'il a précisé quelque chose), pas un message générique. Signe "L'équipe Cadence".

Réponds UNIQUEMENT avec un objet JSON strictement de cette forme, sans aucun texte ni markdown autour :
{"subject": "<objet court et engageant, sans guillemets>", "body": "<le corps de l'email en HTML simple, avec des balises <p> pour les paragraphes>"}`;

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
      const data = await aiResponse.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const parsed = JSON.parse(parts.map((p) => p.text || "").join("").replace(/```json|```/g, "").trim());
      if (parsed.subject) subject = parsed.subject;
      if (parsed.body) htmlBody = parsed.body;
    }
  } catch (e) {
    // Si l'IA échoue, on envoie quand même l'email générique ci-dessus plutôt que rien.
  }

  // 2) Envoi via Resend.
  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject, html: htmlBody })
    });

    if (!emailResponse.ok) {
      const errText = await emailResponse.text();
      return res.status(502).json({ error: "Erreur d'envoi : " + errText });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
};
