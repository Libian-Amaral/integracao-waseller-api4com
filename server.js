// =====================================================================
//  INTEGRACAO WASELLER  <->  API4COM
//
//  Fluxo:
//   1) O WaSeller dispara um webhook quando um lead entra no CRM.
//      -> este servico recebe e guarda o lead (numero + nome).
//   2) A equipe abre o PAINEL, ve a lista de leads e clica em "Ligar".
//      -> este servico dispara a chamada na API4COM (ninguem digita numero).
//   3) Quando a ligacao termina, a API4COM dispara um webhook de retorno.
//      -> este servico registra o resultado (duracao + gravacao) e grava
//         uma nota de volta no contato do WaSeller.
//
//  Pagina /admin: setup inicial pelo proprio navegador (gerar token da
//  API4COM, registrar webhook, testar a API do WaSeller) - sem precisar
//  de Node.js no computador.
//
//  Documentacao usada:
//   - API4COM : https://developers.api4com.com
//   - WaSeller: https://api-whatsapp.wascript.com.br/api-docs/
// =====================================================================

require('dotenv').config();
const express = require('express');
const path = require('path');

const { normalizarTelefone } = require('./lib/phone');
const store = require('./lib/store');
const api4com = require('./lib/api4com');
const waseller = require('./lib/waseller');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const GATEWAY = process.env.API4COM_GATEWAY || 'waseller-api4com';

// ---------------------------------------------------------------------
function log(...args) { console.log(new Date().toISOString(), ...args); }

// Procura o valor em um objeto desconhecido, testando varias chaves
// possiveis (inclusive um nivel aninhado). O formato exato do webhook
// do WaSeller nao e documentado, entao usamos extracao tolerante.
function buscarCampo(obj, nomesPossiveis) {
  if (!obj || typeof obj !== 'object') return undefined;
  const alvo = nomesPossiveis.map((n) => n.toLowerCase());
  for (const [chave, valor] of Object.entries(obj)) {
    if (alvo.includes(String(chave).toLowerCase()) && valor != null && valor !== '' && typeof valor !== 'object') {
      return valor;
    }
  }
  for (const valor of Object.values(obj)) {
    if (valor && typeof valor === 'object') {
      const achado = buscarCampo(valor, nomesPossiveis);
      if (achado != null) return achado;
    }
  }
  return undefined;
}

function formatarDataBr(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (isNaN(d.getTime())) return iso || '';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function formatarDuracao(seg) {
  seg = Number(seg) || 0;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return m > 0 ? `${m}min ${s}s` : `${s}s`;
}

// ---------------------------------------------------------------------
//  Protecoes
// ---------------------------------------------------------------------
function protegerPainel(req, res, next) {
  const usuario = process.env.PAINEL_USUARIO;
  const senha = process.env.PAINEL_SENHA;
  if (!usuario || !senha) return next();
  const header = req.headers.authorization || '';
  const [tipo, valor] = header.split(' ');
  if (tipo === 'Basic' && valor) {
    const [u, s] = Buffer.from(valor, 'base64').toString().split(':');
    if (u === usuario && s === senha) return next();
  }
  res.set('WWW-Authenticate', 'Basic realm="Painel"');
  return res.status(401).send('Acesso restrito.');
}

function validarSegredo(req, res, next) {
  if (!WEBHOOK_SECRET) return res.status(500).json({ erro: 'WEBHOOK_SECRET nao configurado no servidor.' });
  if (req.params.secret !== WEBHOOK_SECRET) {
    log('[seguranca] Webhook recebido com segredo invalido. Ignorado.');
    return res.status(403).json({ erro: 'Segredo invalido.' });
  }
  next();
}

// =====================================================================
//  1) WEBHOOK DO WASELLER - leads que chegam no CRM
// =====================================================================
app.post('/webhook/waseller/:secret', validarSegredo, (req, res) => {
  const payload = req.body || {};
  log('[waseller] Webhook recebido:', JSON.stringify(payload));

  const numeroBruto = buscarCampo(payload, ['numero','number','phone','telefone','userID','userid','celular','whatsapp']);
  const nome = buscarCampo(payload, ['nome','name','contato','pushname','cliente']) || 'Sem nome';

  if (!numeroBruto) {
    log('[waseller] Numero nao encontrado no payload.');
    return res.status(200).json({ ok: false, motivo: 'numero_nao_encontrado' });
  }
  const tel = normalizarTelefone(numeroBruto);
  if (!tel) {
    log('[waseller] Numero em formato nao reconhecido:', numeroBruto);
    return res.status(200).json({ ok: false, motivo: 'numero_invalido', recebido: numeroBruto });
  }
  const lead = store.salvarLead({
    waId: tel.waId, e164: tel.e164, nome: String(nome).trim(),
    status: 'novo', origem: 'waseller',
  });
  log(`[waseller] Lead salvo: ${lead.nome} (${lead.e164})`);
  res.status(200).json({ ok: true });
});

// =====================================================================
//  2) PAINEL DE LIGACOES
// =====================================================================
app.get('/', protegerPainel, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'painel.html'));
});
app.get('/api/leads', protegerPainel, (req, res) => res.json(store.listarLeads()));

// =====================================================================
//  3) LIGAR (dispara chamada na API4COM)
// =====================================================================
app.post('/api/ligar', protegerPainel, async (req, res) => {
  try {
    const waId = String(req.body.waId || '');
    const lead = store.obterLead(waId);
    if (!lead) return res.status(404).json({ erro: 'Lead nao encontrado.' });
    const extension = process.env.API4COM_EXTENSION;
    if (!extension) return res.status(500).json({ erro: 'API4COM_EXTENSION nao configurado no .env' });

    const resultado = await api4com.realizarChamada({
      extension, phone: lead.e164,
      metadata: { gateway: GATEWAY, waId: lead.waId, nome: lead.nome },
    });
    store.atualizarLead(waId, {
      status: 'ligando', ultimaChamadaId: resultado.id || null,
      ultimaChamadaEm: new Date().toISOString(),
    });
    log(`[ligar] Chamada disparada para ${lead.nome} (${lead.e164}) - id ${resultado.id}`);
    res.json({ ok: true, id: resultado.id });
  } catch (e) {
    log('[ligar] Erro:', e.message);
    res.status(502).json({ erro: e.message });
  }
});

// =====================================================================
//  4) WEBHOOK DA API4COM (resultado da ligacao)
// =====================================================================
app.post('/webhook/api4com/:secret', validarSegredo, async (req, res) => {
  const evento = req.body || {};
  log('[api4com] Webhook recebido:', JSON.stringify(evento));
  res.status(200).json({ ok: true });
  try {
    if (evento.eventType && evento.eventType !== 'channel-hangup') return;
    const meta = evento.metadata || {};
    let waId = meta.waId;
    if (!waId && evento.called) {
      const tel = normalizarTelefone(evento.called);
      if (tel) waId = tel.waId;
    }
    if (!waId) { log('[api4com] Nao foi possivel associar a ligacao a um lead.'); return; }
    const atendida = Number(evento.duration) > 0;
    store.atualizarLead(waId, {
      status: atendida ? 'atendida' : 'nao_atendida',
      ultimaLigacao: {
        em: evento.endedAt || new Date().toISOString(),
        duracaoSegundos: Number(evento.duration) || 0,
        atendida, motivoDesligamento: evento.hangupCause || '',
        gravacao: evento.recordUrl || '',
      },
    });
    log(`[api4com] Ligacao ${atendida ? 'ATENDIDA' : 'NAO ATENDIDA'} para ${waId} (${evento.duration || 0}s)`);

    if (String(process.env.WASELLER_REGISTRAR_NOTA).toLowerCase() === 'true') {
      const linhas = [
        `Ligacao ${atendida ? 'atendida' : 'nao atendida'} (via API4COM)`,
        `Data: ${formatarDataBr(evento.endedAt)}`,
        `Duracao: ${formatarDuracao(evento.duration)}`,
        evento.recordUrl ? `Gravacao: ${evento.recordUrl}` : null,
      ].filter(Boolean);
      try {
        await waseller.criarNota({ userID: waId, text: linhas.join('\n') });
        log('[api4com] Nota registrada no WaSeller.');
      } catch (e) {
        log('[api4com] Falha ao registrar nota no WaSeller:', e.message);
      }
    }
    const labelId = atendida ? process.env.WASELLER_LABEL_ATENDIDA : process.env.WASELLER_LABEL_NAO_ATENDIDA;
    if (labelId) {
      try {
        await waseller.modificarEtiquetas({ phone: [waId], actions: [{ labelId: String(labelId), type: 'add' }] });
        log('[api4com] Etiqueta aplicada no WaSeller.');
      } catch (e) {
        log('[api4com] Falha ao aplicar etiqueta:', e.message);
      }
    }
  } catch (e) {
    log('[api4com] Erro ao processar webhook:', e.message);
  }
});

// =====================================================================
//  5) PAGINA /admin - setup pelo navegador (sem Node.js local)
// =====================================================================
app.get('/admin', protegerPainel, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

// Retorna quais variaveis estao configuradas (sem expor os valores).
app.get('/admin/status', protegerPainel, (req, res) => {
  res.json({
    PUBLIC_URL: process.env.PUBLIC_URL || null,
    WEBHOOK_SECRET: !!WEBHOOK_SECRET,
    PAINEL_USUARIO: !!process.env.PAINEL_USUARIO,
    PAINEL_SENHA: !!process.env.PAINEL_SENHA,
    API4COM_TOKEN: !!process.env.API4COM_TOKEN,
    API4COM_EXTENSION: process.env.API4COM_EXTENSION || null,
    API4COM_GATEWAY: GATEWAY,
    WASELLER_TOKEN: !!process.env.WASELLER_TOKEN,
    WASELLER_REGISTRAR_NOTA: String(process.env.WASELLER_REGISTRAR_NOTA).toLowerCase() === 'true',
  });
});

// Gera o token permanente da API4COM a partir de email+senha.
// A senha NAO e logada nem salva; e usada uma unica vez para chamar a API4COM.
app.post('/admin/gerar-token-api4com', protegerPainel, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim();
    const senha = String(req.body.password || req.body.senha || '');
    if (!email || !senha) return res.status(400).json({ erro: 'E-mail e senha sao obrigatorios.' });
    const r = await api4com.gerarTokenPermanente({ email, password: senha });
    log('[admin] Token permanente da API4COM gerado para', email);
    res.json({ ok: true, token: r.token });
  } catch (e) {
    log('[admin] Falha ao gerar token API4COM:', e.message);
    res.status(502).json({ erro: e.message });
  }
});

// Registra o webhook de retorno na API4COM (usa API4COM_TOKEN, PUBLIC_URL e WEBHOOK_SECRET).
app.post('/admin/registrar-webhook-api4com', protegerPainel, async (req, res) => {
  try {
    if (!process.env.API4COM_TOKEN) return res.status(400).json({ erro: 'Defina API4COM_TOKEN antes de registrar o webhook.' });
    if (!process.env.PUBLIC_URL) return res.status(400).json({ erro: 'Defina PUBLIC_URL antes de registrar o webhook.' });
    if (!WEBHOOK_SECRET) return res.status(400).json({ erro: 'Defina WEBHOOK_SECRET antes de registrar o webhook.' });
    const webhookUrl = `${process.env.PUBLIC_URL.replace(/\/$/, '')}/webhook/api4com/${WEBHOOK_SECRET}`;
    const r = await api4com.registrarWebhook({ gateway: GATEWAY, webhookUrl });
    log('[admin] Webhook da API4COM registrado em', webhookUrl);
    res.json({ ok: true, webhookUrl: webhookUrl, resposta: r });
  } catch (e) {
    log('[admin] Falha ao registrar webhook API4COM:', e.message);
    res.status(502).json({ erro: e.message });
  }
});

// Testa a API do WaSeller (lista etiquetas). Util para verificar se o
// WASELLER_TOKEN esta correto e se o WhatsApp Web esta conectado.
app.post('/admin/testar-waseller', protegerPainel, async (req, res) => {
  try {
    if (!process.env.WASELLER_TOKEN) return res.status(400).json({ erro: 'Defina WASELLER_TOKEN antes de testar.' });
    const r = await waseller.listarEtiquetas();
    res.json({ ok: true, resposta: r });
  } catch (e) {
    log('[admin] Falha no teste do WaSeller:', e.message);
    res.status(502).json({ erro: e.message });
  }
});

// =====================================================================
//  Saude
// =====================================================================
app.get('/health', (req, res) => res.json({ ok: true, servico: 'integracao-waseller-api4com', hora: new Date().toISOString() }));

app.listen(PORT, () => {
  log(`Servico de integracao WaSeller <-> API4COM rodando na porta ${PORT}`);
  if (!WEBHOOK_SECRET) log('AVISO: WEBHOOK_SECRET nao configurado.');
  if (!process.env.API4COM_TOKEN) log('AVISO: API4COM_TOKEN nao configurado.');
  if (!process.env.WASELLER_TOKEN) log('AVISO: WASELLER_TOKEN nao configurado.');
});
