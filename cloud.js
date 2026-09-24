/* Connexion Supabase : conserve le mode démo local tant que la configuration est vide. */
(async function () {
  const url = window.AUTOLEAD_SUPABASE_URL;
  const key = window.AUTOLEAD_SUPABASE_ANON_KEY;
  if (!url || !key) return;

  const client = window.supabase.createClient(url, key);
  window.autoleadClient = client;
  let isAuthenticated = false;

  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function isPhone(v) { return /^\+?[0-9\s.-]{6,}$/.test(v); }

  function friendlyError(message) {
    if (/Invalid login credentials/i.test(message)) {
      return "Email/téléphone ou mot de passe incorrect. Vérifie aussi que tu as bien confirmé ton adresse email.";
    }
    if (/User already registered/i.test(message)) {
      return "Un compte existe déjà avec cet identifiant. Clique sur « Se connecter », ou utilise « Mot de passe oublié ? ».";
    }
    if (/Email not confirmed/i.test(message)) {
      return "Ton email n'est pas encore confirmé. Vérifie ta boîte mail (et les spams).";
    }
    if (/Unable to validate email address/i.test(message)) {
      return "Adresse email invalide.";
    }
    return message;
  }

  function buildAuthOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'authModal';
    overlay.innerHTML = `<div class="modal-card">
      <h2>Bienvenue sur Cadence</h2>
      <div class="sub">Connecte-toi pour retrouver tes prospects sur tous tes appareils.</div>
      <label class="field">Email ou téléphone<input id="authEmail" type="text" placeholder="toi@entreprise.com ou +33 6 12 34 56 78"></label>
      <label class="field">Mot de passe<input id="authPassword" type="password" placeholder="8 caractères minimum"></label>
      <div class="modal-actions">
        <button class="button alt" id="signUp">Créer mon compte</button>
        <button class="button" id="signIn">Se connecter</button>
      </div>
      <p class="sub" style="margin:14px 0 0">
        <a href="#" id="forgotPassword" style="color:#635bff;text-decoration:none">Mot de passe oublié ?</a>
        &nbsp;·&nbsp;
        <a href="#" id="forgotId" style="color:#635bff;text-decoration:none">Identifiant oublié ?</a>
      </p>
      <p class="sub" style="margin:6px 0 0">Tes données sont privées et visibles uniquement par ton compte.</p>
    </div>`;
    return overlay;
  }

  function buildResetOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'resetModal';
    overlay.innerHTML = `<div class="modal-card">
      <h2>Réinitialiser le mot de passe</h2>
      <div class="sub">Entre ton email pour recevoir un lien de réinitialisation.</div>
      <label class="field">Email<input id="resetEmail" type="email" placeholder="toi@entreprise.com"></label>
      <div class="modal-actions">
        <button class="button alt" id="resetCancel">Retour</button>
        <button class="button" id="resetSend">Envoyer le lien</button>
      </div>
    </div>`;
    return overlay;
  }

  function buildNewPasswordOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'modal open';
    overlay.id = 'newPasswordModal';
    overlay.innerHTML = `<div class="modal-card">
      <h2>Nouveau mot de passe</h2>
      <div class="sub">Choisis un nouveau mot de passe pour ton compte.</div>
      <label class="field">Nouveau mot de passe<input id="newPassword" type="password" placeholder="8 caractères minimum"></label>
      <div class="modal-actions">
        <button class="button" id="newPasswordSave">Valider</button>
      </div>
    </div>`;
    return overlay;
  }

  async function loadCloudLeads() {
    const { data, error } = await client.from('leads').select('id,name,company,email,interest,score,reason,notes,status,follow,last_reply,reply_suggestion,updated_at').order('updated_at', { ascending: false });
    if (error) return toast('Erreur de chargement : ' + error.message);
    if (data.length) {
      leads.splice(0, leads.length, ...data);
      localStorage.setItem(STORE, JSON.stringify({ leads, automations: automationState }));
      render();
    } else {
      leads.forEach(l => { if (!l.id) l.id = crypto.randomUUID(); });
      await syncCloud();
    }
  }

  window.reloadCloudLeads = loadCloudLeads;

  async function syncCloud() {
    if (!isAuthenticated) return;
    const payload = leads.map(l => ({ ...l, id: l.id || (l.id = crypto.randomUUID()), updated_at: new Date().toISOString() }));
    const { error } = await client.from('leads').upsert(payload);
    if (error) toast('Sauvegarde impossible : ' + error.message);
  }

  const oldPersist = persist;
  window.persist = function () {
    oldPersist();
    if (isAuthenticated) syncCloud();
  };

  async function connect(identifier, password, signup) {
    identifier = (identifier || '').trim();
    if (!identifier || !password) return toast('Renseigne tes identifiants.');
    let credentials;
    if (isEmail(identifier)) credentials = { email: identifier, password };
    else if (isPhone(identifier)) credentials = { phone: identifier, password };
    else return toast('Entre un email valide ou un numéro de téléphone.');

    const action = signup ? client.auth.signUp(credentials) : client.auth.signInWithPassword(credentials);
    const { data, error } = await action;
    if (error) return toast(friendlyError(error.message));
    if (signup && !data.session) {
      return toast(credentials.email
        ? 'Compte créé : vérifie ton email, puis connecte-toi.'
        : 'Compte créé : vérifie le SMS reçu, puis connecte-toi.');
    }
    isAuthenticated = true;
    document.getElementById('authModal')?.remove();
    await loadCloudLeads();
    toast('Connecté — synchronisation active');
  }

  async function sendResetLink(email) {
    email = (email || '').trim();
    if (!isEmail(email)) return toast('Entre un email valide.');
    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.href.split('#')[0]
    });
    if (error) return toast(friendlyError(error.message));
    toast('Email envoyé — clique sur le lien reçu pour choisir un nouveau mot de passe.');
    document.getElementById('resetModal')?.remove();
    const overlay = buildAuthOverlay();
    document.body.appendChild(overlay);
    wireAuthOverlay();
  }

  function wireAuthOverlay() {
    document.getElementById('signIn').onclick = () =>
      connect(document.getElementById('authEmail').value, document.getElementById('authPassword').value, false);
    document.getElementById('signUp').onclick = () =>
      connect(document.getElementById('authEmail').value, document.getElementById('authPassword').value, true);
    document.getElementById('forgotPassword').onclick = (e) => {
      e.preventDefault();
      document.getElementById('authModal')?.remove();
      document.body.appendChild(buildResetOverlay());
      wireResetOverlay();
    };
    document.getElementById('forgotId').onclick = (e) => {
      e.preventDefault();
      toast("Ton identifiant est l'email (ou le téléphone) utilisé à l'inscription. Si tu ne t'en souviens plus, contacte le support pour vérifier ton compte.");
    };
  }

  function wireResetOverlay() {
    document.getElementById('resetSend').onclick = () =>
      sendResetLink(document.getElementById('resetEmail').value);
    document.getElementById('resetCancel').onclick = () => {
      document.getElementById('resetModal')?.remove();
      document.body.appendChild(buildAuthOverlay());
      wireAuthOverlay();
    };
  }

  function showNewPasswordForm() {
    document.getElementById('authModal')?.remove();
    document.getElementById('resetModal')?.remove();
    const overlay = buildNewPasswordOverlay();
    document.body.appendChild(overlay);
    document.getElementById('newPasswordSave').onclick = async () => {
      const pwd = document.getElementById('newPassword').value;
      if (!pwd || pwd.length < 8) return toast('8 caractères minimum.');
      const { error } = await client.auth.updateUser({ password: pwd });
      if (error) return toast(friendlyError(error.message));
      overlay.remove();
      isAuthenticated = true;
      toast('Mot de passe mis à jour.');
      await loadCloudLeads();
    };
  }

  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') showNewPasswordForm();
  });

  const { data: { session } } = await client.auth.getSession();
  if (session) {
    isAuthenticated = true;
    await loadCloudLeads();
    return;
  }

  if (window.location.hash.includes('type=recovery')) {
    showNewPasswordForm();
    return;
  }

  document.body.appendChild(buildAuthOverlay());
  wireAuthOverlay();
})();
