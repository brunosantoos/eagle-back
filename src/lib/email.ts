/**
 * Envio de e-mail transacional.
 *
 * Usa a API HTTP do Resend (fetch nativo do Node 18+) — sem dependência extra e
 * sem SMTP para configurar.
 *
 * A configuração (chave, remetente, destino da equipe) é cadastrada pelo admin
 * no painel e vive no banco — ver `lib/emailSettings.ts`. As variáveis de
 * ambiente seguem valendo como fallback. Sem chave, o envio é ignorado com
 * aviso no log: o formulário continua funcionando e o lead é gravado.
 */

import {
  formatFrom,
  loadEmailSettings,
  type EmailSettings,
} from './emailSettings';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

/**
 * Resultado achatado de propósito: o front consome estes tipos pelo submodule,
 * e o tsconfig de lá não liga `strict` — union discriminada não estreita.
 */
export type SendEmailResult = {
  ok: boolean;
  /** true = não havia chave/estava desligado; não é erro. */
  skipped: boolean;
  id: string | null;
  error: string | null;
};

function siteUrl(settings: EmailSettings): string {
  return (settings.siteUrl.trim() || 'https://eagleacademia.com.br').replace(/\/+$/, '');
}

let missingKeyWarned = false;

export async function sendEmail(
  input: SendEmailInput,
  settings?: EmailSettings,
): Promise<SendEmailResult> {
  const config = settings ?? (await loadEmailSettings());
  const apiKey = config.apiKey.trim();

  if (!config.enabled || !apiKey) {
    if (!missingKeyWarned) {
      missingKeyWarned = true;
      console.warn(
        '[email] envio desligado ou sem chave — cadastre em Admin > E-mail. ' +
          'Formulários seguem gravando os leads normalmente.',
      );
    }
    return { ok: false, skipped: true, id: null, error: null };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        from: formatFrom(config),
        to: Array.isArray(input.to) ? input.to : [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        // `||` em toda a cadeia: campo definido-mas-vazio (env ou painel) não
        // pode virar reply_to vazio, que o Resend rejeita com 422.
        reply_to: input.replyTo || config.replyTo.trim() || config.teamEmail,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[email] falha ao enviar (${res.status}): ${body}`);
      return { ok: false, skipped: false, id: null, error: `HTTP ${res.status}` };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, skipped: false, id: data.id ?? null, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] erro de rede ao enviar: ${message}`);
    return { ok: false, skipped: false, id: null, error: message };
  }
}

/** Escapa texto do usuário antes de interpolar no HTML do e-mail. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Primeiro nome, cru — quem escapa é o `layout()`, que já faz `esc()` no heading. */
function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** Quebras de linha do usuário viram <br> (mensagens de contato são multi-linha). */
function escMultiline(value: string): string {
  return esc(value).replace(/\r?\n/g, '<br />');
}

const BRAND_BLACK = '#0b0b0d';
const BRAND_RED = '#c8102e';
const BRAND_GOLD = '#d4a437';

function layout(
  settings: EmailSettings,
  opts: {
    preheader: string;
    heading: string;
    body: string;
    footerNote?: string;
  },
): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(opts.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f5;font-family:Helvetica,Arial,sans-serif;color:#18181b;">
    <div style="display:none;font-size:1px;color:#f4f4f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${esc(opts.preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
            <tr>
              <td style="background:${BRAND_BLACK};padding:28px 32px;">
                <p style="margin:0;font-size:20px;font-weight:bold;color:#ffffff;letter-spacing:0.02em;">
                  EAGLE <span style="color:${BRAND_GOLD};">CENTER FITNESS</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:${BRAND_RED};"></td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:${BRAND_BLACK};">${esc(opts.heading)}</h1>
                ${opts.body}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px;border-top:1px solid #e4e4e7;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#71717a;">
                  ${opts.footerNote ?? `Eagle Center Fitness · <a href="${siteUrl(settings)}" style="color:${BRAND_RED};text-decoration:none;">${siteUrl(settings).replace(/^https?:\/\//, '')}</a>`}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:8px 0;font-size:13px;color:#71717a;width:38%;vertical-align:top;">${esc(label)}</td>
    <td style="padding:8px 0;font-size:14px;color:#18181b;vertical-align:top;">${value}</td>
  </tr>`;
}

const P = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#3f3f46;';

/* ------------------------- Contato (Sobre nós) ------------------------- */

export type ContactPayload = {
  name: string;
  email: string;
  phone: string;
  message: string;
};

export function contactCustomerEmail(
  data: ContactPayload,
  settings: EmailSettings,
): SendEmailInput {
  const html = layout(settings, {
    preheader: 'Recebemos a sua mensagem — nossa equipe responde em breve.',
    heading: `Recebemos a sua mensagem, ${firstName(data.name)}!`,
    body: `
      <p style="${P}">Obrigado pelo contato com a <strong>Eagle Center Fitness</strong>. Sua mensagem chegou para a nossa equipe e vamos responder em breve.</p>
      <p style="${P}">Este é um resumo do que você enviou:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;margin-bottom:18px;">
        ${infoRow('Nome', esc(data.name))}
        ${infoRow('E-mail', esc(data.email))}
        ${data.phone ? infoRow('Telefone', esc(data.phone)) : ''}
        ${infoRow('Mensagem', escMultiline(data.message))}
      </table>
      <p style="${P}">Se precisar acrescentar algo, basta responder este e-mail.</p>
    `,
  });

  const text = [
    `Recebemos a sua mensagem, ${data.name}!`,
    '',
    'Obrigado pelo contato com a Eagle Center Fitness. Nossa equipe responde em breve.',
    '',
    'Resumo do envio:',
    `Nome: ${data.name}`,
    `E-mail: ${data.email}`,
    data.phone ? `Telefone: ${data.phone}` : '',
    `Mensagem: ${data.message}`,
    '',
    'Se precisar acrescentar algo, responda este e-mail.',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    to: data.email,
    subject: 'Recebemos a sua mensagem — Eagle Center Fitness',
    html,
    text,
  };
}

export function contactTeamEmail(
  data: ContactPayload,
  settings: EmailSettings,
): SendEmailInput {
  const html = layout(settings, {
    preheader: `Nova mensagem de ${data.name}`,
    heading: 'Nova mensagem pelo site',
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;margin-bottom:18px;">
        ${infoRow('Nome', esc(data.name))}
        ${infoRow('E-mail', `<a href="mailto:${esc(data.email)}" style="color:${BRAND_RED};text-decoration:none;">${esc(data.email)}</a>`)}
        ${data.phone ? infoRow('Telefone', esc(data.phone)) : ''}
        ${infoRow('Mensagem', escMultiline(data.message))}
      </table>
      <p style="${P}">Responda direto para o e-mail do cliente ou acompanhe no painel em <a href="${siteUrl(settings)}/admin" style="color:${BRAND_RED};text-decoration:none;">Leads e contatos</a>.</p>
    `,
    footerNote: 'Notificação automática do site Eagle Center Fitness.',
  });

  const text = [
    'Nova mensagem pelo site',
    '',
    `Nome: ${data.name}`,
    `E-mail: ${data.email}`,
    data.phone ? `Telefone: ${data.phone}` : '',
    `Mensagem: ${data.message}`,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    to: settings.teamEmail,
    subject: `[Contato] ${data.name}`,
    html,
    text,
    replyTo: data.email,
  };
}

/* --------------------------- Lead de franquia --------------------------- */

export type FranchiseLeadPayload = {
  name: string;
  email: string;
  phone: string;
  city: string;
  capital: string;
};

export function franchiseCustomerEmail(
  data: FranchiseLeadPayload,
  settings: EmailSettings,
): SendEmailInput {
  const html = layout(settings, {
    preheader: 'Recebemos o seu interesse na franquia Eagle Center Fitness.',
    heading: `Obrigado pelo interesse, ${firstName(data.name)}!`,
    body: `
      <p style="${P}">Recebemos a sua solicitação sobre a <strong>franquia Eagle Center Fitness</strong>. Um consultor de expansão vai entrar em contato para apresentar o modelo de negócio.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;margin-bottom:18px;">
        ${infoRow('Nome', esc(data.name))}
        ${infoRow('E-mail', esc(data.email))}
        ${infoRow('Telefone', esc(data.phone))}
        ${infoRow('Cidade/Estado', esc(data.city))}
        ${infoRow('Capital disponível', esc(data.capital))}
      </table>
      <p style="${P}">Se algum dado estiver errado, responda este e-mail com a correção.</p>
    `,
  });

  const text = [
    `Obrigado pelo interesse, ${data.name}!`,
    '',
    'Recebemos a sua solicitação sobre a franquia Eagle Center Fitness. Um consultor de expansão entrará em contato.',
    '',
    `Nome: ${data.name}`,
    `E-mail: ${data.email}`,
    `Telefone: ${data.phone}`,
    `Cidade/Estado: ${data.city}`,
    `Capital disponível: ${data.capital}`,
  ].join('\n');

  return {
    to: data.email,
    subject: 'Recebemos o seu interesse na franquia — Eagle Center Fitness',
    html,
    text,
  };
}

export function franchiseTeamEmail(
  data: FranchiseLeadPayload,
  settings: EmailSettings,
): SendEmailInput {
  const html = layout(settings, {
    preheader: `Novo lead de franquia: ${data.name} (${data.city})`,
    heading: 'Novo lead de franquia',
    body: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e4e4e7;border-bottom:1px solid #e4e4e7;margin-bottom:18px;">
        ${infoRow('Nome', esc(data.name))}
        ${infoRow('E-mail', `<a href="mailto:${esc(data.email)}" style="color:${BRAND_RED};text-decoration:none;">${esc(data.email)}</a>`)}
        ${infoRow('Telefone', esc(data.phone))}
        ${infoRow('Cidade/Estado', esc(data.city))}
        ${infoRow('Capital disponível', esc(data.capital))}
      </table>
      <p style="${P}">Acompanhe o pipeline no painel em <a href="${siteUrl(settings)}/admin" style="color:${BRAND_RED};text-decoration:none;">Leads e contatos</a>.</p>
    `,
    footerNote: 'Notificação automática do site Eagle Center Fitness.',
  });

  const text = [
    'Novo lead de franquia',
    '',
    `Nome: ${data.name}`,
    `E-mail: ${data.email}`,
    `Telefone: ${data.phone}`,
    `Cidade/Estado: ${data.city}`,
    `Capital disponível: ${data.capital}`,
  ].join('\n');

  return {
    to: settings.teamEmail,
    subject: `[Franquia] ${data.name} — ${data.city}`,
    html,
    text,
    replyTo: data.email,
  };
}

/**
 * Dispara os e-mails do formulário (cliente + equipe) sem bloquear a resposta da
 * mutation. Carrega a configuração uma única vez e repassa para os templates.
 * Falha de e-mail nunca derruba o registro do lead.
 */
export function dispatchFormEmails(
  build: (settings: EmailSettings) => SendEmailInput[],
): void {
  void (async () => {
    const settings = await loadEmailSettings();
    for (const message of build(settings)) {
      await sendEmail(message, settings);
    }
  })().catch((err) => {
    console.error('[email] envio rejeitado:', err);
  });
}
