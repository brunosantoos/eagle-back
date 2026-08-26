# Configuração do e-mail automático

Guia da aba **Admin > E-mail**. O painel repete o passo a passo resumido; aqui
ficam os detalhes de DNS e o diagnóstico dos erros.

O provedor é o **Resend** (API HTTP, sem SMTP). O que o site manda:

| Quando | Para quem | Assunto |
|---|---|---|
| Formulário de contato enviado | quem preencheu | confirmação de recebimento |
| Formulário de contato enviado | e-mail da equipe | aviso do novo contato |
| Formulário de franquia enviado | quem preencheu | confirmação de recebimento |
| Formulário de franquia enviado | e-mail da equipe | aviso do novo lead |

O `reply-to` do aviso interno é o e-mail de quem preencheu — responder no
cliente de e-mail já vai direto para o lead.

**Sem chave cadastrada nada quebra**: os formulários continuam gravando os
leads, só não sai e-mail. É proposital.

---

## 1. Conta e chave

1. Criar conta em <https://resend.com> (plano gratuito: 3.000 e-mails/mês,
   100/dia).
2. **API Keys > Create API Key**, permissão *Sending access*.
3. Copiar a chave (`re_...`). Ela aparece **uma única vez**.
4. Colar em Admin > E-mail > *Chave da API*, ligar o envio e salvar.

A chave nunca volta do servidor em texto puro — o painel mostra só os quatro
últimos dígitos e de onde ela veio (painel ou variável de ambiente).

## 2. Verificar o domínio (o passo que decide se cai no spam)

Em **Domains > Add Domain**, cadastrar `eagleacademia.com.br`. O Resend gera
três registros para cadastrar no DNS do domínio:

| Tipo | Nome (exemplo) | Para quê |
|---|---|---|
| `TXT` | `send.eagleacademia.com.br` | **SPF** — autoriza o Resend a enviar pelo domínio |
| `TXT` | `resend._domainkey.eagleacademia.com.br` | **DKIM** — assinatura que prova que o e-mail é legítimo |
| `TXT` | `_dmarc.eagleacademia.com.br` | **DMARC** — política de tratamento para quem falhar SPF/DKIM |

Os valores exatos são os que o Resend exibir — não copie de outro lugar, o DKIM
é único por domínio.

Depois de cadastrar, clicar em **Verify**. Normalmente leva minutos; o limite de
propagação do DNS é 24h.

> Enquanto o domínio não estiver `Verified`, o envio até funciona a partir de um
> remetente de teste do Resend, mas e-mail com remetente do domínio é recusado
> (403) e o que sair tem alta chance de cair no spam.

## 3. Remetente

O campo *E-mail remetente* precisa ser um endereço **do domínio verificado**
(ex.: `contato@eagleacademia.com.br`). Gmail, Hotmail e afins são recusados —
o Resend não deixa enviar em nome de um domínio de terceiro.

- *Nome do remetente* — o que aparece na caixa de entrada (ex.: `Eagle Center Fitness`).
- *E-mail da equipe* — destino dos avisos internos.
- *Responder para* — vazio significa responder para quem preencheu o formulário.
- *URL do site* — usada nos links dentro dos templates.

## 4. Teste e diagnóstico

O botão **Enviar teste** devolve o erro cru do Resend:

| Erro | Causa | Correção |
|---|---|---|
| `401` | chave inválida, expirada ou colada pela metade | gerar outra em API Keys |
| `403` | remetente de domínio não verificado | concluir o passo 2 ou usar outro remetente |
| `422` | campo de e-mail vazio ou mal formatado | conferir remetente, equipe e reply-to |
| `429` | limite de envio do plano | esperar a janela ou subir de plano |
| nada chega, sem erro | e-mail entregue mas classificado como spam | conferir SPF/DKIM/DMARC |

Nos logs do backend, tudo relacionado a envio sai com o prefixo `[email]`.

## Variáveis de ambiente (fallback)

O que está salvo no painel tem prioridade. As variáveis abaixo continuam
valendo para deploys antigos que ainda não passaram pelo painel:

```env
RESEND_API_KEY=re_xxxxxxxx
EMAIL_FROM="Eagle Center Fitness <contato@eagleacademia.com.br>"
EMAIL_TEAM=contato@grupogoldeagle.com.br
EMAIL_REPLY_TO=
SITE_URL=https://eagleacademia.com.br
```
