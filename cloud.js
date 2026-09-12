/* Connexion Supabase : conserve le mode démo local tant que la configuration est vide. */
(async function () {
  const url = window.AUTOLEAD_SUPABASE_URL;
  const key = window.AUTOLEAD_SUPABASE_ANON_KEY;
  if (!url || !key) return;

  const client = window.supabase.createClient(url, key);
  const overlay = document.createElement('div');
  overlay.className = 'modal open';
  overlay.id = 'authModal';
  overlay.innerHTML = `<div class="modal-card"><h2>Bienvenue sur AutoLead AI</h2><div class="sub">Connecte-toi pour retrouver tes prospects sur tous tes appareils.</div><label class="field">Email<input id="authEmail" type="email" placeholder="toi@entreprise.com"></label><label class="field">Mot de passe<input id="authPassword" type="password" placeholder="8 caractères minimum"></label><div class="modal-actions"><button class="button alt" id="signUp">Créer mon compte</button><button class="button" id="signIn">Se connecter</button></div><p class="sub" style="margin:14px 0 0">Tes données sont privées et visibles uniquement par ton compte.</p></div>`;

  async function loadCloudLeads() {
    const { data, error } = await client.from('leads').select('id,name,company,interest,score,status,follow').order('updated_at', { ascending: false });
    if (error) return toast('Erreur de chargement : ' + error.message);
    if (data.length) { leads.splice(0, leads.length, ...data); localStorage.setItem(STORE, JSON.stringify({ leads, automations: automationState })); render(); }
    else { leads.forEach(l => { if (!l.id) l.id = crypto.randomUUID(); }); await syncCloud(); }
  }
  async function syncCloud() {
    const payload = leads.map(l => ({ ...l, id: l.id || (l.id = crypto.randomUUID()), updated_at: new Date().toISOString() }));
    const { error } = await client.from('leads').upsert(payload);
    if (error) toast('Sauvegarde impossible : ' + error.message);
  }
  const oldPersist = persist;
  window.persist = function () { oldPersist(); if (client.auth.getSession) syncCloud(); };
  async function connect(email, password, signup) {
    const action = signup ? client.auth.signUp({ email, password }) : client.auth.signInWithPassword({ email, password });
    const { data, error } = await action;
    if (error) return toast(error.message);
    if (signup && !data.session) return toast('Compte créé : vérifie ton email, puis connecte-toi.');
    overlay.remove(); await loadCloudLeads(); toast('Connecté — synchronisation active');
  }
  const { data: { session } } = await client.auth.getSession();
  if (session) { await loadCloudLeads(); return; }
  document.body.appendChild(overlay);
  document.getElementById('signIn').onclick = () => connect(document.getElementById('authEmail').value, document.getElementById('authPassword').value, false);
  document.getElementById('signUp').onclick = () => connect(document.getElementById('authEmail').value, document.getElementById('authPassword').value, true);
})();
