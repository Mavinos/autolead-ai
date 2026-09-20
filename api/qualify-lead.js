// Fonction serverless Vercel — s'exécute côté serveur, jamais dans le navigateur.
// La clé GEMINI_API_KEY doit être ajoutée dans Vercel → Settings → Environment Variables.
// Clé gratuite (sans carte bancaire) à récupérer sur https://aistudio.google.com/apikey

const SUPABASE_URL = "https://ssdfycziuiqbcfnkvwsm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uJBQEjTN0LKw4-nyW3_Nag_sVlLIvFF";

// Si ce modèle finit par renvoyer une erreur "model not found", vérifie la liste
// des modèles disponibles gratuitement sur https://aistudio.google.com et remplace
// le nom ci-dessous par un modèle "flash" ou "flash-lite" actuel.
const GEMINI_MODEL = "gemini-3.1-flash-lite";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // 1) Vérifie que la requête vient bien d'un utilisateur connecté (évite l'abus).
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

  // 2) Récupère les infos du prospect envoyées par le site.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { name, company, context } = body || {};
  if (!name || !company) {
    return res.status(400).json({ error: "Nom et entreprise requis." });
  }

  // 3) Construit la demande envoyée à l'IA.
  const prompt = `Tu es un assistant de qualification commerciale B2B pour une petite entreprise française.
Analyse ce prospect et donne une note de 0 à 100 (probabilité qu'il devienne client payant) ainsi qu'une catégorie parmi : chaud, tiède, froid.

Prospect :
- Nom : ${name}
- Entreprise : ${company}
- Contexte / message du prospect : ${context || "non précisé"}

Réponds UNIQUEMENT avec un objet JSON strictement de cette forme, sans aucun texte ni markdown autour :
{"score": <nombre entier entre 0 et 100>, "category": "chaud" | "tiède" | "froid", "reason": "<une phrase courte en français expliquant la note>"}`;

  try {
    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" }
        })
      }
    );

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      return res.status(502).json({ error: "Erreur IA : " + errText });
    }

    const data = await aiResponse.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || "").join("").trim();
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
    const validCategories = ["chaud", "tiède", "froid"];
    const category = validCategories.includes(parsed.category)
      ? parsed.category
      : score >= 75 ? "chaud" : score >= 50 ? "tiède" : "froid";

    return res.status(200).json({ score, category, reason: parsed.reason || "" });
  } catch (err) {
    return res.status(500).json({ error: "Erreur serveur : " + err.message });
  }
};
