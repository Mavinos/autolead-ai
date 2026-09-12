# Mise en ligne gratuite — AutoLead AI

1. Dans Supabase, crée un projet gratuit.
2. Ouvre **SQL Editor**, colle le contenu de `supabase-schema.sql`, puis lance la requête.
3. Dans **Authentication > Providers**, laisse Email activé. Dans **URL Configuration**, ajoute l’URL Vercel après le premier déploiement.
4. Dans **Settings > API**, copie `Project URL` et la clé `anon` (ou *publishable*), puis colle-les dans `supabase-config.js`.
5. Sur Vercel, importe ce dossier `outputs` comme répertoire racine du projet et déploie.
6. Ouvre l’URL Vercel, crée un compte test, ajoute un prospect, puis recharge la page : il doit toujours être présent.

Ne jamais utiliser la clé `service_role` dans le fichier de configuration : elle est privée.
