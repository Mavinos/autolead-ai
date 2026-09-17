// Fonction serverless Vercel — reçoit les soumissions du formulaire PUBLIC (formulaire.html).
// Contrairement à qualify-lead.js et send-followup.js, ce endpoint n'exige pas que le visiteur
// soit connecté : n'importe quel prospect peut soumettre ce formulaire depuis l'extérieur.
//
// Variables à ajouter dans Vercel → Settings → Environment Variables :
// - SUPABASE_SERVICE_ROLE_KEY : Supabase → Settings → API → "service_role" (clé SECRÈTE, jamais côté navigateur)
// - OWNER_USER_ID            : Supabase → Authentication → Users → copie l'UUID de ton compte
// - GEMINI_API_KEY           : déjà configurée pour qualify-lead.js, réutilisée ici
 
const SUPABASE_URL = "https://ssdfycziuiqbcfnkvwsm.supabase.co";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
 
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }
 
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { name, email, company, phone, message, consent, honeypot } = body || {};
 
  // Piège à robots simple : un champ invisible que seul un script automatique remplirait.
  if (honeypot) return res.status(200).json({ ok: true });
 
  if (!name || !email) {
    return res.status(400).json({ error: "Nom et email requis." });
  }
  if (!consent) {
    return res.status(400).json({ error: "Le consentement RGPD est requis pour enregistrer ta demande." });
  }
  if (!process.env.OWNER_USER_ID || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Le formulaire n'est pas encore configuré côté serveur (OWNER_USER_ID ou clé service manquante)." });
  }
 
  const context = [message, phone ? `Téléphone : ${phone}` : null].filter(Boolean).join(" — ");
 
  // 1) Qualification par l'IA (même logique que qualify-lead.js).
  let score = 50, category = "tiède", reason = "";
  try {
    const prompt = `Tu es un assistant de qualification commerciale B2B pour une petite entreprise française.
Analyse ce prospect venu d'un formulaire de contact public et donne une note de 0 à 100 (probabilité qu'il devienne client payant) ainsi qu'une catégorie parmi : chaud, tiède, froid.
 
Prospect :
- Nom : ${name}
- Entreprise : ${company || "non précisé"}
- Message / contexte : ${context || "non précisé"}
 
Réponds UNIQUEMENT avec un objet JSON strictement de cette forme, sans aucun texte ni markdown autour :
{"score": <nombre entier entre 0 et 100>, "category": "chaud" | "tiède" | "froid", "reason": "<une phrase courte en français expliquant la note>"}`;
 
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
      score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
      category = ["chaud", "tiède", "froid"].includes(parsed.category) ? parsed.category : category;
      reason = parsed.reason || "";
    }
  } catch (e) {
    // Si l'IA échoue, on enregistre quand même le prospect avec une qualification neutre
    // plutôt que de perdre le contact — mieux vaut un prospect mal noté qu'un prospect perdu.
  }
 
  // 2) Enregistrement dans Supabase avec la clé service (contourne volontairement le RLS,
  //    car ce visiteur n'a pas de session — mais on force nous-mêmes le bon user_id).
  try {
    const insertResponse = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=minimal"
      },
      body: JSON.stringify([{
        id: crypto.randomUUID(),
        user_id: process.env.OWNER_USER_ID,
        name,
        company: company || "Non précisé",
        email,
        interest: category,
        score,
        reason,
        status: score >= 70 ? "Qualifié" : "À qualifier",
        follow: "Nouveau (formulaire)",
        updated_at: new Date().toISOString()
      }])
    });
 
    if (!insertResponse.ok) {
      const errText = await insertResponse.text();
      return res.status(502).json({ error: "Erreur d'enregistrement : " + errText });
    }
 
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
};
