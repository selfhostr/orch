import type en from '../en/admin.ts';
import type { Catalog } from '../../types.ts';

export default {
  title: 'Accès',
  lede: 'Décider qui peut se connecter à ce serveur orch : répondre aux demandes, pré-approuver des logins et envoyer des liens d’invitation.',
  adminsOnly: 'Réservé aux administrateurs.',
  actions: {
    approve: 'Approuver',
    deny: 'Refuser',
    remove: 'Retirer',
    revoke: 'Révoquer',
    preApprove: 'Pré-approuver',
    createInvite: 'Créer un lien d’invitation',
  },
  confirm: {
    remove: {
      label: 'Retirer le membre',
      title: 'Retirer {login} ?',
      body: 'Retirer {login} ? Son accès au serveur sera refusé jusqu’à ce qu’un administrateur l’approuve à nouveau.',
      action: 'Retirer le membre',
    },
    deny: {
      label: 'Refuser la demande',
      title: 'Refuser {login} ?',
      body: 'La demande est refusée. La personne pourra être approuvée plus tard depuis la liste des refus.',
      action: 'Refuser la demande',
    },
    revokeInvite: {
      label: 'Révoquer le lien d’invitation',
      title: 'Révoquer ce lien d’invitation ?',
      body: 'Plus personne ne peut s’inscrire avec ce lien. Cette action est définitive.',
      action: 'Révoquer le lien',
    },
  },
  pending: {
    title: 'Demandes en attente',
    none: 'Aucune demande en attente.',
  },
  members: {
    title: 'Membres',
    none: 'Aucun membre approuvé pour l’instant.',
    approvedBy: 'approuvé par {name}',
    addLogin: 'Ajouter un login GitHub',
  },
  invites: {
    title: 'Liens d’invitation',
    none: 'Aucun lien d’invitation.',
    type: 'Type',
    singleUse: 'Usage unique',
    multiUse: 'Usage multiple',
    expiresAfter: 'Expire après',
    expiry: {
      h24: '24 heures',
      h168: '7 jours',
      h720: '30 jours',
    },
    notShownAgain: 'Ce lien ne sera plus affiché. Le copier maintenant.',
    usesExpires: {
      one: '{count} utilisation, expire le {date}',
      other: '{count} utilisations, expire le {date}',
    },
    status: {
      revoked: 'révoqué',
      expired: 'expiré',
      used: 'utilisé',
      active: 'actif',
      inactive: 'inactif',
    },
  },
  configured: {
    title: 'Configuré sur le serveur',
    hint: 'Ces entrées sont configurées sur le serveur (environnement) et ne peuvent pas être modifiées ici.',
    allowAny: 'Tout compte GitHub est autorisé sur ce serveur.',
    logins: 'Logins',
    orgs: 'Organisations',
    admins: 'Administrateurs',
    none: 'aucun',
  },
  declined: 'Refusés ({count})',
  toast: {
    approved: '{login} approuvé',
    denied: '{login} refusé',
    removed: '{login} retiré',
    preApproved: '{login} pré-approuvé',
    inviteRevoked: 'Lien d’invitation révoqué',
  },
} satisfies Catalog<typeof en>;
