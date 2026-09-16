// Fonction serverless Vercel — envoie un vrai email de relance via Resend.
// La clé RESEND_API_KEY doit être ajoutée dans Vercel → Settings → Environment Variables.
// Clé gratuite sur https://resend.com (aucune carte requise pour créer le compte).
//
// IMPORTANT — tant que tu n'as pas vérifié un nom de domaine sur resend.com/domains,
// Resend n'autorise l'envoi QUE vers l'adresse email avec laquelle tu t'es inscrit sur Resend.
// C'est normal, pas un bug : ça te permet de tester tout le circuit avant de payer/configurer un domaine.
// Une fois prêt à envoyer à de vrais prospects, vérifie un domaine sur Resend et remplace
// FROM_EMAIL ci-dessous par une adresse de ce domaine (ex: relances@tondomaine.fr).

const SUPABASE_URL = "https://ssdfycziuiqbcfnkvwsm.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uJBQEjTN0LKw4-nyW3_Nag_sVlLIvFF";
const FROM_EMAIL = "AutoLead AI <onboarding@resend.dev>";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  // 1) Vérifie que la requête vient bien d'un utilisateur connecté.
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

  // 2) Récupère les infos du prospect.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { name, email, company } = body || {};
  if (!name || !email) {
    return res.status(400).json({ error: "Nom et email du prospect requis." });
  }

  // 3) Envoie l'email via Resend.
  try {
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [email],
        subject: `Toujours intéressé, ${name.split(" ")[0]} ?`,
        html: `
          <p>Bonjour ${name},</p>
          <p>Je reviens vers vous concernant votre demande${company ? ` pour <b>${company}</b>` : ""}.</p>
          <p>Est-ce toujours d'actualité ? N'hésitez pas à répondre directement à cet email, je serai ravi d'en discuter avec vous.</p>
          <p>À très vite,<br>L'équipe AutoLead AI</p>
        `
      })
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
